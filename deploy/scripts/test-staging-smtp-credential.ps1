$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'staging-smtp-credential.ps1')
$mailOriginalLocal = $env:LOCALAPPDATA
$mailTestRoot = Join-Path ([IO.Path]::GetTempPath()) ('drapixai-mail-fixture-' + [Guid]::NewGuid().ToString('N'))
try {
    $env:LOCALAPPDATA = $mailTestRoot
    $mailSynthetic = 'synthetic-value-not-a-provider-key'
    $mailSecure = ConvertTo-SecureString -String $mailSynthetic -AsPlainText -Force
    Save-StagingMailCredential ([Management.Automation.PSCredential]::new('resend', $mailSecure))
    $mailPath = Join-Path (Get-StagingMailDirectory) 'smtp.credential.xml'
    if ((Get-Content -LiteralPath $mailPath -Raw).Contains($mailSynthetic)) { throw 'PLAINTEXT_SECRET_PERSISTED' }
    if ((Read-StagingMailCredential).GetNetworkCredential().Password -ne $mailSynthetic) { throw 'DPAPI_ROUNDTRIP_FAILED' }
    Write-Output 'PASS synthetic DPAPI roundtrip and no plaintext on disk'
    Assert-StagingMailAcl (Split-Path $mailPath -Parent)
    Assert-StagingMailAcl $mailPath
    Write-Output 'PASS current-user ownership and restricted directory/file access'
    $mailBeforeHash = (Get-FileHash -LiteralPath $mailPath).Hash
    $mailRefused = $false
    try { Save-StagingMailCredential ([Management.Automation.PSCredential]::new('resend', $mailSecure)) }
    catch { if ($_.Exception.Message -eq 'EXISTING_STAGING_CREDENTIAL_PRESERVED') { $mailRefused = $true } else { throw } }
    if (-not $mailRefused -or (Get-FileHash -LiteralPath $mailPath).Hash -ne $mailBeforeHash) { throw 'EXISTING_FILE_NOT_PRESERVED' }
    Write-Output 'PASS repeat installation refuses to overwrite the existing credential'
    $mailAcl = Get-Acl -LiteralPath $mailPath
    $mailAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'), 'Read', 'Allow'))
    Set-Acl -LiteralPath $mailPath -AclObject $mailAcl
    $mailRefused = $false
    try { Read-StagingMailCredential | Out-Null }
    catch { if ($_.Exception.Message -eq 'SECRET_ACCESS_TOO_OPEN') { $mailRefused = $true } else { throw } }
    if (-not $mailRefused) { throw 'OPEN_ACL_NOT_REJECTED' }
    Write-Output 'PASS widened permissions are rejected before credential decryption'
    foreach($mailPurpose in @('neon-migration','neon-runtime')) {
        $mailProfile=Get-StagingCredentialProfile $mailPurpose
        Save-StagingMailCredential ([Management.Automation.PSCredential]::new($mailProfile.User,$mailSecure)) $mailPurpose
        if((Read-StagingMailCredential $mailPurpose).GetNetworkCredential().Password -ne $mailSynthetic){throw 'DATABASE_CREDENTIAL_ROUNDTRIP_FAILED'}
        $mailDatabasePath=Join-Path (Get-StagingMailDirectory $mailPurpose) $mailProfile.File
        if((Get-Content -LiteralPath $mailDatabasePath -Raw).Contains($mailSynthetic)){throw 'PLAINTEXT_DATABASE_CREDENTIAL'}
    }
    Write-Output 'PASS separate migration/runtime encrypted credential files reuse the same access controls without touching the email credential'
    $mailProductionProfile=Get-StagingCredentialProfile 'email-production'
    Save-StagingMailCredential ([Management.Automation.PSCredential]::new('resend',$mailSecure)) 'email-production'
    $mailProductionPath=Join-Path (Get-StagingMailDirectory 'email-production') $mailProductionProfile.File
    if($mailProductionPath -eq $mailPath -or (Get-FileHash -LiteralPath $mailPath).Hash -ne $mailBeforeHash){throw 'STAGING_EMAIL_CREDENTIAL_CHANGED'}
    if((Read-StagingMailCredential 'email-production').GetNetworkCredential().Password -ne $mailSynthetic){throw 'PRODUCTION_CREDENTIAL_ROUNDTRIP_FAILED'}
    if((Get-Content -LiteralPath $mailProductionPath -Raw).Contains($mailSynthetic)){throw 'PLAINTEXT_PRODUCTION_CREDENTIAL'}
    Write-Output 'PASS separate replacement-production email profile preserves staging/database files and stores no plaintext'
    Write-Output 'Windows SMTP credential fixture passed. No real key, email or network used.'
} finally {
    $env:LOCALAPPDATA = $mailOriginalLocal
    # Delete only this randomly named, verified fixture beneath the actual temp
    # directory. Never enumerate or delete real credential paths.
    $mailResolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $mailResolvedRoot = [IO.Path]::GetFullPath($mailTestRoot)
    if (-not $mailResolvedRoot.StartsWith($mailResolvedTemp,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $mailResolvedRoot -Leaf) -notmatch '^drapixai-mail-fixture-[a-f0-9]{32}$') { throw 'FIXTURE_CLEANUP_PATH_REFUSED' }
    if (Test-Path -LiteralPath $mailResolvedRoot) { Remove-Item -LiteralPath $mailResolvedRoot -Recurse -Force }
    if ($mailSecure) { $mailSecure.Dispose() }
}
