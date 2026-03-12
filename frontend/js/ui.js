import { state, elements, estimateTokensFromText } from './state.js';
import { renderMarkdownToElement } from './markdown.js';

const SCROLLBAR_INTERACTIVE_SELECTOR = [
  ".chat-messages",
  ".topic-list",
  ".image-preview-container",
  ".modal-content .config-content",
  "#configModal .config-content",
  ".prompt-list",
  ".web-search-body",
  ".tool-calls-detail",
].join(", ");
const SCROLLBAR_ACTIVE_CLASS = "scrollbar-active";
const SCROLLBAR_HIDE_DELAY_MS = 900;
const scrollbarHideTimers = new WeakMap();
let scrollbarAutoHideBound = false;

// Late-bound to avoid circular dependencies
let _sendPrompt = () => {};
let _stopGeneration = () => {};
let _getActiveTopic = () => null;
let _isTopicRunning = () => false;

export function setConversationFns(sendFn, stopFn) { _sendPrompt = sendFn; _stopGeneration = stopFn; }
export function setChatFns(getActiveTopicFn, isTopicRunningFn) { _getActiveTopic = getActiveTopicFn; _isTopicRunning = isTopicRunningFn; }

export function autoGrowPromptInput() {
  const el = elements.promptInput;
  if (!el) return;

  if (!el.value) {
    el.style.height = "";
    el.style.overflowY = "hidden";
    return;
  }

  const maxHeight = 160; // 与 CSS max-height 保持一致
  el.style.height = "0px";
  const nextHeight = Math.min(el.scrollHeight, maxHeight);
  el.style.height = `${nextHeight}px`;
  el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
}

export function setSendButtonMode(mode) {
  if (!elements.sendBtn) return;
  const nextMode = mode === "stop" ? "stop" : "send";
  elements.sendBtn.dataset.mode = nextMode;
  if (nextMode === "stop") {
    elements.sendBtn.title = "停止生成";
    elements.sendBtn.setAttribute("aria-label", "停止生成");
  } else {
    elements.sendBtn.title = "发送";
    elements.sendBtn.setAttribute("aria-label", "发送");
  }
}

export function onSendButtonClick() {
  if (_isTopicRunning(state.chat.activeTopicId)) _stopGeneration();
  else _sendPrompt();
}

// 更新滚动到底部按钮的显示状态
export function updateScrollToBottomButton() {
  if (!elements.chatMessages || !elements.scrollToBottomBtn) return;

  const { scrollTop, scrollHeight, clientHeight } = elements.chatMessages;
  const nearBottom = scrollHeight - scrollTop - clientHeight < 100;

  // 如果接近底部，隐藏按钮；否则显示按钮
  elements.scrollToBottomBtn.style.display = nearBottom ? "none" : "flex";
}

export function isNearBottom(container, thresholdPx = 150) {
  if (!container) return true;
  const remaining =
    container.scrollHeight - container.scrollTop - container.clientHeight;
  // 增加阈值到 150px，并且考虑浮点数误差
  return remaining <= thresholdPx || remaining < 1;
}

export function scrollToBottom(container, smooth = false) {
  if (!container) return;
  if (smooth) {
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  } else {
    container.scrollTop = container.scrollHeight;
  }
}

function resolveScrollableContainer(target) {
  if (!(target instanceof Element)) return null;
  return target.closest(SCROLLBAR_INTERACTIVE_SELECTOR);
}

function clearHideTimer(container) {
  const timer = scrollbarHideTimers.get(container);
  if (timer) {
    clearTimeout(timer);
    scrollbarHideTimers.delete(container);
  }
}

function scheduleScrollbarHide(container, delayMs = SCROLLBAR_HIDE_DELAY_MS) {
  if (!container) return;
  clearHideTimer(container);
  const timer = setTimeout(() => {
    container.classList.remove(SCROLLBAR_ACTIVE_CLASS);
    scrollbarHideTimers.delete(container);
  }, delayMs);
  scrollbarHideTimers.set(container, timer);
}

