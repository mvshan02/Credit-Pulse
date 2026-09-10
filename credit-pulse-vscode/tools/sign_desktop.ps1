param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9A-Fa-f]{40}$')]
    [string]$CertificateThumbprint,
    [string]$TimestampUrl = 'http://timestamp.digicert.com'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$binary = Join-Path $projectRoot 'desktop\bin\CreditPulse.Desktop.exe'
if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw 'Build the desktop companion before signing it.' }

$certificate = Get-ChildItem -LiteralPath "Cert:\CurrentUser\My\$CertificateThumbprint" -ErrorAction SilentlyContinue
if (-not $certificate) { throw 'The requested certificate is not in CurrentUser\My.' }
if (-not $certificate.HasPrivateKey) { throw 'The signing certificate has no accessible private key.' }
if ($certificate.NotAfter -le (Get-Date)) { throw 'The signing certificate has expired.' }
$codeSigningOid = '1.3.6.1.5.5.7.3.3'
if (-not ($certificate.Extensions.EnhancedKeyUsages.ObjectId.Value -contains $codeSigningOid)) {
    throw 'The certificate is not valid for code signing.'
}

$sdkRoots = @('C:\Program Files (x86)\Windows Kits\10\bin', 'C:\Program Files\Windows Kits\10\bin')
$signTool = Get-ChildItem -LiteralPath $sdkRoots -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Directory.Name -eq 'x64' } | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signTool) { throw 'SignTool was not found. Install the current Windows SDK signing tools.' }

& $signTool.FullName sign /sha1 $CertificateThumbprint /s My /fd SHA256 /tr $TimestampUrl /td SHA256 /d 'Credit Pulse Desktop Overlay' $binary
if ($LASTEXITCODE -ne 0) { throw 'SignTool failed to sign the desktop companion.' }
& $signTool.FullName verify /pa /all /v $binary
if ($LASTEXITCODE -ne 0) { throw 'Authenticode trust verification failed.' }

$signature = Get-AuthenticodeSignature -LiteralPath $binary
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $CertificateThumbprint.ToUpperInvariant()) {
    throw "Unexpected signature status: $($signature.Status)"
}
Write-Output "Signed and verified: $binary"
