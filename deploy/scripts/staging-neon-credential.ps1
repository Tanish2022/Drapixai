[CmdletBinding()]
param([ValidateSet('InstallMigration','Verify','Status','Plan','Migrate','ProvisionRuntime','VerifyRuntime')][string]$Action='Status')
$ErrorActionPreference='Stop'
if($Action -eq 'Migrate') {
    Write-Error 'MIGRATION_REVIEWED_BACKUP_WORKFLOW_REQUIRED: use deploy/scripts/migrate-with-evidence.sh on the approved host; Plan is read-only.'
    exit 2
}
# Reuse the tested private-directory, ACL and Windows DPAPI implementation.
$neonRequestedAction=$Action
. (Join-Path $PSScriptRoot 'staging-smtp-credential.ps1')
$Action=$neonRequestedAction

function Test-NeonStagingCredential {
    $neonCredential=Read-StagingMailCredential 'neon-migration'
    $neonRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $neonNode=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    $neonRunner=Join-Path $neonRoot 'apps/api/node_modules/ts-node/dist/bin.js'
    $neonPayload=@{url=$neonCredential.GetNetworkCredential().Password}|ConvertTo-Json -Compress
    try {
        Push-Location -LiteralPath (Join-Path $neonRoot 'apps/api')
        $neonPayload|& $neonNode $neonRunner --files 'src/scripts/verify-neon-staging-database.ts'
        if($LASTEXITCODE -ne 0){throw 'DATABASE_VERIFICATION_FAILED'}
    }finally{Pop-Location;$neonPayload=$null;$neonCredential=$null}
}

function Invoke-NeonStagingOperation {
    param([ValidateSet('Plan','Migrate','ProvisionRuntime','VerifyRuntime')][string]$Operation)
    $neonCredential=Read-StagingMailCredential 'neon-migration'
    $neonRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $neonNode=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    $neonRunner=Join-Path $neonRoot 'apps/api/node_modules/ts-node/dist/bin.js'
    try {
        $neonInput=@{url=$neonCredential.GetNetworkCredential().Password;action=$Operation}
        if($Operation -in @('ProvisionRuntime','VerifyRuntime')) {
            $neonRuntimePath=Join-Path (Get-StagingMailDirectory 'neon-runtime') 'runtime.credential.xml'
            if($Operation -eq 'ProvisionRuntime' -and -not (Test-Path -LiteralPath $neonRuntimePath)) {
                # Save before provider changes: a failed SQL transaction can be
                # retried without losing or silently replacing the new password.
                $neonRandom=New-Object byte[] 32
                $neonRng=[Security.Cryptography.RandomNumberGenerator]::Create()
                try {$neonRng.GetBytes($neonRandom)}finally{$neonRng.Dispose()}
                $neonPassword=[BitConverter]::ToString($neonRandom).Replace('-','').ToLowerInvariant()
                $neonBuilder=[UriBuilder]::new($neonInput.url)
                if($neonBuilder.Host -ne 'ep-sample-staging.ap-southeast-1.aws.neon.tech' -or $neonBuilder.Path -ne '/drapixai_staging'){throw 'STAGING_TARGET_REQUIRED'}
                $neonBuilder.Host='ep-sample-staging-pooler.ap-southeast-1.aws.neon.tech'
                $neonBuilder.UserName='drapixai_staging_api'
                $neonBuilder.Password=$neonPassword
                $neonBuilder.Query='sslmode=require&sslaccept=strict'
                $neonRuntimeSecret=ConvertTo-SecureString $neonBuilder.Uri.AbsoluteUri -AsPlainText -Force
                try {Save-StagingMailCredential ([Management.Automation.PSCredential]::new('drapixai_staging_api',$neonRuntimeSecret)) 'neon-runtime'}
                finally{$neonRuntimeSecret.Dispose();[Array]::Clear($neonRandom,0,$neonRandom.Length);$neonPassword=$null;$neonBuilder=$null}
            }
            $neonRuntimeCredential=Read-StagingMailCredential 'neon-runtime'
            $neonInput.runtimeUrl=$neonRuntimeCredential.GetNetworkCredential().Password
        }
        $neonPayload=$neonInput|ConvertTo-Json -Compress
        Push-Location -LiteralPath (Join-Path $neonRoot 'apps/api')
        try {
            $neonOutput=$neonPayload|& $neonNode $neonRunner --files 'src/scripts/manage-neon-staging-database.ts'
            if($LASTEXITCODE -ne 0){throw 'DATABASE_OPERATION_FAILED'}
            # Only the operator's safe structured result is retained as evidence.
            $neonResult=$neonOutput|ConvertFrom-Json
            if(-not $neonResult.passed){throw 'DATABASE_OPERATION_FAILED'}
            $neonEvidence=Join-Path $neonRoot 'runtime/launch-evidence'
            $neonReport=Join-Path $neonEvidence ('neon-staging-'+$Operation.ToLowerInvariant()+'-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff')+'.json')
            $neonResult|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $neonReport -Encoding UTF8
            Write-Output $neonOutput
        }finally{Pop-Location}
    }finally{$neonPayload=$null;$neonInput=$null;$neonCredential=$null;$neonRuntimeCredential=$null}
}

try {
    switch($Action){
        'InstallMigration' {
            $neonSecret=Read-Host 'Paste the DIRECT staging migration connection URL (hidden input)' -AsSecureString
            try {
                $neonPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($neonSecret)
                try {
                    $neonValue=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($neonPointer)
                    $neonUri=[Uri]$neonValue
                    if($neonUri.Scheme -notin @('postgres','postgresql') -or $neonUri.Host -ne 'ep-sample-staging.ap-southeast-1.aws.neon.tech' -or
                        $neonUri.AbsolutePath -ne '/drapixai_staging' -or $neonUri.UserInfo -notmatch '^neondb_owner:.+' -or
                        $neonUri.Query -notmatch '[?&]sslmode=(require|verify-ca|verify-full)(&|$)') {throw 'STAGING_TARGET_REQUIRED'}
                }finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($neonPointer);$neonValue=$null;$neonUri=$null}
                Save-StagingMailCredential ([Management.Automation.PSCredential]::new('neondb_owner',$neonSecret)) 'neon-migration'
            }finally{if($neonSecret){$neonSecret.Dispose()}}
            Write-Output 'Staging migration URL encrypted outside OneDrive. Main application env files are unchanged.'
            Test-NeonStagingCredential
        }
        'Verify' {Test-NeonStagingCredential}
        'Migrate' {Invoke-NeonStagingOperation 'Migrate'}
        'Plan' {Invoke-NeonStagingOperation 'Plan'}
        'ProvisionRuntime' {Invoke-NeonStagingOperation 'ProvisionRuntime'}
        'VerifyRuntime' {Invoke-NeonStagingOperation 'VerifyRuntime'}
        'Status' {
            $neonDirectory=Get-StagingMailDirectory 'neon-migration'
            $neonFile=Join-Path $neonDirectory 'migration.credential.xml'
            if(Test-Path -LiteralPath $neonFile){Assert-StagingMailAcl $neonDirectory;Assert-StagingMailAcl $neonFile;Write-Output 'Private staging migration credential exists; authentication not tested.'}
            else{Write-Output 'Private staging migration credential is not installed.'}
        }
    }
}catch{Write-Error 'NEON_STAGING_CREDENTIAL_SETUP_FAILED. Keep the connection URL out of chat.';exit 1}
