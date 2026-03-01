# Bug 记录：Exa 搜索模式选择器样式反复异常（移动端/配置面板）

## 问题现象
在配置中心的「Exa 搜索模式」选择器中，反复出现以下问题：

1. 出现原生 `select` 的分隔竖杠/系统弹出样式（与项目自定义下拉不一致）
2. 点击左侧输入区时，只有左侧框高亮，右侧箭头框不高亮（整框不统一）
3. 下拉交互和已有「联网服务」「搜索深度」不一致

## 复现条件
- 在配置面板中新增 Exa 搜索模式字段后，若直接使用原生 `select` 或样式未完全接入静态选择器体系，容易复现。
- 对 `focus` 仅作用于输入框本体，未同步到右侧箭头按钮时，容易出现“半框高亮”。

## 根因分析
1. **组件体系不一致**
   - 项目内配置面板下拉已经采用 `config-native-select + config-static-picker` 的统一模式。
   - 新字段若直接保留原生 `select` 显示，会触发与全局下拉皮肤规则冲突，产生竖杠/原生弹出等问题。

2. **焦点高亮只作用局部**
   - `input:focus` 只改了左侧输入框边框，没有同步修改右侧 `.model-picker-btn`。
   - 缺少对整行容器（`.model-picker-row`）的统一 glow 样式。

## 已采用的修复方案
1. **Exa 搜索模式完全接入静态选择器体系**
   - 原生 `select` 仅作隐藏数据源：`class="config-native-select"`
   - 使用 `model-picker` + `model-dropdown` 进行统一交互
   - 在 `app.js` 的 `getConfigSelectPickerDefs()` 中注册 `exaSearchType` 对应 picker

2. **整框联动高亮**
   - 输入聚焦时：左侧输入 + 右侧按钮统一 `border-color: var(--accent)`
   - 行容器统一 glow：
     - `.model-picker-row:has(input[type="text"]:focus)`
     - `.config-static-picker:has(.model-picker-btn.open) .model-picker-row`

## 关键防回归规则（必须遵守）
1. 新增配置下拉字段时，**不要直接暴露原生 select**，必须走 `config-static-picker`。
2. 任何「输入框 + 箭头按钮」组合控件，focus/open 状态都要保证：
   - 左右两侧边框颜色一致
   - 外层整框 glow 一致
3. 如果视觉异常反复出现，先检查：
   - 是否遗漏 `getConfigSelectPickerDefs()` 注册
   - 是否存在对 `#configModal .form-group select` 的通用样式冲突
   - 是否仅修改了输入框，未同步按钮与行容器

## 快速验收清单
- [ ] 点击 Exa 搜索模式左侧输入区时，整框（含箭头区）一起高亮
- [ ] 点击箭头时，下拉为项目自定义样式，不是系统原生弹层
- [ ] 与「联网服务」「搜索深度」交互与视觉一致
- [ ] 移动端与桌面端表现一致

## 备注
该问题历史上多次重复出现。后续凡是新增配置选择器，必须参考本文件执行，以避免重复返工。
