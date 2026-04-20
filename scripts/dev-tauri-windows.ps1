param(
  [string]$BackendHost = "0.0.0.0",
  [int]$Port = 33100
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

function Resolve-PythonFromPyLauncher {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PyLauncherPath
  )

  try {
    $resolved = & $PyLauncherPath -3 -c "import sys; print(sys.executable)" 2>$null
    $resolved = ($resolved | Select-Object -First 1).ToString().Trim()
    if ($resolved -and (Test-Path $resolved)) {
      return $resolved
    }
  } catch {
    # ignore resolution failure and let caller decide fallback
  }

  return $null
}

function Stop-ProcessTree {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId
  )

  try {
    & taskkill /PID $ProcessId /T /F *> $null
  } catch {
    try {
      Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    } catch {
      # ignore cleanup failure
    }
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
    $resolvedPython = Resolve-PythonFromPyLauncher -PyLauncherPath $pyLauncher.Source
    if ($resolvedPython) {
      $pythonCommand = $resolvedPython
    } else {
      $pythonCommand = $pyLauncher.Source
      $pythonArgs = @("-3")
    }
  }
}

if (-not $pythonCommand) {
  throw "Python 3.12+ was not found."
}

$tauriCli = Join-Path $projectRoot "node_modules\.bin\tauri.cmd"
if (-not (Test-Path $tauriCli)) {
  throw "Tauri CLI was not found. Run: npm install"
}

$devLogDir = Join-Path $projectRoot "logs"
if (-not (Test-Path $devLogDir)) {
  New-Item -ItemType Directory -Path $devLogDir | Out-Null
}

$stdoutLog = Join-Path $devLogDir "desktop-dev-backend.stdout.log"
$stderrLog = Join-Path $devLogDir "desktop-dev-backend.stderr.log"
$tauriDevConfig = Join-Path $projectRoot "src-tauri\tauri.dev.conf.json"
$backendArgs = @($pythonArgs + @("server.py", "--host", $BackendHost, "--port", "$Port"))
$backendProcess = $null
$apiHost = if ($BackendHost -eq "0.0.0.0") { "127.0.0.1" } else { $BackendHost }
$apiBase = "http://${apiHost}:$Port"
$tauriExitCode = 0

Write-Host "Starting desktop backend on http://${BackendHost}:$Port"
Write-Host "Desktop shell will connect to $apiBase"
Write-Host "Using Python interpreter: $pythonCommand"
$backendProcess = Start-Process `
  -FilePath $pythonCommand `
  -ArgumentList $backendArgs `
  -WorkingDirectory $projectRoot `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru `
  -WindowStyle Hidden

try {
  $deadline = (Get-Date).AddSeconds(15)
  $backendReady = $false

  while ((Get-Date) -lt $deadline) {
    if ($backendProcess.HasExited) {
      throw "Desktop backend exited early. Check logs: $stdoutLog / $stderrLog"
    }

    try {
      $health = Invoke-RestMethod -Uri "$apiBase/api/health" -Method Get -TimeoutSec 2
      if ($health.status -eq "ok") {
        $backendReady = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  if (-not $backendReady) {
    throw "Desktop backend did not become ready within 15 seconds. Check logs: $stdoutLog / $stderrLog"
  }

  $env:PRISM_DESKTOP_API_BASE = $apiBase
  Write-Host "Starting Tauri desktop shell"
  & $tauriCli "dev" "--config" $tauriDevConfig
  $tauriExitCode = $LASTEXITCODE
} finally {
  if ($backendProcess -and -not $backendProcess.HasExited) {
    Stop-ProcessTree -ProcessId $backendProcess.Id
  }
}

exit $tauriExitCode
