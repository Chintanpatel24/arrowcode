# ArrowCode installer — Windows (PowerShell 5+ / PowerShell 7)
# Usage:
#   irm https://raw.githubusercontent.com/YOUR_USER/arrowcode/main/install.ps1 | iex
#   .\install.ps1
#   .\install.ps1 -Dir "$env:USERPROFILE\arrowcode" -Setup

[CmdletBinding()]
param(
  [string]$Dir = $(if ($env:ARROWCODE_DIR) { $env:ARROWCODE_DIR } else { Join-Path $env:USERPROFILE ".arrowcode-app" }),
  [string]$Repo = $(if ($env:ARROWCODE_REPO) { $env:ARROWCODE_REPO } else { "https://github.com/Chintanpatel24/arrowcode.git" }),
  [string]$Branch = $(if ($env:ARROWCODE_BRANCH) { $env:ARROWCODE_BRANCH } else { "main" }),
  [switch]$NoLink,
  [switch]$Setup,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$Version = "1.0.0"

function Show-Banner {
  Write-Host @"

     █████╗ ██████╗ ██████╗  ██████╗ ██╗    ██╗ ██████╗ ██████╗ ██████╗ ███████╗
    ██╔══██╗██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔═══██╗██╔══██╗██╔════╝
    ███████║██████╔╝██████╔╝██║   ██║██║ █╗ ██║██║     ██║   ██║██║  ██║█████╗  
    ██╔══██║██╔══██╗██╔══██╗██║   ██║██║███╗██║██║     ██║   ██║██║  ██║██╔══╝  
    ██║  ██║██║  ██║██║  ██║╚██████╔╝╚███╔███╔╝╚██████╗╚██████╔╝██████╔╝███████╗
    ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝  ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝

         multi-agent swarm coding harness  ·  plan → confirm → ship

"@ -ForegroundColor Cyan
}

function Write-Ok($msg) { Write-Host "[ok] $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Err($msg) { Write-Host "[err] $msg" -ForegroundColor Red }

if ($Help) {
  Write-Host @"
ArrowCode installer v$Version

  -Dir <path>     Install directory
  -Repo <url>     Git clone URL
  -Branch <name>  Git branch (default main)
  -NoLink         Skip user PATH shim
  -Setup          Run interactive API setup after install
"@
  exit 0
}

Show-Banner
Write-Info "ArrowCode installer v$Version"

# Bun
$bun = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bun) {
  Write-Info "Installing Bun..."
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
  $env:Path = "$env:USERPROFILE\.bun\bin;" + $env:Path
  $bun = Get-Command bun -ErrorAction SilentlyContinue
  if (-not $bun) { Write-Err "Bun install failed. See https://bun.sh"; exit 1 }
}
Write-Ok "Bun $(bun --version)"

# Resolve local repo if script lives inside it
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LocalPkg = Join-Path $ScriptDir "package.json"
if ((Test-Path $LocalPkg) -and -not $env:ARROWCODE_DIR) {
  $Dir = $ScriptDir
  Write-Info "Detected local repo — installing in-place: $Dir"
}

if (Test-Path (Join-Path $Dir ".git")) {
  Write-Info "Updating $Dir"
  Push-Location $Dir
  try {
    git fetch --depth 1 origin $Branch 2>$null
    git checkout $Branch 2>$null
    git pull --ff-only origin $Branch 2>$null
  } catch { Write-Info "git update skipped" }
  Pop-Location
} elseif (Test-Path (Join-Path $Dir "package.json")) {
  Write-Info "Using existing $Dir"
} else {
  Write-Info "Cloning $Repo → $Dir"
  $parent = Split-Path -Parent $Dir
  if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
  if (Get-Command git -ErrorAction SilentlyContinue) {
    try {
      git clone --depth 1 --branch $Branch $Repo $Dir
    } catch {
      if (Test-Path $LocalPkg) {
        Write-Info "Clone failed — copying local files"
        New-Item -ItemType Directory -Path $Dir -Force | Out-Null
        Copy-Item -Path (Join-Path $ScriptDir "*") -Destination $Dir -Recurse -Force
        Remove-Item -Recurse -Force (Join-Path $Dir "node_modules") -ErrorAction SilentlyContinue
      } else { throw }
    }
  } else {
    if (-not (Test-Path $LocalPkg)) { Write-Err "git not found"; exit 1 }
    New-Item -ItemType Directory -Path $Dir -Force | Out-Null
    Copy-Item -Path (Join-Path $ScriptDir "*") -Destination $Dir -Recurse -Force
    Remove-Item -Recurse -Force (Join-Path $Dir "node_modules") -ErrorAction SilentlyContinue
  }
}

Set-Location $Dir
Write-Info "bun install"
bun install
Write-Ok "Dependencies installed"

$launcher = Join-Path $Dir "bin\arrowcode.cmd"
@"
@echo off
setlocal
set "ROOT=%~dp0.."
bun "%ROOT%\src\index.ts" %*
"@ | Set-Content -Path $launcher -Encoding ASCII
Write-Ok "Wrote $launcher"

Write-Info "Bootstrapping user home from defaults/ → ~/.arrowcode"
bun run src/index.ts --init
Write-Ok "User data ready (created only if missing)"

if (-not $NoLink) {
  $shimDir = Join-Path $env:USERPROFILE ".local\bin"
  if (-not (Test-Path $shimDir)) { New-Item -ItemType Directory -Path $shimDir | Out-Null }
  $shim = Join-Path $shimDir "arrowcode.cmd"
  @"
@echo off
bun "$Dir\src\index.ts" %*
"@ | Set-Content -Path $shim -Encoding ASCII
  $ac = Join-Path $shimDir "ac.cmd"
  Copy-Item $shim $ac -Force
  Write-Ok "Shims: $shim"
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($userPath -notlike "*$shimDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$shimDir;$userPath", "User")
    $env:Path = "$shimDir;" + $env:Path
    Write-Ok "Added $shimDir to user PATH (restart shell)"
  }
}

if ($Setup) {
  Write-Info "Running setup"
  bun run src/index.ts --setup
}

Write-Host ""
Write-Host "────────────────────────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host "  ArrowCode installed" -ForegroundColor Cyan
Write-Host "────────────────────────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host "  Location : $Dir"
Write-Host "  Run      : arrowcode   or   bun $Dir\src\index.ts"
Write-Host ""
Write-Host "  Next:"
Write-Host "    arrowcode --setup"
Write-Host "    cd your-project; arrowcode"
Write-Host ""
