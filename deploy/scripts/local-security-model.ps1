#Requires -Version 7.4
[CmdletBinding()]
param([ValidateSet('Start','Stop','Status','Pull','Verify','Configure')][string]$Action='Status')
$ErrorActionPreference='Stop'
$taskRoot=Join-Path $env:LOCALAPPDATA 'DrapixAI\security-models'
$taskBinary=Join-Path $taskRoot 'ollama-v0.40.13\ollama.exe'
$taskState=Join-Path $taskRoot 'service.json'
$taskBase='http://127.0.0.1:11439'
$taskModel='qwen3:8b'
$taskCompatibility=$null
if(Test-Path -LiteralPath (Join-Path $taskRoot 'strix-compatibility.json')){
    $taskCompatibility=Get-Content -LiteralPath (Join-Path $taskRoot 'strix-compatibility.json') -Raw|ConvertFrom-Json
}
function Get-ModelProcess {
    if(-not(Test-Path -LiteralPath $taskState)){return $null}
    $record=Get-Content -LiteralPath $taskState -Raw|ConvertFrom-Json
    $process=Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if($process -and $process.Path -eq $taskBinary -and $process.StartTime.ToUniversalTime().Ticks -eq $record.startTicks){return $process}
    return $null
}
function Invoke-ModelApi([string]$Path,[object]$Body=$null,[int]$Timeout=10){
    $taskRequest=@{Uri="$taskBase$Path";NoProxy=$true;MaximumRedirection=0;TimeoutSec=$Timeout}
    if($null -ne $Body){$taskRequest.Method='Post';$taskRequest.ContentType='application/json';$taskRequest.Body=ConvertTo-Json -InputObject $Body -Depth 20 -Compress}
    Invoke-RestMethod @taskRequest
}
function Assert-OwnedModelServer {
    if(-not(Get-ModelProcess)){throw 'OWNED_MODEL_SERVER_NOT_RUNNING: use -Action Start'}
    if((Invoke-ModelApi '/api/version').version -ne '0.40.13'){throw 'MODEL_SERVER_VERSION_MISMATCH'}
}
if($Action -eq 'Start'){
    $taskExisting=Get-ModelProcess
    if(-not $taskExisting){
        if(-not(Test-Path -LiteralPath $taskBinary)){throw 'PINNED_PORTABLE_OLLAMA_NOT_INSTALLED'}
        if((Get-FileHash -LiteralPath $taskBinary -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'c1cca2937421d78877d5961746d25e33acd62e194d881f90fb63dca7f3e10f41'){throw 'OLLAMA_BINARY_HASH_MISMATCH'}
        $taskSocket=[Net.Sockets.TcpClient]::new()
        try{ $taskOccupied=$false; try{$taskOccupied=$taskSocket.ConnectAsync('127.0.0.1',11439).Wait(500)}catch{}; if($taskOccupied){throw 'LOCAL_MODEL_PORT_ALREADY_OWNED_BY_ANOTHER_PROCESS'} }finally{$taskSocket.Dispose()}
        New-Item -ItemType Directory -Path (Join-Path $taskRoot 'models') -Force|Out-Null
        # Remove inherited app/provider credentials from this child only.
        $taskEnvironment=@{}
        foreach($taskKey in [Environment]::GetEnvironmentVariables('Process').Keys){$taskEnvironment[$taskKey]=$null}
        foreach($taskKey in @('PATH','SystemRoot','WINDIR','COMSPEC','TEMP','TMP','LOCALAPPDATA','APPDATA','USERPROFILE','HOMEDRIVE','HOMEPATH','PATHEXT','ProgramFiles','ProgramData')){
            $taskValue=[Environment]::GetEnvironmentVariable($taskKey,'Process');if($null -ne $taskValue){$taskEnvironment[$taskKey]=$taskValue}
        }
        $taskEnvironment.OLLAMA_HOST='127.0.0.1:11439'
        $taskEnvironment.OLLAMA_MODELS=Join-Path $taskRoot 'models'
        $taskEnvironment.OLLAMA_NO_CLOUD='1'
        $taskEnvironment.OLLAMA_CONTEXT_LENGTH='16384'
        $taskEnvironment.OLLAMA_FLASH_ATTENTION='1'
        $taskEnvironment.OLLAMA_KV_CACHE_TYPE='q8_0'
        $taskEnvironment.OLLAMA_NUM_PARALLEL='1'
        $taskEnvironment.OLLAMA_MAX_LOADED_MODELS='1'
        $taskEnvironment.OLLAMA_MAX_QUEUE='2'
        $taskEnvironment.OLLAMA_KEEP_ALIVE='2m'
        $taskEnvironment.OLLAMA_ORIGINS=$taskBase
        $taskExisting=Start-Process -FilePath $taskBinary -ArgumentList 'serve' -WorkingDirectory $taskRoot -WindowStyle Hidden -Environment $taskEnvironment -RedirectStandardOutput (Join-Path $taskRoot 'server.stdout.log') -RedirectStandardError (Join-Path $taskRoot 'server.stderr.log') -PassThru
        @{pid=$taskExisting.Id;startTicks=$taskExisting.StartTime.ToUniversalTime().Ticks;binary=$taskBinary}|ConvertTo-Json|Set-Content -LiteralPath $taskState
    }
    $taskReady=$false
    for($taskTry=0;$taskTry -lt 30;$taskTry++){try{Assert-OwnedModelServer;$taskReady=$true;break}catch{Start-Sleep -Milliseconds 300}}
    if(-not $taskReady){throw 'LOCAL_MODEL_START_FAILED: inspect private runtime logs'}
}
if($Action -eq 'Stop'){
    $taskOwned=Get-ModelProcess
    if($taskOwned){
        try{if(@((Invoke-ModelApi '/api/ps').models|Where-Object name -eq $taskModel).Count -gt 0){Invoke-ModelApi '/api/generate' @{model=$taskModel;keep_alive=0} 30|Out-Null}}catch{Write-Warning 'Model unload was not confirmed; inspect owned runtime after stopping.'}
        Stop-Process -Id $taskOwned.Id -ErrorAction Stop
        if(-not $taskOwned.WaitForExit(10000)){throw 'OWNED_MODEL_PROCESS_STOP_NOT_CONFIRMED'}
    }
    @{stopped=$true;ownedProcessOnly=$true}|ConvertTo-Json -Compress
    return
}
if($Action -eq 'Status' -or $Action -eq 'Start'){
    $taskOwned=Get-ModelProcess
    if(-not $taskOwned){@{running=$false;endpoint=$taskBase}|ConvertTo-Json -Compress;return}
    Assert-OwnedModelServer
    @{running=$true;pid=$taskOwned.Id;endpoint=$taskBase;version='0.40.13';models=@((Invoke-ModelApi '/api/tags').models|Select-Object name,digest,size);loaded=@((Invoke-ModelApi '/api/ps').models|Select-Object name,size_vram,context_length);runtimeDirectory=$taskRoot;strixCompatibility=$taskCompatibility}|ConvertTo-Json -Depth 6
    return
}
Assert-OwnedModelServer
if($Action -eq 'Pull'){
    $taskResult=Invoke-ModelApi '/api/pull' @{model=$taskModel;stream=$false} 3600
    if($taskResult.status -ne 'success'){throw 'MODEL_PULL_INCOMPLETE'}
    $taskTag=@((Invoke-ModelApi '/api/tags').models|Where-Object name -eq $taskModel)
    if($taskTag.Count -ne 1 -or $taskTag[0].digest -notmatch '^[a-f0-9]{64}$'){throw 'MODEL_DIGEST_MISSING'}
    @{model=$taskModel;digest=$taskTag[0].digest;bytes=$taskTag[0].size;recordedAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $taskRoot 'model-manifest.json')
    @{pulled=$true;model=$taskModel;digest=$taskTag[0].digest;bytes=$taskTag[0].size}|ConvertTo-Json -Compress
    return
}
if($Action -eq 'Configure'){
    $taskVerified=Get-Content -LiteralPath (Join-Path $taskRoot 'verification.json') -Raw|ConvertFrom-Json
    $taskCurrent=@((Invoke-ModelApi '/api/tags').models|Where-Object name -eq $taskModel)
    if(-not $taskVerified.passed -or $taskCurrent.Count -ne 1 -or $taskCurrent[0].digest -ne $taskVerified.digest){throw 'LOCAL_MODEL_PROTOCOL_NOT_VERIFIED'}
    if($taskCompatibility -and $taskCompatibility.modelDigest -eq $taskCurrent[0].digest -and -not $taskCompatibility.fullStrixCompatible){
        Write-Warning 'This model passed basic protocol checks but truncated the Strix agent prompt. These settings are experimental; a full assessment is not qualified.'
    }
    # Process-local settings only. This does not install or start Strix.
    $env:STRIX_LLM="openai/$taskModel"
    $env:LLM_API_BASE="$taskBase/v1"
    $env:LLM_API_KEY='ollama'
    $env:STRIX_API_TYPE='chat_completions'
    $env:STRIX_TELEMETRY='0'
    # Strix 1.5.3 dedupe overrides duplicate API credentials in SDK kwargs.
    # With no dedicated override, dedupe inherits the same local main route.
    foreach($taskKey in @('STRIX_DEDUPE_MODEL','DEDUPE_LLM_API_BASE','DEDUPE_LLM_API_KEY','DEDUPE_LLM_EXTRA_HEADERS','STRIX_DEDUPE_REASONING_EFFORT')){
        Remove-Item -LiteralPath "Env:$taskKey" -ErrorAction SilentlyContinue
    }
    @{configuredForCurrentShell=$true;model=$env:STRIX_LLM;base=$env:LLM_API_BASE;strixStarted=$false;qualifiedForFullAssessment=$false}|ConvertTo-Json -Compress
    return
}
if($Action -eq 'Verify'){
    @{passed=$false;status='verification-in-progress';recordedAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $taskRoot 'verification.json')
    try{
    $taskManifest=Get-Content -LiteralPath (Join-Path $taskRoot 'model-manifest.json') -Raw|ConvertFrom-Json
    $taskTag=@((Invoke-ModelApi '/api/tags').models|Where-Object name -eq $taskModel)
    if($taskTag.Count -ne 1 -or $taskTag[0].digest -ne $taskManifest.digest){throw 'MODEL_DIGEST_CHANGED: review before use'}
    $taskNonce='DRAPIXAI_LOCAL_TOOL_TEST'
    $taskTool=@{type='function';function=@{name='report_fixture';description='Return the exact synthetic nonce supplied by the user. Does not run commands or read files.';parameters=@{type='object';properties=@{nonce=@{type='string'}};required=@('nonce')}}}
    $taskMessages=@(@{role='user';content="Call report_fixture exactly once with nonce $taskNonce. Use a structured tool call. /no_think"})
    $taskNative=Invoke-ModelApi '/api/chat' @{model=$taskModel;messages=$taskMessages;tools=@($taskTool);think=$false;stream=$false;options=@{temperature=0;seed=42;num_ctx=16384;num_predict=256}} 180
    $taskNative|ConvertTo-Json -Depth 20|Set-Content -LiteralPath (Join-Path $taskRoot 'synthetic-native-tool-response.json')
    $taskCalls=@($taskNative.message.tool_calls)
    if($taskCalls.Count -ne 1 -or $taskCalls[0].function.name -ne 'report_fixture' -or $taskCalls[0].function.arguments.nonce -ne $taskNonce){throw 'NATIVE_STRUCTURED_TOOL_CALL_FAILED'}
    $taskToolResult='LOCAL_TOOL_ROUNDTRIP_'+[Guid]::NewGuid().ToString('N')
    $taskRoundtrip=Invoke-ModelApi '/api/chat' @{model=$taskModel;messages=@($taskMessages[0],$taskNative.message,@{role='tool';tool_name='report_fixture';content=$taskToolResult},@{role='user';content='Return a JSON object with exactly one string field result holding the tool output. /no_think'});format='json';think=$false;stream=$false;options=@{temperature=0;num_ctx=16384;num_predict=96}} 120
    $taskRoundtrip|ConvertTo-Json -Depth 20|Set-Content -LiteralPath (Join-Path $taskRoot 'synthetic-tool-roundtrip-response.json')
    $taskRecovered=$taskRoundtrip.message.content|ConvertFrom-Json
    if(@($taskRecovered.PSObject.Properties).Count -ne 1 -or $taskRecovered.result -cne $taskToolResult){throw 'TOOL_RESULT_ROUNDTRIP_FAILED'}
    $taskCompat=Invoke-ModelApi '/v1/chat/completions' @{model=$taskModel;messages=$taskMessages;tools=@($taskTool);stream=$false;temperature=0;max_tokens=256} 120
    $taskCompat|ConvertTo-Json -Depth 20|Set-Content -LiteralPath (Join-Path $taskRoot 'synthetic-compatible-tool-response.json')
    $taskCompatCalls=@($taskCompat.choices[0].message.tool_calls)
    if($taskCompatCalls.Count -ne 1 -or $taskCompatCalls[0].function.name -ne 'report_fixture' -or ($taskCompatCalls[0].function.arguments|ConvertFrom-Json).nonce -ne $taskNonce){throw 'OPENAI_COMPATIBLE_STRUCTURED_TOOL_CALL_FAILED'}
    $taskLoaded=@((Invoke-ModelApi '/api/ps').models|Where-Object name -eq $taskModel|Select-Object name,size_vram,context_length)
    $taskReport=@{passed=$true;model=$taskModel;digest=$taskManifest.digest;contextTokens=16384;nativeStructuredToolCall=$true;toolResultRoundtrip=$true;openAICompatibleStructuredToolCall=$true;loaded=$taskLoaded;prompts='Synthetic nonce only, no project code or credentials';strixExecuted=$false;qualifiedForFullAssessment=$false;recordedAt=[DateTime]::UtcNow.ToString('o')}
    $taskReport|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $taskRoot 'verification.json')
    $taskReport|ConvertTo-Json -Depth 6
    }catch{
        @{passed=$false;status='verification-failed';error=$_.Exception.Message;recordedAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $taskRoot 'verification.json')
        throw
    }finally{Invoke-ModelApi '/api/generate' @{model=$taskModel;keep_alive=0} 30|Out-Null}
}
