---
name: publish-prism-release
description: Publish a new Prism desktop release for this repository. Use when Codex needs to bump the Prism app version, build the Windows installer, compute SHA256, commit and tag the release, push to GitHub, create a bilingual Chinese/English release note, and upload the installer asset.
---

# Publish Prism Release

Use this skill for Prism's Windows desktop release flow. Prefer the smallest necessary change: only update version-bearing files, reuse the existing build pipeline, and publish one GitHub release that includes a bilingual body and the generated installer.

## Release workflow

1. Confirm the repo state before touching versions.
2. Find the previous `v*` release tag and summarize real changes since that tag.
3. Update Prism version files to the target version.
4. Build the Windows installer with the existing project script.
5. Compute the installer SHA256 and record file size.
6. Commit the version bump, create an annotated tag, and push branch plus tag.
7. Write a bilingual release body using [references/release-notes-template.md](references/release-notes-template.md).
8. Publish the GitHub release and upload the installer by following [references/publish-github-release-manual.md](references/publish-github-release-manual.md).
9. Verify the remote release, asset, and local git state.

## Repo-specific facts

- Main version source: `package.json`
- Version files that must stay in sync:
  - `package.json`
  - `package-lock.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.lock` for the `prism_desktop` package entry
- Windows build entry point: `npm run build`
- Build script: `scripts/build-tauri-windows.ps1`
- Expected installer output:
  - `src-tauri/target/release/bundle/nsis/Prism_<version>_x64-setup.exe`
- Previous Prism releases use:
  - tag name `v<version>`
  - release title `v<version>`
  - Chinese section first, English section second
  - installer filename and SHA256 listed in both sections

## Step 1: Inspect state

Run these checks first:

```powershell
git status --short --branch
git tag --sort=-creatordate | Select-Object -First 20
git remote -v
```

If the worktree contains unrelated user changes, do not revert them. Decide whether the release should continue on top of them. If the release would accidentally include unrelated work, stop and ask.

## Step 2: Gather release facts

Use the most recent stable `v*` tag as the baseline unless the user says otherwise.

Helpful commands:

```powershell
git log --oneline <previous-tag>..HEAD
git diff --stat <previous-tag>..HEAD
git diff --name-only <previous-tag>..HEAD
```

Base the release notes on confirmed changes from git history, not memory.

Separate your conclusions:

- Confirmed facts: files changed, commits merged, installer path, SHA256
- Inference: grouped highlights written from those diffs
- External result: release page URL or GitHub API verification

## Step 3: Update version files

Update the target version consistently across all version-bearing files. Use `apply_patch` for manual edits.

Typical commit message:

```text
chore(version): 发布版本 1.1.1
```

## Step 4: Build

Use the existing packaged build flow only:

```powershell
npm run build
```

The build script already syncs `package.json` into Tauri config and Cargo metadata during the build, but still keep the tracked version files updated in git before committing the release.

After a successful build, verify the installer exists:

```powershell
Get-Item src-tauri\target\release\bundle\nsis\Prism_<version>_x64-setup.exe
Get-FileHash src-tauri\target\release\bundle\nsis\Prism_<version>_x64-setup.exe -Algorithm SHA256
```

## Step 5: Commit, tag, and push

Stage only the intended version files:

```powershell
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock
git commit -m "chore(version): 发布版本 <version>"
git tag -a v<version> -m "Release v<version>"
git push origin <branch>
git push origin v<version>
```

Use the current branch name from `git status --short --branch`. Do not assume it is always `master`, even though Prism currently uses `master`.

## Step 6: Write bilingual release notes

Follow [references/release-notes-template.md](references/release-notes-template.md).

Guidelines:

- Keep the Chinese and English sections aligned in meaning.
- Prefer 3-5 real highlights derived from git history.
- Mention the exact installer filename.
- Mention the exact SHA256 in uppercase for readability.
- Put the generated note in a temporary file such as `.release-notes-v<version>.md`.
- Delete that temporary file after a successful release unless the user wants to keep it.

## Step 7: Publish the GitHub release

Use the manual guide in [references/publish-github-release-manual.md](references/publish-github-release-manual.md).

Recommended release facts:

- release title: `v<version>`
- release tag: `v<version>`
- target branch: the current branch from `git status --short --branch`
- release body: the contents of `.release-notes-v<version>.md`
- asset: `src-tauri/target/release/bundle/nsis/Prism_<version>_x64-setup.exe`

## Step 8: Verify

Verify both locally and remotely:

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse "v<version>^{}"
```

Optional remote verification:

```powershell
Invoke-WebRequest -UseBasicParsing `
  -Headers @{ 'User-Agent' = 'Prism-Release-Verify' } `
  -Uri "https://api.github.com/repos/<owner>/<repo>/releases/tags/v<version>"
```

Confirm:

- release page exists
- asset name matches the built installer
- remote asset size is plausible
- remote digest matches the local SHA256 when GitHub reports it
- local branch is clean after cleanup

## Safety rules

- Do not use `gh` unless the environment already has it and the user explicitly prefers the CLI flow.
- Do not print credentials or tokens.
- Do not commit build artifacts to git.
- Do not rewrite or delete existing tags unless the user explicitly asks.
- If GitHub release creation succeeds but asset upload fails, report the partial state clearly and reuse the existing release to finish the upload.
