param(
  [switch]$SkipBackendBuild
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$pythonCommand = Get-Command py -ErrorAction SilentlyContinue
if ($pythonCommand) {
  $pythonArgs = @("-3")
} else {
  $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
  $pythonArgs = @()
}

if (-not $pythonCommand) {
  throw "未找到 Python 启动器，可先安装 Python 3.12+。"
}

$sidecarDir = Join-Path $projectRoot "src-tauri\binaries"
$sidecarTarget = Join-Path $sidecarDir "prism-backend-x86_64-pc-windows-msvc.exe"

if (-not (Test-Path $sidecarDir)) {
  New-Item -ItemType Directory -Path $sidecarDir | Out-Null
}

if (-not $SkipBackendBuild) {
  & $pythonCommand.Source @pythonArgs -m PyInstaller --version *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "未检测到 PyInstaller，请先执行：py -3 -m pip install pyinstaller"
  }

  & $pythonCommand.Source @pythonArgs -m PyInstaller `
    --noconfirm `
    --clean `
    --onefile `
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
