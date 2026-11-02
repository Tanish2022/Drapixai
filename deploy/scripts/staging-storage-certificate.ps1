[CmdletBinding()]
param(
    [ValidateSet('Plan','Status','Install')][string]$Action = 'Plan',
    [switch]$ConfirmNewStorageIdentity
)
$ErrorActionPreference = 'Stop'
$storageCaSubject = 'CN=DrapixAI-CpuStaging-CA-20261024'
$storageLeafSubject = 'CN=DrapixAI-CpuStaging-Windows-20261024'
$storageRepo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
# Only public certificates/metadata are written here. Private keys stay in CNG.
$storagePublicDir = Join-Path $storageRepo 'runtime/launch-evidence/storage-identity-public-20261024'

function Assert-StorageCngKey($Certificate) {
    $storageRsa = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($Certificate)
    try {
        if ($storageRsa -isnot [Security.Cryptography.RSACng] -or $storageRsa.KeySize -lt 3072 -or
            $storageRsa.Key.ExportPolicy -ne [Security.Cryptography.CngExportPolicies]::None) {
            throw 'STORAGE_KEY_PROTECTION_INVALID'
        }
    } finally { if ($storageRsa) { $storageRsa.Dispose() } }
}
function Write-StoragePublicPem($Certificate, [string]$Name) {
    $storagePublicBytes = $Certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $storageBase64 = [Convert]::ToBase64String($storagePublicBytes, [Base64FormattingOptions]::InsertLineBreaks)
    [IO.File]::WriteAllText((Join-Path $storagePublicDir $Name), "-----BEGIN CERTIFICATE-----`n$storageBase64`n-----END CERTIFICATE-----`n", [Text.Encoding]::ASCII)
}
try {
    if ($Action -eq 'Plan') {
        @{action='plan-only';caSubject=$storageCaSubject;leafSubject=$storageLeafSubject;store='CurrentUser/My';provider='Microsoft Software Key Storage Provider';privateKeyExport='NonExportable';rsaBits=3072;caDays=90;leafDays=30;cloudChanges=0;certificatesCreated=0} | ConvertTo-Json -Compress
        return
    }
    $storageExisting = @(Get-ChildItem 'Cert:\CurrentUser\My' | Where-Object { $_.Subject -in @($storageCaSubject,$storageLeafSubject) })
    if ($Action -eq 'Status') {
        @{action='status-only';matchingCertificates=$storageExisting.Count;publicBundleExists=(Test-Path -LiteralPath $storagePublicDir);certificatesCreated=0;cloudChanges=0} | ConvertTo-Json -Compress
        return
    }
    if (-not $ConfirmNewStorageIdentity) { throw 'EXPLICIT_STORAGE_IDENTITY_CONFIRMATION_REQUIRED' }
    if ($storageExisting.Count -gt 0 -or (Test-Path -LiteralPath $storagePublicDir)) { throw 'EXISTING_STORAGE_IDENTITY_PRESERVED' }
    $storageCheckPath = [IO.Path]::GetFullPath($storagePublicDir)
    while ($storageCheckPath -and $storageCheckPath.StartsWith(([IO.Path]::GetFullPath($storageRepo)),[StringComparison]::OrdinalIgnoreCase)) {
        if ((Test-Path -LiteralPath $storageCheckPath) -and ((Get-Item -LiteralPath $storageCheckPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'PUBLIC_BUNDLE_REPARSE_PATH_REFUSED' }
        $storageCheckPath = [IO.Path]::GetDirectoryName($storageCheckPath)
    }
    $storageNow = Get-Date
    $storageCommon = @{Type='Custom';Provider='Microsoft Software Key Storage Provider';KeyAlgorithm='RSA';KeyLength=3072;HashAlgorithm='SHA256';KeyExportPolicy='NonExportable';CertStoreLocation='Cert:\CurrentUser\My';NotBefore=$storageNow.AddMinutes(-5)}
    $storageCa = New-SelfSignedCertificate @storageCommon -Subject $storageCaSubject -FriendlyName 'DrapixAI CPU staging CA 20261024' -NotAfter $storageNow.AddDays(90) -KeyUsage CertSign,CRLSign -TextExtension @('2.5.29.19={critical}{text}CA=1&pathlength=0')
    Assert-StorageCngKey $storageCa
    $storageLeaf = New-SelfSignedCertificate @storageCommon -Subject $storageLeafSubject -FriendlyName 'DrapixAI CPU staging Windows 20261024' -NotAfter $storageNow.AddDays(30) -Signer $storageCa -KeyUsage DigitalSignature -TextExtension @('2.5.29.19={critical}{text}CA=0','2.5.29.37={text}1.3.6.1.5.5.7.3.2')
    Assert-StorageCngKey $storageLeaf
    $storageChain = New-Object Security.Cryptography.X509Certificates.X509Chain
    try {
        $storageChain.ChainPolicy.RevocationMode = [Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
        $storageChain.ChainPolicy.VerificationFlags = [Security.Cryptography.X509Certificates.X509VerificationFlags]::AllowUnknownCertificateAuthority
        [void]$storageChain.ChainPolicy.ExtraStore.Add($storageCa)
        if (-not $storageChain.Build($storageLeaf) -or $storageChain.ChainElements.Count -ne 2 -or $storageChain.ChainElements[1].Certificate.Thumbprint -ne $storageCa.Thumbprint) { throw 'STORAGE_CERTIFICATE_CHAIN_INVALID' }
    } finally { $storageChain.Dispose() }
    New-Item -ItemType Directory -Path $storagePublicDir | Out-Null
    Write-StoragePublicPem $storageCa 'ca-public.pem'
    Write-StoragePublicPem $storageLeaf 'leaf-public.pem'
    $storageMetadata = @{caSubject=$storageCa.Subject;caThumbprint=$storageCa.Thumbprint;caExpires=$storageCa.NotAfter.ToUniversalTime().ToString('o');leafSubject=$storageLeaf.Subject;leafIssuer=$storageLeaf.Issuer;leafSerial=$storageLeaf.SerialNumber;leafThumbprint=$storageLeaf.Thumbprint;leafExpires=$storageLeaf.NotAfter.ToUniversalTime().ToString('o');privateKeys='Windows CurrentUser/My CNG; non-exportable';cloudChanges=0}
    $storageMetadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $storagePublicDir 'metadata.json') -Encoding UTF8
    @{passed=$true;certificatesCreated=2;privateKeyExported=$false;globalTrustedRootChanged=$false;cloudChanges=0;publicBundleDirectory=$storagePublicDir} | ConvertTo-Json -Compress
} catch {
    # Do not print exception objects or remove partially created private keys.
    # A partial install requires status/review, never a blind retry/overwrite.
    Write-Error 'STAGING_STORAGE_CERTIFICATE_SETUP_FAILED. Existing certificates are preserved. Run Status and report only this label.'
    exit 1
}
