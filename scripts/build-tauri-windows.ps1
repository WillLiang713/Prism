param(
  [switch]$SkipBackendBuild
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$venvPython = Join-Path $projectRoot "venv\Scripts\python.exe"
$pythonCommand = $null
$pythonArgs = @()

if (Test-Path $venvPython) {
  $pythonCommand = $venvPython
} else {
  $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($pyLauncher) {
    $pythonCommand = $pyLauncher.Source
    $pythonArgs = @("-3")
  } else {
    $pythonExe = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonExe) {
      $pythonCommand = $pythonExe.Source
    }
  }
}

if (-not $pythonCommand) {
  throw "Python 3.12+ was not found."
}

$sidecarDir = Join-Path $projectRoot "src-tauri\binaries"
$sidecarTarget = Join-Path $sidecarDir "prism-backend-x86_64-pc-windows-msvc.exe"

if (-not (Test-Path $sidecarDir)) {
  New-Item -ItemType Directory -Path $sidecarDir | Out-Null
}

if (-not $SkipBackendBuild) {
  & $pythonCommand @pythonArgs -m PyInstaller --version *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller is required. Run: .\venv\Scripts\python.exe -m pip install pyinstaller"
  }

  & $pythonCommand @pythonArgs -m PyInstaller `
    --noconfirm `
    --clean `
    --onefile `
    --noconsole `
    --name prism-backend `
    --add-data "tools.json;." `
    --hidden-import uvicorn.logging `
    --hidden-import uvicorn.loops.auto `
    --hidden-import uvicorn.protocols.http.auto `
    --hidden-import uvicorn.protocols.websockets.auto `
    --hidden-import uvicorn.lifespan.on `
    server.py

  Copy-Item -Force `
    (Join-Path $projectRoot "dist\prism-backend.exe") `
    $sidecarTarget
}

npm install
npm run tauri:build
