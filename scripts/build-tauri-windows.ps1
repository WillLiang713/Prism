param(
  [switch]$SkipBackendBuild
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

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

function Stop-LockingProcesses {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $resolvedPath = (Resolve-Path $Path).ProviderPath
  if (-not $resolvedPath.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $resolvedPath += [System.IO.Path]::DirectorySeparatorChar
  }

  $lockingProcesses = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
      try {
        $processPath = $_.Path
        if (-not $processPath) {
          return $false
        }

        return $processPath.StartsWith($resolvedPath, [System.StringComparison]::OrdinalIgnoreCase)
      } catch {
        return $false
      }
    })

  foreach ($process in $lockingProcesses) {
    Write-Host "Stopping process locking build artifact: $($process.ProcessName) ($($process.Id))"
    Stop-ProcessTree -ProcessId $process.Id
  }
}

function Invoke-NativeCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$FailureMessage = "External command failed.",
    [switch]$SuppressOutput
  )

  $previousErrorActionPreference = $ErrorActionPreference
  $exitCode = 0

  try {
    $ErrorActionPreference = "Continue"
    if ($SuppressOutput) {
      & $FilePath @Arguments *> $null
    } else {
      & $FilePath @Arguments
    }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($exitCode -ne 0) {
    throw "$FailureMessage (exit code: $exitCode)"
  }
}

function Remove-BuildArtifact {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (Test-Path $Path) {
    Write-Host "Removing build artifact: $Path"
    Stop-LockingProcesses -Path $Path
    # 使用 robocopy 空目录的方式清空内容，避免 Remove-Item -Recurse 在深层目录上失败
    $emptyDir = Join-Path $env:TEMP "prism_empty_$(Get-Random)"
    New-Item -ItemType Directory -Path $emptyDir -Force | Out-Null
    robocopy $emptyDir $Path /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    Remove-Item -Path $emptyDir -Force
    Remove-Item -Path $Path -Recurse -Force
  }
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Content
  )

  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Get-PackageVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PackageJsonPath
  )

  $packageJson = Get-Content $PackageJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $version = [string]$packageJson.version
  if (-not $version) {
    throw "Version field was not found in package.json."
  }

  return $version.Trim()
}

