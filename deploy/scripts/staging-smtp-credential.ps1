[CmdletBinding()]
param([ValidateSet('Install', 'Verify', 'Status', 'SendTests')][string]$Action = 'Status', [switch]$ConfirmTestEmails)

$ErrorActionPreference = 'Stop'

function Get-StagingCredentialProfile([ValidateSet('email','email-production','neon-migration','neon-runtime')][string]$Purpose = 'email') {
    switch ($Purpose) {
        'email' { return @{ Directory='cpu-staging-email'; File='smtp.credential.xml'; User='resend' } }
        'email-production' { return @{ Directory='production-email'; File='smtp.credential.xml'; User='resend' } }
        'neon-migration' { return @{ Directory='cpu-staging-database'; File='migration.credential.xml'; User='neondb_owner' } }
        'neon-runtime' { return @{ Directory='cpu-staging-database'; File='runtime.credential.xml'; User='drapixai_staging_api' } }
    }
}

function Get-StagingMailDirectory([ValidateSet('email','email-production','neon-migration','neon-runtime')][string]$Purpose = 'email') {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'WINDOWS_REQUIRED' }
    if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA_REQUIRED' }
    $mailProfile = Get-StagingCredentialProfile $Purpose
    $mailDirectory = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA ('DrapixAI/secrets/' + $mailProfile.Directory)))
    foreach ($mailCloudRoot in @($env:OneDrive, $env:OneDriveCommercial, $env:OneDriveConsumer)) {
        if ($mailCloudRoot -and $mailDirectory.StartsWith(([IO.Path]::GetFullPath($mailCloudRoot).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) {
            throw 'SYNCED_SECRET_PATH_REFUSED'
        }
    }
    $mailAncestor = $mailDirectory
    while ($mailAncestor) {
        if (Test-Path -LiteralPath $mailAncestor) {
            if ((Get-Item -LiteralPath $mailAncestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REPARSE_SECRET_PATH_REFUSED' }
        }
        $mailParent = [IO.Path]::GetDirectoryName($mailAncestor)
        if ($mailParent -eq $mailAncestor) { break }
        $mailAncestor = $mailParent
    }
    return $mailDirectory
}

function Assert-StagingMailAcl([string]$Path) {
    $mailSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $mailAllowed = @($mailSid.Value, 'S-1-5-18')
    $mailAcl = Get-Acl -LiteralPath $Path
    if ($mailAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $mailSid.Value) { throw 'SECRET_OWNER_INVALID' }
    $mailRules = $mailAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
    foreach ($mailRule in $mailRules) {
        if ($mailRule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $mailRule.IdentityReference.Value -notin $mailAllowed) {
            throw 'SECRET_ACCESS_TOO_OPEN'
        }
    }
    if (-not ($mailRules | Where-Object { $_.IdentityReference.Value -eq $mailSid.Value -and $_.AccessControlType -eq 'Allow' })) { throw 'SECRET_USER_ACCESS_MISSING' }
}

function Initialize-StagingMailDirectory([ValidateSet('email','email-production','neon-migration','neon-runtime')][string]$Purpose = 'email') {
    $mailDirectory = Get-StagingMailDirectory $Purpose
    if (-not (Test-Path -LiteralPath $mailDirectory)) {
        New-Item -ItemType Directory -Path $mailDirectory | Out-Null
        $mailSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $mailAcl = New-Object Security.AccessControl.DirectorySecurity
        $mailAcl.SetOwner($mailSid)
        $mailAcl.SetAccessRuleProtection($true, $false)
        foreach ($mailIdentity in @($mailSid, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
            $mailAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($mailIdentity, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'))
        }
        Set-Acl -LiteralPath $mailDirectory -AclObject $mailAcl
    }
    Assert-StagingMailAcl $mailDirectory
    return $mailDirectory
}

function Save-StagingMailCredential([Management.Automation.PSCredential]$Credential, [ValidateSet('email','email-production','neon-migration','neon-runtime')][string]$Purpose = 'email') {
    $mailProfile = Get-StagingCredentialProfile $Purpose
    $mailDirectory = Initialize-StagingMailDirectory $Purpose
    $mailPath = Join-Path $mailDirectory $mailProfile.File
    if (Test-Path -LiteralPath $mailPath) { throw 'EXISTING_STAGING_CREDENTIAL_PRESERVED' }
    if ($Credential.UserName -ne $mailProfile.User) { throw 'STAGING_CREDENTIAL_USERNAME_INVALID' }
    $mailTemporary = Join-Path $mailDirectory ('install-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    try {
        # Windows Export-Clixml protects SecureString using this user's DPAPI key.
        # Only the private directory exists before any credential is written.
        $Credential | Export-Clixml -LiteralPath $mailTemporary
        Assert-StagingMailAcl $mailTemporary
        Move-Item -LiteralPath $mailTemporary -Destination $mailPath
        Assert-StagingMailAcl $mailPath
    } finally {
        if (Test-Path -LiteralPath $mailTemporary) { Remove-Item -LiteralPath $mailTemporary }
    }
}

function Read-StagingMailCredential([ValidateSet('email','email-production','neon-migration','neon-runtime')][string]$Purpose = 'email') {
    $mailProfile = Get-StagingCredentialProfile $Purpose
    $mailDirectory = Get-StagingMailDirectory $Purpose
    $mailPath = Join-Path $mailDirectory $mailProfile.File
    foreach ($mailItem in @($mailDirectory, $mailPath)) {
        if (-not (Test-Path -LiteralPath $mailItem)) { throw 'STAGING_SMTP_CREDENTIAL_NOT_INSTALLED' }
        if ((Get-Item -LiteralPath $mailItem -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REPARSE_SECRET_PATH_REFUSED' }
        Assert-StagingMailAcl $mailItem
    }
    $mailCredential = Import-Clixml -LiteralPath $mailPath
    if ($mailCredential -isnot [Management.Automation.PSCredential] -or $mailCredential.UserName -ne $mailProfile.User) { throw 'STAGING_CREDENTIAL_INVALID' }
    return $mailCredential
}

function Invoke-StagingMailCommand([ValidateSet('verify-staging-smtp.ts', 'send-staging-email-tests.ts')][string]$Script = 'verify-staging-smtp.ts') {
    $mailCredential = Read-StagingMailCredential
    $mailWorkspace = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $mailNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    $mailTsNode = Join-Path $mailWorkspace 'apps/api/node_modules/ts-node/dist/bin.js'
    if (-not (Test-Path -LiteralPath $mailNode) -or -not (Test-Path -LiteralPath $mailTsNode)) { throw 'EMAIL_TEST_RUNTIME_UNAVAILABLE' }
    $mailPayload = @{ password = $mailCredential.GetNetworkCredential().Password } | ConvertTo-Json -Compress
    try {
        Push-Location -LiteralPath (Join-Path $mailWorkspace 'apps/api')
        # Stdin keeps the key out of shell history, command arguments and disk.
        if ($Script -eq 'send-staging-email-tests.ts') {
            if (-not $ConfirmTestEmails) { throw 'EXPLICIT_TEST_APPROVAL_REQUIRED' }
            $mailPayload | & $mailNode $mailTsNode --files 'src/scripts/send-staging-email-tests.ts' --send '--approved-recipient=owner-approved@example.invalid'
        } else {
            $mailPayload | & $mailNode $mailTsNode --files 'src/scripts/verify-staging-smtp.ts'
        }
        if ($LASTEXITCODE -ne 0) { throw 'STAGING_SMTP_VERIFY_FAILED' }
    } finally {
        Pop-Location
        $mailPayload = $null
        $mailCredential = $null
    }
}

function Test-StagingMailConnection { Invoke-StagingMailCommand }

# Dot-sourcing exposes helpers to synthetic tests without reading a real secret.
if ($MyInvocation.InvocationName -eq '.') { return }
try {
    switch ($Action) {
        'Install' {
            $mailSecret = Read-Host 'Paste the CPU staging Resend key (hidden input)' -AsSecureString
            try {
                $mailValidationPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($mailSecret)
                try {
                    $mailValidationValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($mailValidationPointer)
                    if ($mailValidationValue -notmatch '^re_[A-Za-z0-9_-]{16,509}$') { throw 'SMTP_KEY_FORMAT_INVALID' }
                } finally {
                    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($mailValidationPointer)
                    $mailValidationValue = $null
                }
                Save-StagingMailCredential ([Management.Automation.PSCredential]::new('resend', $mailSecret))
            }
            finally { if ($mailSecret) { $mailSecret.Dispose() } }
            Write-Output 'Staging credential saved with Windows user encryption. Existing production settings are unchanged.'
            Test-StagingMailConnection
        }
        'Verify' { Test-StagingMailConnection }
        'SendTests' {
            if (-not $ConfirmTestEmails) { throw 'EXPLICIT_TEST_APPROVAL_REQUIRED' }
            Invoke-StagingMailCommand 'send-staging-email-tests.ts'
        }
        'Status' {
            $mailStatusPath = Join-Path (Get-StagingMailDirectory) 'smtp.credential.xml'
            if (Test-Path -LiteralPath $mailStatusPath) {
                # Status checks metadata only, never decrypts the credential.
                Assert-StagingMailAcl (Split-Path $mailStatusPath -Parent)
                Assert-StagingMailAcl $mailStatusPath
                Write-Output 'Staging SMTP credential file exists with restricted access; authentication not tested.'
            } else { Write-Output 'Staging SMTP credential is not installed.' }
        }
    }
} catch {
    Write-Error 'STAGING_SMTP_SETUP_FAILED. Existing files are preserved. Keep credentials out of chat.'
    exit 1
}
