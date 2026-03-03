# Bug 记录：移动端按钮点击后常亮与按压动效不一致

## 问题现象
在移动端（触屏设备）中，出现以下交互异常：

1. 「滚动到底部」按钮点击一次后可能保持高亮，像“常亮”状态
2. 「收起侧栏 / 展开侧栏」按钮按下反馈不明显，体感接近“没有动效”
3. 桌面端表现正常，但移动端与桌面端交互一致性差

## 影响范围
- `frontend/style.css`
- 相关按钮：
  - `.scroll-to-bottom-btn`
  - `.sidebar-toggle-handle`
  - `.sidebar-expand-btn`

## 复现条件
1. 在触屏设备点击带有 `:hover` 高亮规则的按钮
2. 浏览器将触摸事件映射为 hover 后，未及时退出 hover 状态
3. 按压态只设置 `transform`，但 `transition` 未包含 `transform`，导致反馈瞬变、不明显

## 根因分析
1. **触屏设备与 hover 机制不匹配**
   - `:hover` 适配的是鼠标悬停模型。
   - 触屏浏览器会模拟 hover，可能出现“点击后 hover 粘住”的视觉表现。

2. **按压动画缺少过渡项**
   - 侧栏按钮虽然有 `:active { transform: scale(...) }`，但 `transition` 没有 `transform`（也没有 `box-shadow`）。
   - 结果是状态切换过于突兀，用户感知弱。

## 已采用的修复方案
1. **将 hover 效果限制为桌面精确指针设备**
   - 使用：
     - `@media (hover: hover) and (pointer: fine)`
   - 仅在桌面端启用 hover 高亮，避免触屏端“常亮粘连”。

2. **统一移动端按压反馈（active）**
   - 为上述按钮设置明确按压态：
     - `transform: scale(0.94)`
     - `box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45)`
     - `color: var(--text)`

3. **补齐按压动画过渡**
   - 为侧栏按钮的 `transition` 增加：
     - `transform 0.12s ease`
     - `box-shadow 0.12s ease`

## 关键防回归规则（必须遵守）
1. 触屏高频按钮不要将核心交互反馈建立在 `:hover` 上。
2. 若使用 `:active` 做按压动画，必须同步检查 `transition` 是否包含对应属性（至少 `transform`）。
3. 桌面与移动端交互分层处理：
   - 桌面：`hover + active`
   - 移动：`active` 为主，必要时禁用 hover 视觉影响

## 快速验收清单
- [ ] 移动端点击「滚动到底部」按钮后，不会出现持续高亮
- [ ] 移动端按下「收起侧栏 / 展开侧栏」时，有清晰按压反馈且松手恢复
- [ ] 桌面端仍保留 hover 视觉增强
- [ ] 三个按钮的交互节奏一致（时长/缩放/阴影风格一致）

## 关联提交
- `4cba81a` `fix(frontend): 修复移动端按钮常亮并优化按压动效`
