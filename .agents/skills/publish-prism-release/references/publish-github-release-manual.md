# Publish GitHub Release

Use this guide when publishing or repairing a Prism desktop GitHub Release. Prefer the GitHub web UI when an authenticated browser session is already available. Use the API fallback when browser login is unavailable but a token exists in `.env` or in the environment.

## Inputs you should already have

- `version`: for example `1.1.3`
- `tag`: `v<version>`
- `branch`: the current branch derived from `git status --short --branch`
- `body file`: for example `.release-notes-v<version>.md`
- `installer`: `src-tauri/target/release/bundle/nsis/Prism_<version>_x64-setup.exe`

Example setup:

```powershell
$version = '1.1.3'
$tag = "v$version"
$statusLine = git status --short --branch | Select-Object -First 1
$branch = if ($statusLine -match '^## ([^.\s]+)') { $Matches[1] } else { throw 'Unable to determine branch name.' }
$bodyFile = ".release-notes-v${version}.md"
$installer = "src-tauri/target/release/bundle/nsis/Prism_${version}_x64-setup.exe"
$assetName = [System.IO.Path]::GetFileName($installer)
```

Validate the inputs before touching GitHub:

```powershell
Get-Content -Raw $bodyFile
Get-Item $installer | Select-Object FullName, Length, LastWriteTime
(Get-FileHash $installer -Algorithm SHA256).Hash.ToUpper()
```

## Pre-check whether the release already exists

Check the public release endpoint first:

```powershell
try {
  Invoke-RestMethod `
    -Headers @{ 'User-Agent' = 'Prism-Release-Check' } `
    -Uri "https://api.github.com/repos/WillLiang713/Prism/releases/tags/$tag" `
    -ErrorAction Stop
} catch {
  if ($_.Exception.Response.StatusCode.value__ -eq 404) {
    'NOT_FOUND'
  } else {
    throw
  }
}
```

Interpretation:

- returns release JSON: update or repair the existing release
- returns `NOT_FOUND`: create a new release

## Path A: GitHub web UI

Use this path when GitHub is already logged in in the browser.

### If the release does not exist yet

1. Open `https://github.com/WillLiang713/Prism/releases/new`.
2. Choose or enter the tag `v<version>`.
3. Set the target branch to `<branch>`.
4. Set the release title to `v<version>`.
5. Paste the full contents of `.release-notes-v<version>.md` into the release body.
6. Upload `Prism_<version>_x64-setup.exe` in the asset area.
7. Publish the release.

### If the release already exists

1. Open `https://github.com/WillLiang713/Prism/releases/tag/v<version>`.
2. Click `Edit`.
3. Update the release body from `.release-notes-v<version>.md` if needed.
4. Upload the installer asset if it is missing.
5. If an asset with the same filename already exists and is wrong, delete it first, then upload the correct one.
6. Save the release.

## Path B: GitHub API fallback

Use this path when browser login is unavailable but a token exists. Do not print the token.

### Step 1: Load the token safely

Prefer an existing environment variable. If it does not exist, read from `.env` without printing the value.

```powershell
function Get-DotEnvValue {
  param(
    [string]$Path,
    [string]$Name
  )

  foreach ($line in Get-Content $Path) {
    $trim = $line.Trim()
    if (-not $trim -or $trim.StartsWith('#')) { continue }
    $parts = $trim -split '=', 2
    if ($parts.Length -ne 2) { continue }
    if ($parts[0].Trim() -ne $Name) { continue }
    return $parts[1].Trim().Trim('"').Trim("'")
  }

  return $null
}

$token = if ($env:GITHUB_TOKEN) { $env:GITHUB_TOKEN } else { Get-DotEnvValue '.env' 'GITHUB_TOKEN' }
if (-not $token) { throw 'GITHUB_TOKEN not found in environment or .env' }

$headers = @{
  Authorization = "Bearer $token"
  Accept = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent' = 'Prism-Release-Agent'
}
```

### Step 2: Load the release body and installer facts

```powershell
$bodyText = Get-Content -Raw $bodyFile
$asset = Get-Item $installer
$hash = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLower()
$size = $asset.Length
```

### Step 3: Load the existing release if present

