# Publish GitHub Release Manually

Use this guide instead of an automation script when publishing a Prism desktop release.

## Inputs you should already have

- `version`: for example `1.1.2`
- `tag`: `v<version>`
- `branch`: usually the current branch from `git status --short --branch`
- `body file`: for example `.release-notes-v<version>.md`
- `installer`: `src-tauri/target/release/bundle/nsis/Prism_<version>_x64-setup.exe`

## Recommended path: GitHub web UI

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

## Verification checklist

After publishing, verify all of the following:

- The release page opens successfully.
- The title is `v<version>`.
- The tag is `v<version>`.
- The uploaded asset name is exactly `Prism_<version>_x64-setup.exe`.
- The remote asset size is plausible compared with the local file.
- The release body includes the installer filename and SHA256 in both Chinese and English sections.

## Notes

- Prefer the GitHub web UI unless the user explicitly wants an API-driven release flow.
- Do not upload any build artifact except the installer that belongs to this release.
- If release creation succeeded but asset upload failed, reuse the existing release instead of creating another one.
