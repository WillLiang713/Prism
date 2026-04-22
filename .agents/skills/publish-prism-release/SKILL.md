---
name: publish-prism-release
description: Publish a new Prism desktop release for this repository. Use when Codex needs to bump the Prism app version, build the Windows installer, compute SHA256, commit and tag the release, push to GitHub, create a bilingual Chinese/English release note, and publish or repair the GitHub Release page and installer asset.
---

# Publish Prism Release

Use this skill for Prism's Windows desktop release flow. Prefer the smallest necessary change: only touch version-bearing files, reuse the existing build pipeline, and publish one GitHub release that includes a bilingual body and the generated installer.

Load these references only when needed:

- For release note wording and structure: [references/release-notes-template.md](references/release-notes-template.md)
- For GitHub Release publishing details: [references/publish-github-release-manual.md](references/publish-github-release-manual.md)

## Repo-specific facts

- Main version source: `package.json`
- Version files that must stay in sync:
  - `package.json`
  - `package-lock.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.lock` for the `prism_desktop` package entry
- Windows build entry point: `bun run build`
- Build script: `scripts/build-tauri-windows.ps1`
- Expected installer output:
  - `src-tauri/target/release/bundle/nsis/Prism_<version>_x64-setup.exe`
- Previous Prism releases use:
  - tag name `v<version>`
  - release title `v<version>`
  - Chinese section first, English section second
  - installer filename and SHA256 listed in both sections

## Release workflow

1. Derive the concrete release inputs.
2. Inspect repo state before touching versions.
3. Determine whether this is a fresh release or a continuation of an already-tagged release.
4. Gather confirmed release facts from git history.
5. Update version files if a version bump is still needed.
6. Build the Windows installer and record file facts.
7. Commit, tag, and push if this is a fresh release.
8. Write bilingual release notes.
9. Publish or repair the GitHub Release page and upload the installer.
10. Verify local and remote release state, then clean up temporary artifacts.

## Step 0: Derive release inputs

Start by deriving explicit variables instead of mentally substituting placeholders.

```powershell
$version = '1.1.3'
$tag = "v$version"
$statusLine = git status --short --branch | Select-Object -First 1
$branch = if ($statusLine -match '^## ([^.\s]+)') { $Matches[1] } else { throw 'Unable to determine branch name.' }
$installer = "src-tauri/target/release/bundle/nsis/Prism_${version}_x64-setup.exe"
$notesFile = ".release-notes-v${version}.md"
```

Use these same variables throughout the release flow. This reduces copy/paste mistakes and makes it easier to compare local state with the GitHub release later.

## Step 1: Inspect state before making changes

Run these checks first:

```powershell
git status --short --branch
git tag --list "v*" --sort=-creatordate | Select-Object -First 20
git remote -v
```

Interpret the output before continuing:

- If `git status` shows unrelated tracked file changes that would accidentally ship in the release, stop and ask before proceeding.
- If the worktree only contains temporary files such as `.release-notes-v<version>.md` or `.playwright-cli/`, continue, but remember to clean them up at the end.
- If the current branch is not the intended release branch, stop and confirm before creating tags or releases.

## Step 2: Decide whether this is a fresh release or a continuation

Check both local and remote tag state before changing any version files:

```powershell
git rev-parse --verify "$tag^{}"
git ls-remote --tags origin $tag
git rev-parse HEAD
```

Use the results to decide the path:

- Fresh release:
  - local tag does not exist
  - remote tag does not exist
  - continue with version updates, commit, tag, and push
- Continuation release:
  - local and/or remote tag already exists
  - the tag resolves to the same commit as `HEAD`
  - skip version bump, commit, and tag creation
  - continue from build or GitHub Release repair steps only
- Stop and ask:
  - target tag already exists but points to a different commit than `HEAD`
  - remote tag exists but local tag is missing and the intended commit is unclear

Find the previous stable tag for release notes by excluding the target tag:

```powershell
$previousTag = git tag --list "v*" --sort=-creatordate |
  Where-Object { $_ -ne $tag } |
  Select-Object -First 1
$previousTag
```

If no previous stable tag exists, treat this as the first release and summarize changes from the beginning of the repository history instead of using a tag baseline.

## Step 3: Gather confirmed release facts

Use git history, not memory, to build the release summary.

```powershell
git log --oneline "$previousTag..HEAD"
git diff --stat "$previousTag..HEAD"
git diff --name-only "$previousTag..HEAD"
```

Optional deeper inspection for a changed file:

```powershell
git diff "$previousTag..HEAD" -- frontend/index.html
git diff "$previousTag..HEAD" -- frontend/js/config.js
```

Separate conclusions clearly:

- Confirmed facts:
  - commits in the range
  - changed files
  - installer filename
  - installer SHA256
- Inference:
  - grouped release highlights written from those diffs
- External result:
  - GitHub release URL
  - remote asset size
  - remote digest from GitHub API if available

## Step 4: Update version files when needed

Only do this on the fresh-release path. If the target tag already exists on the current commit, skip this section.

Update these files with the same `<version>` value:

- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.lock`

Use `apply_patch` for manual edits. After editing, verify all tracked version files agree:

```powershell
rg -n --fixed-strings $version package.json package-lock.json src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock
Get-Content package.json | Select-String '"version"'
Get-Content src-tauri/Cargo.toml | Select-String '^version = '
Get-Content src-tauri/tauri.conf.json | Select-String '"version"'
Select-String -Path src-tauri/Cargo.lock -Pattern 'name = "prism_desktop"|version = "' -Context 0,2
```

Typical commit message:

```text
chore(version): 发布版本 1.1.3
```

## Step 5: Build the installer and capture artifact facts

Always build before publishing the GitHub Release, even on the continuation path, unless the user explicitly wants to reuse an older verified artifact.

```powershell
bun run build
Get-Item $installer
$asset = Get-Item $installer
$hash = (Get-FileHash $installer -Algorithm SHA256).Hash.ToUpper()
$size = $asset.Length
$mtime = $asset.LastWriteTime
$asset | Select-Object FullName, Length, LastWriteTime
$hash
```

Required checks:

- the installer file exists exactly at `src-tauri/target/release/bundle/nsis/Prism_<version>_x64-setup.exe`
- the version in the filename matches the target version
- `Get-FileHash` succeeds
- the file size is plausible compared with prior releases

If the build fails, stop and debug the build before writing release notes or touching the GitHub release page.

## Step 6: Commit, tag, and push for a fresh release

Skip this section on the continuation path.

Inspect only the intended version file diffs before staging:

```powershell
git diff -- package.json package-lock.json src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock
```

Then stage, commit, tag, and push:

```powershell
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock
git commit -m "chore(version): 发布版本 $version"
git tag -a $tag -m "Release $tag"
git push origin $branch
git push origin $tag
```

Immediately verify the pushed refs:

```powershell
git rev-parse HEAD
git rev-parse "$tag^{}"
git ls-remote --tags origin $tag
```

If the commit succeeds but tag push fails, do not create a second tag. Diagnose the existing tag state and reuse or repair it.

## Step 7: Write bilingual release notes

Follow [references/release-notes-template.md](references/release-notes-template.md).

Use the confirmed facts gathered earlier:

- summarize the real change theme in one Chinese sentence and one English sentence
- keep Chinese and English bullet meaning aligned
- prefer 3-5 bullets total per language
- mention the exact installer filename
- mention the exact SHA256 in uppercase

Write the note to a temporary file such as:

```powershell
$notesFile
```

Use `apply_patch` or another precise file-editing method to create the release note file. After writing it, inspect the full contents before publishing:

```powershell
Get-Content -Raw $notesFile
```

## Step 8: Publish or repair the GitHub Release

Follow [references/publish-github-release-manual.md](references/publish-github-release-manual.md).

Preferred publishing paths:

- GitHub Web UI first if an authenticated browser session is already available
- GitHub API fallback if browser login is unavailable but a token exists in `.env` or the environment

Release facts to reuse consistently:

- release title: `v<version>`
- release tag: `v<version>`
- target branch: the branch derived in Step 0
- release body: the full contents of `.release-notes-v<version>.md`
- asset: `src-tauri/target/release/bundle/nsis/Prism_<version>_x64-setup.exe`

If a release already exists:

- update the existing release instead of creating another one
- replace the installer asset only if it is missing or incorrect
- if an asset with the same name already exists and is stale, delete it first, then upload the correct file

## Step 9: Verify local and remote release state

Always verify both local git state and remote release state after publishing.

Local verification:

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse "$tag^{}"
```

Remote verification via GitHub API:

```powershell
Invoke-WebRequest -UseBasicParsing `
  -Headers @{ 'User-Agent' = 'Prism-Release-Verify' } `
  -Uri "https://api.github.com/repos/WillLiang713/Prism/releases/tags/$tag"
```

If authenticated API verification is available, also compare asset metadata:

```powershell
$release = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/WillLiang713/Prism/releases/tags/$tag"
$asset = $release.assets | Where-Object { $_.name -eq "Prism_${version}_x64-setup.exe" } | Select-Object -First 1
$asset | Select-Object name, size, digest, browser_download_url
```

Confirm all of the following:

- release page exists
- title is `v<version>`
- tag is `v<version>`
- uploaded asset name matches the installer filename exactly
- remote asset size is plausible compared with the local file
- remote digest matches the local SHA256 when GitHub reports `digest`
- local branch is clean except for known user changes or intentional temporary files pending cleanup

## Step 10: Clean up temporary artifacts

Delete temporary files created during the release flow unless the user wants to keep them:

```powershell
if (Test-Path $notesFile) { Remove-Item -LiteralPath $notesFile -Force }
if (Test-Path '.playwright-cli') { Remove-Item -LiteralPath '.playwright-cli' -Recurse -Force }
git status --short --branch
```

Do not delete or revert unrelated user files. Only clean up artifacts created by the release process itself.

## Safety rules

- Do not print credentials or tokens.
- Do not commit build artifacts to git.
- Do not rewrite or delete existing tags unless the user explicitly asks.
- Do not assume the release branch is always `master`; derive it first.
- If the worktree contains unrelated user changes that would alter the release contents, stop and ask.
- If GitHub release creation succeeds but asset upload fails, report the partial state clearly and reuse the existing release to finish the upload.
- If the target tag already exists on the current commit, treat the task as a release continuation or repair, not as a fresh version bump.
