param(
  [switch]$SkipFrontendBuild = $false
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

Set-Location $RepoRoot

if (-not $SkipFrontendBuild) {
  pnpm build
}

pnpm tauri build --bundles nsis
