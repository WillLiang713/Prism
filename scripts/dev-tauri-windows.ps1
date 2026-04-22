param(
  [string]$BackendHost = "0.0.0.0",
  [int]$Port = 33100
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

function Resolve-BunCommand {
  $bunCommand = Get-Command bun.exe -ErrorAction SilentlyContinue
  if ($bunCommand) {
    return $bunCommand.Source
  }

  $bunCommand = Get-Command bun -ErrorAction SilentlyContinue
  if ($bunCommand) {
    return $bunCommand.Source
  }

  $defaultBunPath = Join-Path $HOME ".bun\bin\bun.exe"
  if (Test-Path $defaultBunPath) {
    return $defaultBunPath
  }

  throw "bun was not found. Install it from https://bun.sh/docs/installation"
}

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

function Stop-PrismDesktopProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot
  )

  $targetExe = Join-Path $ProjectRoot "src-tauri\target\debug\prism_desktop.exe"
  $desktopProcesses = Get-Process -Name "prism_desktop" -ErrorAction SilentlyContinue
  if (-not $desktopProcesses) {
    return
  }

  foreach ($process in $desktopProcesses) {
    try {
      if ($process.Path -and $process.Path -ieq $targetExe) {
        Write-Host "Stopping lingering desktop process: $($process.Id)"
        Stop-ProcessTree -ProcessId $process.Id
      }
    } catch {
      # ignore per-process inspection failure
    }
  }
}

function Stop-PrismBackendProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot
  )

  $escapedProjectRoot = [Regex]::Escape($ProjectRoot)
  $backendProcesses = Get-CimInstance Win32_Process | Where-Object {
    $commandLine = $_.CommandLine
    if (-not $commandLine) {
      return $false
    }

    return $commandLine -match "server\.py" -and $commandLine -match $escapedProjectRoot
  }

  foreach ($process in $backendProcesses) {
    if ($process.ProcessId -eq $PID) {
      continue
    }
    Write-Host "Stopping lingering backend process: $($process.ProcessId)"
    Stop-ProcessTree -ProcessId $process.ProcessId
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

$bunCommand = Resolve-BunCommand

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

Stop-PrismDesktopProcess -ProjectRoot $projectRoot
Stop-PrismBackendProcess -ProjectRoot $projectRoot

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
  & $bunCommand "x" "@tauri-apps/cli" "dev" "--config" $tauriDevConfig
  $tauriExitCode = $LASTEXITCODE
} finally {
  if ($backendProcess -and -not $backendProcess.HasExited) {
    Stop-ProcessTree -ProcessId $backendProcess.Id
  }
}

exit $tauriExitCode
