param(
  [switch]$SkipFrontendBuild = $false,
  [switch]$Portable = $false
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

Set-Location $RepoRoot

if (-not $SkipFrontendBuild) {
  pnpm build
}

if ($Portable) {
  pnpm tauri build --no-bundle
  Write-Host ""
  Write-Host "Portable executable output:"
  Write-Host "  src-tauri/target/release/ArkLine.exe"
  Write-Host ""
  Write-Host "Note: the target machine still needs Microsoft WebView2 Runtime."
  exit $LASTEXITCODE
}

pnpm tauri build --bundles nsis

Write-Host ""
Write-Host "Installer output:"
Write-Host "  src-tauri/target/release/bundle/nsis/"
