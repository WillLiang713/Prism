param(
  [Parameter(Mandatory = $true)]
  [string]$Owner,
  [Parameter(Mandatory = $true)]
  [string]$Repo,
  [Parameter(Mandatory = $true)]
  [string]$Tag,
  [string]$TargetCommitish = "master",
  [string]$Name,
  [Parameter(Mandatory = $true)]
  [string]$BodyFile,
  [string[]]$AssetPath = @(),
  [switch]$AllowUpdate
)

$ErrorActionPreference = "Stop"

function Get-GitHubAuthHeaders {
  $credentialQuery = "protocol=https`nhost=github.com`n`n"
  $credentialLines = $credentialQuery | git credential fill
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to read GitHub credentials from git credential helper."
  }

  $credentials = @{}
  foreach ($line in $credentialLines) {
    if ($line -match "=") {
      $parts = $line -split "=", 2
      $credentials[$parts[0]] = $parts[1]
    }
  }

  if (-not $credentials.ContainsKey("username") -or -not $credentials.ContainsKey("password")) {
    throw "GitHub credentials were not available from git credential helper."
  }

  $basicAuth = [Convert]::ToBase64String(
    [Text.Encoding]::ASCII.GetBytes("{0}:{1}" -f $credentials.username, $credentials.password)
  )

  return @{
    Authorization = "Basic $basicAuth"
    "User-Agent" = "Prism-Release-Script"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
  }
}

function Get-ReleaseByTag {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Headers,
    [Parameter(Mandatory = $true)]
    [string]$Owner,
    [Parameter(Mandatory = $true)]
    [string]$Repo,
    [Parameter(Mandatory = $true)]
    [string]$Tag
  )

  try {
    return Invoke-RestMethod `
      -Headers $Headers `
      -Uri ("https://api.github.com/repos/{0}/{1}/releases/tags/{2}" -f $Owner, $Repo, $Tag) `
      -Method Get
  } catch {
    if ($_.Exception.Message -like "*(404)*") {
      return $null
    }
    throw
  }
}

function Remove-AssetIfPresent {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Headers,
    [Parameter(Mandatory = $true)]
    [object]$Release,
    [Parameter(Mandatory = $true)]
    [string]$AssetName,
    [switch]$AllowUpdate
  )

  $existingAsset = @($Release.assets) | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
  if (-not $existingAsset) {
    return
  }

  if (-not $AllowUpdate) {
    throw "Release already contains asset '$AssetName'. Use -AllowUpdate to replace it."
  }

  Invoke-RestMethod `
    -Headers $Headers `
    -Uri $existingAsset.url `
    -Method Delete | Out-Null
}

if (-not $Name) {
  $Name = $Tag
}

$resolvedBodyFile = (Resolve-Path -LiteralPath $BodyFile).ProviderPath
$body = Get-Content -LiteralPath $resolvedBodyFile -Raw -Encoding UTF8
if (-not $body.Trim()) {
  throw "Body file is empty: $resolvedBodyFile"
}

$headers = Get-GitHubAuthHeaders
$release = Get-ReleaseByTag -Headers $headers -Owner $Owner -Repo $Repo -Tag $Tag

$payload = @{
  tag_name = $Tag
  target_commitish = $TargetCommitish
  name = $Name
  body = $body
  draft = $false
  prerelease = $false
} | ConvertTo-Json -Depth 8

if ($release) {
  if (-not $AllowUpdate) {
    throw "Release '$Tag' already exists. Re-run with -AllowUpdate to patch it."
  }

  $release = Invoke-RestMethod `
    -Headers $headers `
    -Uri $release.url `
    -Method Patch `
    -ContentType "application/json; charset=utf-8" `
    -Body $payload
} else {
  $release = Invoke-RestMethod `
    -Headers $headers `
    -Uri ("https://api.github.com/repos/{0}/{1}/releases" -f $Owner, $Repo) `
    -Method Post `
    -ContentType "application/json; charset=utf-8" `
    -Body $payload
}

$uploadedAssets = @()
foreach ($asset in $AssetPath) {
  $resolvedAssetPath = (Resolve-Path -LiteralPath $asset).ProviderPath
  $assetName = [System.IO.Path]::GetFileName($resolvedAssetPath)

  Remove-AssetIfPresent -Headers $headers -Release $release -AssetName $assetName -AllowUpdate:$AllowUpdate

  $uploadUrl = ($release.upload_url -replace "\{\?name,label\}", "")
  $uploadedAsset = Invoke-RestMethod `
    -Headers $headers `
    -Uri ($uploadUrl + "?name=" + [System.Uri]::EscapeDataString($assetName)) `
    -Method Post `
    -InFile $resolvedAssetPath `
    -ContentType "application/octet-stream"

  $uploadedAssets += [pscustomobject]@{
    name = $uploadedAsset.name
    size = $uploadedAsset.size
    browser_download_url = $uploadedAsset.browser_download_url
  }
}

[pscustomobject]@{
  tag = $Tag
  release_url = $release.html_url
  assets = $uploadedAssets
} | ConvertTo-Json -Depth 8
