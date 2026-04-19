# Prism Release Notes Template

Use this template for Prism desktop releases. Replace every placeholder with real values from git history and the built installer.

```md
## 中文

Prism v<version> 主要聚焦<一句话概括本次发布重点>。

### 更新内容
- <基于 git log / diff 提炼的亮点 1>
- <基于 git log / diff 提炼的亮点 2>
- <基于 git log / diff 提炼的亮点 3>
- <可选亮点 4>

### 安装包
- Windows x64 安装包：`Prism_<version>_x64-setup.exe`
- SHA256：`<SHA256_UPPERCASE>`

## English

Prism v<version> focuses on <one-sentence English summary>.

### Highlights
- <Highlight 1 based on git history>
- <Highlight 2 based on git history>
- <Highlight 3 based on git history>
- <Optional highlight 4>

### Asset
- Windows x64 installer: `Prism_<version>_x64-setup.exe`
- SHA256: `<SHA256_UPPERCASE>`
```

## How to fill it

- Use the previous release tag as the baseline.
- Prefer 3-5 bullets total per language.
- Keep Chinese and English bullets aligned in meaning.
- Mention UI changes, config changes, bug fixes, and dev/build improvements only when they are real and visible in the diffs.
- Avoid claiming performance or reliability improvements unless the code changes clearly support that claim.
