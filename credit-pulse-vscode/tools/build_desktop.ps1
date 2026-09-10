$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'build_icon.ps1')
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
if (-not (Test-Path -LiteralPath $framework)) {
    $framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319'
}
$compiler = Join-Path $framework 'csc.exe'
$desktop = Join-Path $projectRoot 'desktop'
$outputDirectory = Join-Path $desktop 'bin'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$arguments = @(
    '/nologo', '/target:winexe', '/platform:anycpu', '/optimize+',
    "/out:$outputDirectory\CreditPulse.Desktop.exe",
    "/win32manifest:$desktop\app.manifest",
    "/reference:$framework\WPF\PresentationFramework.dll",
    "/reference:$framework\WPF\PresentationCore.dll",
    "/reference:$framework\WPF\WindowsBase.dll",
    "/reference:$framework\System.Xaml.dll",
    "/reference:$framework\System.Web.Extensions.dll",
    "$desktop\Overlay.cs"
)
& $compiler $arguments
if ($LASTEXITCODE -ne 0) { throw 'Desktop overlay compilation failed.' }
Write-Output "$outputDirectory\CreditPulse.Desktop.exe"