function Sync-VersionField {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Pattern,
    [Parameter(Mandatory = $true)]
    [string]$Replacement,
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [Parameter(Mandatory = $true)]
    [string]$Description
  )

  $content = Get-Content $Path -Raw -Encoding UTF8
  if (-not [System.Text.RegularExpressions.Regex]::IsMatch($content, $Pattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)) {
    throw "Failed to find $Description in $Path."
  }

  $updated = [System.Text.RegularExpressions.Regex]::Replace(
    $content,
    $Pattern,
    $Replacement,
    [System.Text.RegularExpressions.RegexOptions]::Multiline
  )

  if ($updated -ne $content) {
    Write-Host "Syncing $Description to $Version"
    Write-Utf8NoBom -Path $Path -Content $updated
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

$runtimeResourceDir = Join-Path $projectRoot "src-tauri\runtime"
$legacySidecarPath = Join-Path $projectRoot "src-tauri\binaries\prism-backend-x86_64-pc-windows-msvc.exe"
$nuitkaOutputDir = Join-Path $projectRoot "build\nuitka"
$tauriTargetDir = Join-Path $projectRoot "src-tauri\target"
$packageJsonPath = Join-Path $projectRoot "package.json"
$tauriConfigPath = Join-Path $projectRoot "src-tauri\tauri.conf.json"
$cargoTomlPath = Join-Path $projectRoot "src-tauri\Cargo.toml"
$buildVersion = Get-PackageVersion -PackageJsonPath $packageJsonPath

Sync-VersionField `
  -Path $tauriConfigPath `
  -Pattern '"version"\s*:\s*"[^"]+"' `
  -Replacement ('"version": "{0}"' -f $buildVersion) `
  -Version $buildVersion `
  -Description "Tauri app version"

Sync-VersionField `
  -Path $cargoTomlPath `
  -Pattern '^version\s*=\s*"[^"]+"(\r?)$' `
  -Replacement ('version = "' + $buildVersion + '"$1') `
  -Version $buildVersion `
  -Description "Cargo package version"

Remove-BuildArtifact -Path $tauriTargetDir

if (-not $SkipBackendBuild) {
  Remove-BuildArtifact -Path $nuitkaOutputDir
  Remove-BuildArtifact -Path $runtimeResourceDir

  if (Test-Path $legacySidecarPath) {
    Write-Host "Removing legacy backend sidecar: $legacySidecarPath"
    Remove-Item -Path $legacySidecarPath -Force
  }

  try {
    Invoke-NativeCommand `
      -FilePath $pythonCommand `
      -Arguments ($pythonArgs + @("-m", "nuitka", "--version")) `
      -FailureMessage "Nuitka is required for the selected Python interpreter. Run: `"$pythonCommand`" $($pythonArgs -join ' ') -m pip install nuitka" `
      -SuppressOutput
  } catch {
    throw $_
  }

  Invoke-NativeCommand `
    -FilePath $pythonCommand `
    -Arguments ($pythonArgs + @(
      "-m",
      "nuitka",
      "--mode=standalone",
      "--assume-yes-for-downloads",
      "--windows-console-mode=disable",
      "--output-dir=$nuitkaOutputDir",
      "--output-filename=prism-runtime.exe",
      "--company-name=Prism",
      "--product-name=Prism Desktop Runtime",
      "--file-version=$buildVersion",
      "--product-version=$buildVersion",
      "--file-description=Prism Desktop Runtime",
      ("--windows-icon-from-ico=" + (Join-Path $projectRoot "src-tauri\icons\icon.ico")),
      ("--include-data-files=" + ((Join-Path $projectRoot "tools.json") + "=tools.json")),
      ("--include-data-dir=" + ((Join-Path $projectRoot "frontend") + "=frontend")),
      "--include-module=uvicorn.logging",
      "--include-module=uvicorn.loops.auto",
      "--include-module=uvicorn.protocols.http.auto",
      "--include-module=uvicorn.protocols.websockets.auto",
      "--include-module=uvicorn.lifespan.on",
      "server.py"
    )) `
    -FailureMessage "Nuitka build failed."

  $backendExe = Get-ChildItem -Path $nuitkaOutputDir -Recurse -Filter "prism-runtime.exe" -File | Select-Object -First 1
  if (-not $backendExe) {
    throw "Nuitka build finished but prism-runtime.exe was not found under $nuitkaOutputDir"
  }

  $backendDistDir = Split-Path -Parent $backendExe.FullName
  New-Item -ItemType Directory -Path $runtimeResourceDir -Force | Out-Null
  Copy-Item -Path (Join-Path $backendDistDir "*") -Destination $runtimeResourceDir -Recurse -Force
}

# 将 __BUILD__ 占位符替换为当前时间戳以破坏 WebView2 缓存
$indexHtml = Join-Path $projectRoot "frontend\index.html"
$buildStamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$originalContent = Get-Content $indexHtml -Raw -Encoding UTF8
$stampedContent = $originalContent -replace '__BUILD__', $buildStamp
Write-Utf8NoBom -Path $indexHtml -Content $stampedContent

Invoke-NativeCommand `
  -FilePath "npm" `
  -Arguments @("install") `
  -FailureMessage "npm install failed."
try {
  Invoke-NativeCommand `
    -FilePath "npm" `
    -Arguments @("run", "tauri:build") `
    -FailureMessage "Tauri build failed."
} finally {
  # 构建完成后恢复 index.html 中的占位符，避免污染源文件
  Write-Utf8NoBom -Path $indexHtml -Content $originalContent
}
