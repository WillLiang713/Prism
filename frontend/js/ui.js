import { state, elements, estimateTokensFromText, STORAGE_KEYS } from './state.js';
import { t } from './i18n.js';
import { renderMarkdownToElement } from './markdown.js';

const SCROLLBAR_INTERACTIVE_SELECTOR = [
  "#promptInput",
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
let topicListAlignmentBound = false;
let topicListAlignmentFrame = 0;
let topicListAlignmentResizeObserver = null;
const DEFAULT_TOPIC_TITLE = "新话题";

// Late-bound to avoid circular dependencies
let _sendPrompt = () => {};
let _stopGeneration = () => {};
let _getActiveTopic = () => null;
let _isTopicRunning = () => false;

export function setConversationFns(sendFn, stopFn) { _sendPrompt = sendFn; _stopGeneration = stopFn; }
export function setChatFns(getActiveTopicFn, isTopicRunningFn) { _getActiveTopic = getActiveTopicFn; _isTopicRunning = isTopicRunningFn; }

function getDisplayTopicTitle(title) {
  const normalized = String(title || "").trim();
  if (!normalized) return t("未命名话题");
  if (
    normalized === DEFAULT_TOPIC_TITLE ||
    /^新话题\s*\d+$/u.test(normalized) ||
    /^new topic\s*\d+$/iu.test(normalized)
  ) {
    return t("新话题");
  }
  return normalized;
}

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
    elements.sendBtn.setAttribute("aria-label", t("停止"));
  } else {
    elements.sendBtn.setAttribute("aria-label", t("发送"));
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

export function syncTopicListHeaderAlignment() {
  const topicList = elements.topicList;
  const sidebarSection = topicList?.closest(".sidebar-section");
  if (!topicList || !sidebarSection) return;

  if (
    sidebarSection.closest(".sidebar-collapsed") ||
    getComputedStyle(topicList).display === "none"
  ) {
    sidebarSection.style.setProperty("--topic-list-align-start", "0px");
    sidebarSection.style.setProperty("--topic-list-align-end", "0px");
    return;
  }

  const firstItem = topicList.querySelector(".topic-item");
  if (!(firstItem instanceof HTMLElement)) {
    sidebarSection.style.setProperty("--topic-list-align-start", "0px");
    sidebarSection.style.setProperty("--topic-list-align-end", "0px");
    return;
  }

  const listRect = topicList.getBoundingClientRect();
  const itemRect = firstItem.getBoundingClientRect();
  const alignStart = Math.max(0, Math.round((itemRect.left - listRect.left) * 100) / 100);
  const alignEnd = Math.max(0, Math.round((listRect.right - itemRect.right) * 100) / 100);

  sidebarSection.style.setProperty("--topic-list-align-start", `${alignStart}px`);
  sidebarSection.style.setProperty("--topic-list-align-end", `${alignEnd}px`);
}

function scheduleTopicListHeaderAlignment() {
  if (topicListAlignmentFrame) {
    cancelAnimationFrame(topicListAlignmentFrame);
  }
  topicListAlignmentFrame = requestAnimationFrame(() => {
    topicListAlignmentFrame = 0;
    syncTopicListHeaderAlignment();
  });
}

export function initTopicListHeaderAlignment() {
  if (topicListAlignmentBound || typeof window === "undefined") return;
  topicListAlignmentBound = true;

  scheduleTopicListHeaderAlignment();
  window.addEventListener("resize", scheduleTopicListHeaderAlignment, { passive: true });

  if (
    typeof ResizeObserver !== "undefined" &&
    elements.topicList instanceof HTMLElement
  ) {
    topicListAlignmentResizeObserver = new ResizeObserver(() => {
      scheduleTopicListHeaderAlignment();
    });
    topicListAlignmentResizeObserver.observe(elements.topicList);
  }
}

export function initScrollbarAutoHide() {
  if (scrollbarAutoHideBound || typeof document === "undefined") return;
  scrollbarAutoHideBound = true;

  document.querySelectorAll(SCROLLBAR_INTERACTIVE_SELECTOR).forEach((container) => {
    container.classList.remove(SCROLLBAR_ACTIVE_CLASS);
  });

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
  const title = getDisplayTopicTitle(topic?.title);
  const count = Array.isArray(topic?.turns) ? topic.turns.length : 0;

  if (elements.headerSessionInfo) {
    elements.headerSessionInfo.textContent = t("话题：{title} · {count} 条", {
      title,
      count,
    });
  }
}

export function startHeaderClock() {
  updateHeaderMeta();
}

export function applyStatus(statusEl, status) {
  const map = {
    ready: { cls: "ready", text: t("就绪") },
    loading: { cls: "loading", text: t("生成中...") },
    complete: { cls: "complete", text: t("完成") },
    error: { cls: "error", text: t("错误") },
    stopped: { cls: "ready", text: t("已停止") },
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

    const regenerateBtn = message.querySelector(
      ".message-actions .action-btn.regenerate-btn"
    );
    if (regenerateBtn) {
      regenerateBtn.dataset.status = status;
      regenerateBtn.disabled = isLoading;
      regenerateBtn.style.opacity = isLoading ? "0.5" : "";
      regenerateBtn.style.cursor = isLoading ? "not-allowed" : "";
    }
  }
}

export function updateTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  state.theme = nextTheme;
  localStorage.setItem(STORAGE_KEYS.theme, nextTheme);
  document.documentElement.setAttribute("data-theme", nextTheme);
}

function resolveSystemTheme() {
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

export function toggleTheme() {
  updateTheme(state.theme === "dark" ? "light" : "dark");
}

export function initTheme() {
  const savedTheme = state.theme;
  const initialTheme =
    savedTheme === "light" || savedTheme === "dark"
      ? savedTheme
      : resolveSystemTheme();
  updateTheme(initialTheme);
}
