param(
  [switch]$SkipInstall = $false,
  [switch]$SkipFrontendBuild = $false,
  [switch]$SkipBundle = $false
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
  param([string]$Message)
  Write-Host "  [OK] $Message" -ForegroundColor Green
}

function Write-Warn {
  param([string]$Message)
  Write-Host "  [WARN] $Message" -ForegroundColor Yellow
}

function Write-Fail {
  param([string]$Message)
  Write-Host "  [FAIL] $Message" -ForegroundColor Red
}

function Get-CommandPathOrNull {
  param([string]$CommandName)

  $command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    return $null
  }

  return $command.Source
}

function Require-Command {
  param(
    [string]$CommandName,
    [string]$InstallHint
  )

  $commandPath = Get-CommandPathOrNull -CommandName $CommandName
  if ($null -eq $commandPath) {
    $script:PreflightFailed = $true
    Write-Fail "$CommandName not found. $InstallHint"
    return
  }

  Write-Ok "$CommandName found at $commandPath"
}

function Test-WebView2Installed {
  $regPaths = @(
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
  )

  foreach ($path in $regPaths) {
    if (Test-Path $path) {
      $item = Get-ItemProperty -Path $path -ErrorAction SilentlyContinue
      if ($null -ne $item -and $item.pv) {
        return $item.pv
      }
    }
  }

  return $null
}

function Test-VsBuildTools {
  $vswhereDefault = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path $vswhereDefault) {
    $installPath = & $vswhereDefault -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($installPath)) {
      return $installPath.Trim()
    }
  }

  $clCommand = Get-CommandPathOrNull -CommandName "cl.exe"
  if ($null -ne $clCommand) {
    return $clCommand
  }

  return $null
}

function Invoke-Checked {
  param(
    [string]$Label,
    [string]$FilePath,
    [string[]]$Arguments
  )

  Write-Step $Label
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE."
  }
}

$PreflightFailed = $false

Write-Step "Checking operating system"
if ($env:OS -ne "Windows_NT") {
  throw "This helper is intended to run on Windows PowerShell / PowerShell on Windows."
}
Write-Ok "Windows environment detected"

Write-Step "Checking required commands"
Require-Command -CommandName "node" -InstallHint "Install Node.js 20+."
Require-Command -CommandName "pnpm" -InstallHint "Enable Corepack and activate pnpm 10.x, for example with 'corepack enable' and 'corepack prepare pnpm@10.12.1 --activate'."
Require-Command -CommandName "rustc" -InstallHint "Install the Rust stable toolchain from https://rustup.rs/."
Require-Command -CommandName "cargo" -InstallHint "Install the Rust stable toolchain from https://rustup.rs/."

Write-Step "Checking Windows-specific dependencies"
$vsBuildTools = Test-VsBuildTools
if ($null -eq $vsBuildTools) {
  $PreflightFailed = $true
  Write-Fail "MSVC build tools not found. Install Visual Studio Build Tools with the Desktop C++ workload."
} else {
  Write-Ok "MSVC toolchain detected at $vsBuildTools"
}

$webView2Version = Test-WebView2Installed
if ($null -eq $webView2Version) {
  Write-Warn "WebView2 Runtime not detected. The app may still build, but the packaged app should be validated after installing WebView2."
} else {
  Write-Ok "WebView2 Runtime detected ($webView2Version)"
}

Write-Step "Printing tool versions"
node --version
pnpm --version
rustc --version
cargo --version

if ($PreflightFailed) {
  throw "Windows build preflight failed. Fix the missing dependencies above and run the script again."
}

if (-not $SkipInstall) {
  Invoke-Checked -Label "Installing JavaScript dependencies" -FilePath "pnpm" -Arguments @("install")
} else {
  Write-Step "Skipping dependency installation"
  Write-Ok "SkipInstall requested"
}

if (-not $SkipFrontendBuild) {
  Invoke-Checked -Label "Building frontend" -FilePath "pnpm" -Arguments @("build")
} else {
  Write-Step "Skipping frontend build"
  Write-Ok "SkipFrontendBuild requested"
}

if (-not $SkipBundle) {
  Invoke-Checked -Label "Building Windows NSIS bundle" -FilePath "pnpm" -Arguments @("tauri", "build", "--bundles", "nsis")
} else {
  Write-Step "Skipping Windows bundle build"
  Write-Ok "SkipBundle requested"
}

Write-Step "Windows build check complete"
Write-Ok "ArkLine Windows preflight and build flow finished successfully"
