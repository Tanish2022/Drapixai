[CmdletBinding()]
param([ValidateSet('Install','Verify','Status')][string]$Action='Status')
$ErrorActionPreference='Stop'
$replacementMailAction=$Action
. (Join-Path $PSScriptRoot 'staging-smtp-credential.ps1')
$Action=$replacementMailAction

function Test-ReplacementMailCredential {
    $replacementCredential=Read-StagingMailCredential 'email-production'
    $replacementRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $replacementNode=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    $replacementRunner=Join-Path $replacementRoot 'apps/api/node_modules/ts-node/dist/bin.js'
    $replacementPayload=@{password=$replacementCredential.GetNetworkCredential().Password}|ConvertTo-Json -Compress
    try {
        Push-Location -LiteralPath (Join-Path $replacementRoot 'apps/api')
        try {
            # Same bounded fixed-target authentication probe as staging. The
            # credentials and files are separate. No message or app startup.
            $replacementPayload|& $replacementNode $replacementRunner --files 'src/scripts/verify-staging-smtp.ts'
            if($LASTEXITCODE -ne 0){throw 'REPLACEMENT_SMTP_AUTH_FAILED'}
        }finally{Pop-Location}
    }finally{$replacementPayload=$null;$replacementCredential=$null}
}

try {
    switch($Action){
        'Install' {
            $replacementSecret=Read-Host 'Paste the replacement Resend mail-only key (hidden input)' -AsSecureString
            try {
                $replacementPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($replacementSecret)
                try {
                    $replacementValue=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($replacementPointer)
                    if($replacementValue -notmatch '^re_[A-Za-z0-9_-]{16,509}$'){throw 'SMTP_KEY_FORMAT_INVALID'}
                }finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($replacementPointer);$replacementValue=$null}
                Save-StagingMailCredential ([Management.Automation.PSCredential]::new('resend',$replacementSecret)) 'email-production'
            }finally{if($replacementSecret){$replacementSecret.Dispose()}}
            Write-Output 'Replacement credential encrypted outside OneDrive. Staging, old credentials and application env files are unchanged.'
            Test-ReplacementMailCredential
        }
        'Verify' {Test-ReplacementMailCredential}
        'Status' {
            $replacementPath=Join-Path (Get-StagingMailDirectory 'email-production') 'smtp.credential.xml'
            if(Test-Path -LiteralPath $replacementPath){
                Assert-StagingMailAcl (Split-Path $replacementPath -Parent);Assert-StagingMailAcl $replacementPath
                Write-Output 'Replacement email credential exists with restricted access; authentication and app cutover not tested.'
            }else{Write-Output 'Replacement email credential is not installed.'}
        }
    }
}catch{Write-Error 'REPLACEMENT_SMTP_SETUP_FAILED. Keep the key out of chat; existing credentials are preserved.';exit 1}
