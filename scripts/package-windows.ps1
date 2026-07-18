param(
  [switch]$SkipFrontendBuild = $false,
  [switch]$Portable = $false
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

Set-Location $RepoRoot
$Target = if ($Portable) { "windows-portable" } else { "windows-installer" }
$Arguments = @("scripts/package-windows.mjs", "--target=$Target")
if ($SkipFrontendBuild) {
  $Arguments += "--skip-frontend-build"
}
node @Arguments
exit $LASTEXITCODE
