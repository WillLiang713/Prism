param(
  [string]$BackendHost = "0.0.0.0",
  [int]$Port = 33100
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$desktopIdentifier = "com.prism.desktop"
$localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { "" }
$desktopCacheDir = if ($localAppData) {
  Join-Path $localAppData $desktopIdentifier
} else {
  ""
}
$releaseLogDir = if ($localAppData) {
  Join-Path $localAppData "Prism\logs"
} else {
  ""
}
$devScript = Join-Path $PSScriptRoot "dev-tauri-windows.ps1"
$requirementsPath = Join-Path $projectRoot "requirements.txt"

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
  $desktopProcesses = Get-Process -Name "prism_desktop" -ErrorAction SilentlyContinue
  if (-not $desktopProcesses) {
    return
  }

  foreach ($process in $desktopProcesses) {
    Stop-ProcessTree -ProcessId $process.Id
  }
}

function Stop-PrismBackendProcess {
  $escapedProjectRoot = [Regex]::Escape($projectRoot)
  $backendProcesses = Get-CimInstance Win32_Process | Where-Object {
    $commandLine = $_.CommandLine
    if (-not $commandLine) {
      return $false
    }

    return $commandLine -match "server\.py" -and $commandLine -match $escapedProjectRoot
  }

  foreach ($process in $backendProcesses) {
    Stop-ProcessTree -ProcessId $process.ProcessId
  }
}

function Remove-PathIfExists {
  param(
    [Parameter(Mandatory = $true)]
    [string]$LiteralPath
  )

  if (Test-Path $LiteralPath) {
    Remove-Item -LiteralPath $LiteralPath -Recurse -Force
  }
}

function Remove-FileIfExists {
  param(
    [Parameter(Mandatory = $true)]
    [string]$LiteralPath
  )

  if (Test-Path $LiteralPath) {
    Remove-Item -LiteralPath $LiteralPath -Force
  }
}

function Remove-PythonCacheArtifacts {
  $cacheDirs = Get-ChildItem -Path $projectRoot -Recurse -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue
  foreach ($dir in $cacheDirs) {
    Remove-PathIfExists -LiteralPath $dir.FullName
  }

  $cacheFiles = Get-ChildItem -Path $projectRoot -Recurse -File -Include "*.pyc", "*.pyo" -ErrorAction SilentlyContinue
  foreach ($file in $cacheFiles) {
    Remove-FileIfExists -LiteralPath $file.FullName
  }
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

function Resolve-PythonCommand {
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

  return @{
    Command = $pythonCommand
    Args = $pythonArgs
  }
}

function Resolve-NpmCommand {
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($npmCommand) {
    return $npmCommand.Source
  }

  $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
  if ($npmCommand) {
    return $npmCommand.Source
  }

  throw "npm was not found."
}

Write-Host "Stopping Prism desktop and backend processes..."
Stop-PrismDesktopProcess
Stop-PrismBackendProcess

Write-Host "Removing desktop runtime data and build artifacts..."
$pathsToRemove = @(
  $desktopCacheDir,
  $releaseLogDir,
  (Join-Path $projectRoot "logs"),
  (Join-Path $projectRoot "build"),
  (Join-Path $projectRoot "dist"),
  (Join-Path $projectRoot "tmp"),
  (Join-Path $projectRoot ".tmp"),
  (Join-Path $projectRoot ".pytest_cache"),
  (Join-Path $projectRoot "edge-cdp-profile"),
  (Join-Path $projectRoot "edge-cdp-profile-test"),
  (Join-Path $projectRoot "node_modules"),
  (Join-Path $projectRoot "src-tauri\target"),
  (Join-Path $projectRoot "src-tauri\runtime")
)

foreach ($path in $pathsToRemove) {
  if ($path) {
    Remove-PathIfExists -LiteralPath $path
  }
}

$filesToRemove = @(
  (Join-Path $projectRoot "tmp-server.out.log"),
  (Join-Path $projectRoot "tmp-server.err.log")
)

foreach ($path in $filesToRemove) {
  Remove-FileIfExists -LiteralPath $path
}

Remove-PythonCacheArtifacts

$python = Resolve-PythonCommand
$npmCommand = Resolve-NpmCommand

Write-Host "Reinstalling Node dependencies..."
& $npmCommand "install"
if ($LASTEXITCODE -ne 0) {
  throw "npm install failed with exit code $LASTEXITCODE"
}

if (Test-Path $requirementsPath) {
  Write-Host "Refreshing Python dependencies..."
  & $python.Command @($python.Args + @("-m", "pip", "install", "-r", $requirementsPath))
  if ($LASTEXITCODE -ne 0) {
    throw "pip install failed with exit code $LASTEXITCODE"
  }
}

Write-Host "Starting fully rebuilt desktop dev environment..."
& $devScript -BackendHost $BackendHost -Port $Port
exit $LASTEXITCODE