```powershell
$release = $null

try {
  $release = Invoke-RestMethod `
    -Method Get `
    -Headers $headers `
    -Uri "https://api.github.com/repos/WillLiang713/Prism/releases/tags/$tag" `
    -ErrorAction Stop
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
}
```

### Step 4A: Create a new release when none exists

```powershell
if (-not $release) {
  $payload = @{
    tag_name = $tag
    target_commitish = $branch
    name = $tag
    body = $bodyText
    draft = $false
    prerelease = $false
    generate_release_notes = $false
  } | ConvertTo-Json -Depth 5

  $release = Invoke-RestMethod `
    -Method Post `
    -Headers $headers `
    -Uri 'https://api.github.com/repos/WillLiang713/Prism/releases' `
    -Body $payload `
    -ContentType 'application/json; charset=utf-8'
}
```

### Step 4B: Update the existing release when it already exists

```powershell
if ($release) {
  $payload = @{
    tag_name = $tag
    target_commitish = $branch
    name = $tag
    body = $bodyText
    draft = $false
    prerelease = $false
  } | ConvertTo-Json -Depth 5

  $release = Invoke-RestMethod `
    -Method Patch `
    -Headers $headers `
    -Uri "https://api.github.com/repos/WillLiang713/Prism/releases/$($release.id)" `
    -Body $payload `
    -ContentType 'application/json; charset=utf-8'
}
```

### Step 5: Replace the installer asset when needed

If the same asset name already exists on the release and may be stale, delete it first.

```powershell
$existingAsset = $release.assets |
  Where-Object { $_.name -eq $assetName } |
  Select-Object -First 1

if ($existingAsset) {
  Invoke-RestMethod `
    -Method Delete `
    -Headers $headers `
    -Uri "https://api.github.com/repos/WillLiang713/Prism/releases/assets/$($existingAsset.id)"
}
```

Upload the new installer:

```powershell
$uploadUrl = $release.upload_url -replace '\{\?name,label\}', "?name=$([System.Uri]::EscapeDataString($assetName))"

Invoke-RestMethod `
  -Method Post `
  -Headers $headers `
  -Uri $uploadUrl `
  -InFile $installer `
  -ContentType 'application/octet-stream'
```

### Step 6: Verify the published release via API

```powershell
$verified = Invoke-RestMethod `
  -Method Get `
  -Headers $headers `
  -Uri "https://api.github.com/repos/WillLiang713/Prism/releases/tags/$tag"

$verifiedAsset = $verified.assets |
  Where-Object { $_.name -eq $assetName } |
  Select-Object -First 1

if (-not $verifiedAsset) { throw 'Uploaded asset not found on the verified release.' }

[pscustomobject]@{
  ReleaseUrl = $verified.html_url
  AssetName = $verifiedAsset.name
  AssetSize = $verifiedAsset.size
  RemoteDigest = $verifiedAsset.digest
  LocalDigest = "sha256:$hash"
  AssetDownloadUrl = $verifiedAsset.browser_download_url
} | Format-List
```

The release is in a good state when:

- `ReleaseUrl` opens correctly
- `AssetName` equals `Prism_<version>_x64-setup.exe`
- `AssetSize` is plausible compared with the local file size
- `RemoteDigest` equals `sha256:<local hash>` when GitHub reports a digest

## Verification checklist

After publishing, verify all of the following:

- the release page opens successfully
- the title is `v<version>`
- the tag is `v<version>`
- the uploaded asset name is exactly `Prism_<version>_x64-setup.exe`
- the remote asset size is plausible compared with the local file
- the release body includes the installer filename and SHA256 in both Chinese and English sections
- the remote digest matches the local SHA256 when GitHub returns `digest`

## Failure handling

- If release creation succeeds but asset upload fails, reuse the same release and retry the upload. Do not create another release.
- If asset upload succeeds but the release body is stale, patch the release body in place instead of deleting the release.
- If the tag is wrong, stop and ask before editing or deleting anything on GitHub.
- If the API returns `404` for the release tag but the tag exists in git, check whether the tag has been pushed to the remote before retrying the release creation.

## Notes

- Prefer the GitHub web UI unless browser login is unavailable or the user explicitly wants an API-driven flow.
- Do not upload any build artifact except the installer that belongs to this release.
- Do not print or echo tokens in logs or terminal output.
