param(
  [switch]$SkipBackendBuild
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

function Remove-BuildArtifact {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (Test-Path $Path) {
    Write-Host "Removing build artifact: $Path"
    # 使用 robocopy 空目录的方式清空内容，避免 Remove-Item -Recurse 在深层目录上失败
    $emptyDir = Join-Path $env:TEMP "prism_empty_$(Get-Random)"
    New-Item -ItemType Directory -Path $emptyDir -Force | Out-Null
    robocopy $emptyDir $Path /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    Remove-Item -Path $emptyDir -Force
    Remove-Item -Path $Path -Force
  }
}

$pythonCommand = $null
$pythonArgs = @()
$venvCandidates = @()

if ($env:VIRTUAL_ENV) {
  $venvCandidates += (Join-Path $env:VIRTUAL_ENV "Scripts\python.exe")
}

$venvCandidates += @(
  (Join-Path $projectRoot ".venv\Scripts\python.exe"),
  (Join-Path $projectRoot "venv\Scripts\python.exe")
)

foreach ($candidate in $venvCandidates) {
  if ($candidate -and (Test-Path $candidate)) {
    $pythonCommand = $candidate
    break
  }
}

if (-not $pythonCommand) {
  $pythonExe = Get-Command python -ErrorAction SilentlyContinue
  if ($pythonExe) {
    $pythonCommand = $pythonExe.Source
  }
}

if (-not $pythonCommand) {
  $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($pyLauncher) {
    $pythonCommand = $pyLauncher.Source
    $pythonArgs = @("-3")
  }
}

if (-not $pythonCommand) {
  throw "Python 3.12+ was not found."
}

$sidecarDir = Join-Path $projectRoot "src-tauri\binaries"
$sidecarTarget = Join-Path $sidecarDir "prism-backend-x86_64-pc-windows-msvc.exe"
$pyInstallerBuildDir = Join-Path $projectRoot "build"
$pyInstallerDistDir = Join-Path $projectRoot "dist"
$tauriTargetDir = Join-Path $projectRoot "src-tauri\target"

if (-not (Test-Path $sidecarDir)) {
  New-Item -ItemType Directory -Path $sidecarDir | Out-Null
}

Remove-BuildArtifact -Path $tauriTargetDir

if (-not $SkipBackendBuild) {
  Remove-BuildArtifact -Path $pyInstallerBuildDir
  Remove-BuildArtifact -Path $pyInstallerDistDir

  if (Test-Path $sidecarTarget) {
    Write-Host "Removing old backend sidecar: $sidecarTarget"
    Remove-Item -Path $sidecarTarget -Force
  }

  & $pythonCommand @pythonArgs -m PyInstaller --version *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller is required for the selected Python interpreter. Run: `"$pythonCommand`" $($pythonArgs -join ' ') -m pip install pyinstaller"
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

# 将 __BUILD__ 占位符替换为当前时间戳以破坏 WebView2 缓存
$indexHtml = Join-Path $projectRoot "frontend\index.html"
$buildStamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$originalContent = Get-Content $indexHtml -Raw -Encoding UTF8
$stampedContent = $originalContent -replace '__BUILD__', $buildStamp
[System.IO.File]::WriteAllText($indexHtml, $stampedContent, [System.Text.UTF8Encoding]::new($false))

npm install
try {
  npm run tauri:build
} finally {
  # 构建完成后恢复 index.html 中的占位符，避免污染源文件
  [System.IO.File]::WriteAllText($indexHtml, $originalContent, [System.Text.UTF8Encoding]::new($false))
}