function activateScrollbar(container, keepVisibleMs = SCROLLBAR_HIDE_DELAY_MS) {
  if (!container) return;
  container.classList.add(SCROLLBAR_ACTIVE_CLASS);
  scheduleScrollbarHide(container, keepVisibleMs);
}

export function initScrollbarAutoHide() {
  if (scrollbarAutoHideBound || typeof document === "undefined") return;
  scrollbarAutoHideBound = true;

  document.querySelectorAll(SCROLLBAR_INTERACTIVE_SELECTOR).forEach((container) => {
    container.classList.remove(SCROLLBAR_ACTIVE_CLASS);
  });

  document.addEventListener(
    "pointerover",
    (e) => {
      const container = resolveScrollableContainer(e.target);
      if (container) activateScrollbar(container);
    },
    true
  );

  document.addEventListener(
    "pointerout",
    (e) => {
      const container = resolveScrollableContainer(e.target);
      if (!container) return;
      const nextContainer = resolveScrollableContainer(e.relatedTarget);
      if (nextContainer === container) return;
      scheduleScrollbarHide(container, 260);
    },
    true
  );

  document.addEventListener(
    "pointerdown",
    (e) => {
      const container = resolveScrollableContainer(e.target);
      if (!container) return;
      activateScrollbar(container, 1200);
    },
    true
  );

  document.addEventListener(
    "wheel",
    (e) => {
      const container = resolveScrollableContainer(e.target);
      if (container) activateScrollbar(container, 1200);
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      const container = resolveScrollableContainer(e.target);
      if (container) activateScrollbar(container, 1200);
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    "scroll",
    (e) => {
      const container = resolveScrollableContainer(e.target);
      if (container) activateScrollbar(container, 1200);
    },
    true
  );
}

export function updateHeaderMeta() {
  const topic = _getActiveTopic();
  const title = (topic?.title || "未命名话题").trim() || "未命名话题";
  const count = Array.isArray(topic?.turns) ? topic.turns.length : 0;

  if (elements.headerSessionInfo) {
    elements.headerSessionInfo.textContent = `会话：${title} · ${count} 条`;
  }
}

export function startHeaderClock() {
  updateHeaderMeta();
}

export function applyStatus(statusEl, status) {
  const map = {
    ready: { cls: "ready", text: "就绪" },
    loading: { cls: "loading", text: "生成中..." },
    complete: { cls: "complete", text: "完成" },
    error: { cls: "error", text: "错误" },
    stopped: { cls: "ready", text: "已停止" },
  };
  const next = map[status] || map.ready;
  statusEl.className = `status ${next.cls}`;
  statusEl.textContent = next.text;

  // 同步更新消息的loading状态类和复制按钮状态
  const message = statusEl.closest(".assistant-message");
  if (message) {
    const isLoading = status === "loading";
    if (isLoading) {
      message.classList.add("loading");
      message.classList.remove("streaming");
    } else {
      message.classList.remove("loading");
      message.classList.remove("streaming");
    }

    // 禁用/启用消息的复制按钮
    const copyBtn = message.querySelector(
      ".message-actions .action-btn.copy-btn"
    );
    if (copyBtn) {
      copyBtn.disabled = isLoading;
      copyBtn.style.opacity = isLoading ? "0.5" : "";
      copyBtn.style.cursor = isLoading ? "not-allowed" : "";
    }

    // 禁用/启用所有代码块的复制按钮
    const codeBlockCopyBtns = message.querySelectorAll(".code-copy-btn");
    codeBlockCopyBtns.forEach((btn) => {
      btn.disabled = isLoading;
      btn.style.opacity = isLoading ? "0.5" : "";
      btn.style.cursor = isLoading ? "not-allowed" : "";
    });
  }
}
