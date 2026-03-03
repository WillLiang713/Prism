# 功能计划：重新生成按钮

## 概述

在 AI 助手回复卡片的底部操作栏中，新增一个「重新生成」按钮。  
点击后，清除当前轮次（turn）的 AI 回复数据，并使用**相同的用户 prompt 和图片**重新发起请求，获取新的回复。

---

## 功能需求

| 项目 | 描述 |
|------|------|
| 触发位置 | 每条 AI 回复卡片底部的 `message-actions` 区域，紧邻已有的「复制」按钮 |
| 触发条件 | 仅当该轮回复**不在 loading 状态**时可点击（即状态为 `complete` / `error` / `stopped`） |
| 点击行为 | 1. 清除当前 turn 的 AI 回复数据<br>2. 重新构建 UI 元素<br>3. 使用原始 prompt + 图片 + 当前配置重新调用模型 |
| 正在生成时 | 按钮禁用 (disabled)，防止重复点击 |

---

## 实现步骤

### 步骤 1：在 `createAssistantCard()` 中添加重新生成按钮

**文件**: `frontend/app.js`  
**位置**: `createAssistantCard` 函数内，在复制按钮之后（约第 3126 行）

```javascript
// 重新生成按钮
const regenerateBtn = document.createElement("button");
regenerateBtn.type = "button";
regenerateBtn.className = "action-btn regenerate-btn";
regenerateBtn.title = "重新生成";
regenerateBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="m3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg><span>重新生成</span>`;
regenerateBtn.addEventListener("click", () => {
  regenerateTurn(turn);
});

actions.appendChild(regenerateBtn);
```

同时将 `regenerateBtn` 添加到返回的对象中，以便后续控制其状态：

```javascript
return {
  // ...现有属性...
  regenerateBtn,
};
```

---

### 步骤 2：新增 `regenerateTurn()` 核心函数

**文件**: `frontend/app.js`  
**位置**: 建议放在 `stopGeneration()` 函数之后（约第 3327 行之后）

```javascript
/**
 * 重新生成指定 turn 的 AI 回复
 * 1. 找到该 turn 所属的 topic
 * 2. 如果正在生成中，先停止
 * 3. 重置 turn 的 AI 回复数据（保留 prompt / images 等用户输入）
 * 4. 重新渲染该 turn 的 UI
 * 5. 使用原始 prompt 和当前配置重新调用模型
 */
async function regenerateTurn(turn) {
  // 1. 找到 turn 所属的 topic
  const topic = state.chat.topics.find((t) =>
    Array.isArray(t.turns) && t.turns.some((tr) => tr.id === turn.id)
  );
  if (!topic) return;

  // 2. 如果该 topic 正在生成中，先停止
  if (isTopicRunning(topic.id)) {
    stopGeneration(topic.id);
  }

  // 3. 获取当前模型配置
  const config = getConfig();
  const webSearchConfig = getWebSearchConfig();

  if (!config.apiKey || !config.model) {
    await showAlert("请先配置模型", { title: "缺少配置" });
    return;
  }

  // 4. 重置 turn 的 AI 回复数据（保留用户输入）
  turn.models.main = {
    provider: config.provider,
    model: config.model,
    thinking: "",
    toolEvents: [],
    webSearchEvents: [],
    content: "",
    tokens: null,
    timeCostSec: null,
    status: "loading",
    thinkingCollapsed: true,
  };
  turn.webSearch = null;

  topic.updatedAt = Date.now();
  scheduleSaveChat();

  // 5. 找到对应的 DOM 元素并重新渲染
  const turnEl = elements.chatMessages.querySelector(
    `.turn[data-turn-id="${turn.id}"]`
  );

  if (turnEl) {
    // 移除旧的 turn 元素，用新的 turn 元素替换
    const newTurnResult = createTurnElement(turn);
    turnEl.replaceWith(newTurnResult.el);

    if (newTurnResult.cards?.main) {
      state.chat.turnUiById.set(turn.id, newTurnResult.cards.main);
    }

    // 6. 滚动到底部
    state.autoScroll = true;
    scrollToBottom(elements.chatMessages, false);

    // 7. 重新调用模型
    await callModel(
      turn.prompt,
      config,
      topic.id,
      turn,
      newTurnResult.cards.main,
      Date.now(),
      webSearchConfig
    );

    scheduleSaveChat();
  }
}
```

---

### 步骤 3：在 `applyStatus()` 中控制重新生成按钮的禁用状态

**文件**: `frontend/app.js`  
**位置**: `applyStatus` 函数内，在现有的复制按钮禁用逻辑之后（约第 3200 行之后）

在 `applyStatus` 函数中已有的 `copyBtn` 禁用逻辑附近，新增对 `regenerateBtn` 的处理：

```javascript
// 禁用/启用重新生成按钮
const regenerateBtn = message.querySelector(
  ".message-actions .action-btn.regenerate-btn"
);
if (regenerateBtn) {
  regenerateBtn.disabled = isLoading;
  regenerateBtn.style.opacity = isLoading ? "0.5" : "";
  regenerateBtn.style.cursor = isLoading ? "not-allowed" : "";
}
```

---

### 步骤 4：添加重新生成按钮的 CSS 样式

**文件**: `frontend/style.css`  
**位置**: 在 `.action-btn.copy-btn` 相关样式附近

```css
/* 重新生成按钮 */
.action-btn.regenerate-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: color 0.2s, background 0.2s, opacity 0.2s;
}

.action-btn.regenerate-btn:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--hover-bg, rgba(255, 255, 255, 0.06));
}

.action-btn.regenerate-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn.regenerate-btn svg {
  flex-shrink: 0;
}
```

---

## 数据流说明

```
用户点击"重新生成"
       │
       ▼
  regenerateTurn(turn)
       │
       ├─ 找到 turn 所属的 topic
       │
       ├─ 如果 topic 正在 running → stopGeneration()
       │
       ├─ 重置 turn.models.main（清空 content/thinking/tokens 等）
       │     ⚠ 保留 turn.prompt 和 turn.images（用户原始输入）
       │
       ├─ 从 DOM 中找到旧的 .turn 元素
       │
       ├─ 用 createTurnElement(turn) 重新创建 UI
       │    └─ replaceWith() 替换旧元素
       │
       ├─ scrollToBottom() 滚动到底部
       │
       └─ callModel() 重新请求 AI 回复
             └─ 完成后 scheduleSaveChat() 持久化
```

---

## 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 该 topic 正在生成其他 turn | 先 `stopGeneration()` 停止当前生成，再重新生成 |
| 用户未配置 API Key / Model | 弹出 `showAlert("请先配置模型")` 提示 |
| 重新生成期间用户再次点击 | 按钮处于 disabled 状态，无法重复触发 |
| 网络错误 / API 错误 | 由 `callModel` 内部的 try-catch 处理，显示错误状态 |
| 重新生成后标题是否更新 | 不重新生成标题（标题已经在首次发送时生成） |

---

## 涉及文件清单

| 文件 | 修改内容 |
|------|----------|
| `frontend/app.js` | 1. `createAssistantCard()` — 新增重新生成按钮<br>2. 新增 `regenerateTurn()` 函数<br>3. `applyStatus()` — 新增按钮禁用逻辑 |
| `frontend/style.css` | 新增 `.action-btn.regenerate-btn` 样式 |

> **后端无需修改**：重新生成使用的是与首次发送完全相同的 `/api/chat/stream` 接口。

---

## 预计工作量

- **前端逻辑**: ~80 行 JS 代码
- **样式**: ~20 行 CSS
- **测试**: 手动测试各边界场景
- **总计**: 约 30 分钟
