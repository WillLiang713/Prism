import { state, elements, STORAGE_KEYS, createId, formatTime } from './state.js';
import { renderMarkdownToElement, createCopyButton } from './markdown.js';
import { reconcileHtmlPreviewWithTopic } from './html-preview.js';
import { renderWebSearchSection, renderToolEvents, mergeToolEventsWithWebSearch, renderSources, renderSourcesStatus, renderSourcesToggle } from './web-search.js';
import { setSendButtonMode, applyStatus, scrollToBottom, updateScrollToBottomButton, updateHeaderMeta } from './ui.js';
import { showConfirm, openImagePreview } from './dialog.js';
import { collapseSidebarForMobile, isMobileLayout } from './layout.js';
import { syncDesktopBackendUi } from './desktop.js';
import { resolveModelDisplayName } from './config.js';
import { estimateTokensFromText } from './state.js';
import {
  rememberDropdownOrigin,
  restoreDropdownOrigin,
  clearBodyDropdownPosition,
} from './dropdown.js';

const PRESS_START_EVENT =
  typeof window !== "undefined" && "PointerEvent" in window
    ? "pointerdown"
    : "mousedown";

let _stopGeneration = () => {};
export function setStopGeneration(fn) { _stopGeneration = fn; }
let _regenerateTurn = async () => {};
export function setRegenerateTurn(fn) { _regenerateTurn = fn; }
let _submitTurnEdit = async () => false;
export function setSubmitTurnEdit(fn) { _submitTurnEdit = fn; }
let _regenerateTopicTitle = async () => false;
export function setRegenerateTopicTitle(fn) { _regenerateTopicTitle = fn; }
let openTopicActionMenuId = null;
let floatingTopicActionMenuEl = null;
let floatingTopicActionTriggerEl = null;

export function setEmptyThreadState(isEmpty) {
  const chatThread = document.querySelector(".chat-thread");
  if (!chatThread) return;
  chatThread.classList.toggle("is-empty", isEmpty);
}

function createEmptyChatState() {
  const empty = document.createElement("div");
  empty.className = "empty-chat-state";

  const title = document.createElement("div");
  title.className = "empty-chat-title";
  title.textContent = "从这里开始";

  const description = document.createElement("div");
  description.className = "empty-chat-description";
  description.textContent = "输入一个问题、需求，或者直接贴一段内容。";

  empty.appendChild(title);
  empty.appendChild(description);
  return empty;
}

function syncTopicActionButtons(topicId) {
  if (!topicId || topicId !== state.chat.activeTopicId || !elements.chatMessages) {
    return;
  }
  const disableRegenerate = isTopicRunning(topicId);
  const buttons = elements.chatMessages.querySelectorAll(".regenerate-btn");
  buttons.forEach((button) => {
    const isLoading = button.dataset.status === "loading";
    if (button.dataset.topicId !== topicId) return;
    button.disabled = disableRegenerate || isLoading;
  });
  const editButtons = elements.chatMessages.querySelectorAll(
    ".user-edit-trigger"
  );
  editButtons.forEach((button) => {
    if (button.dataset.topicId !== topicId) return;
    button.disabled = disableRegenerate;
  });
  const submitButtons = elements.chatMessages.querySelectorAll(".user-edit-submit");
  submitButtons.forEach((button) => {
    if (button.dataset.topicId !== topicId) return;
    const wrap = button.closest(".user-bubble-wrap");
    const input = wrap?.querySelector(".user-edit-input");
    const hasImages = button.dataset.hasImages === "1";
    const isEmpty = !String(input?.value || "").trim() && !hasImages;
    button.disabled = disableRegenerate || isEmpty;
  });
}

function getTurnEditDraft(turn) {
  if (!turn?.id) return "";
  if (state.chat.editDraftByTurnId.has(turn.id)) {
    return state.chat.editDraftByTurnId.get(turn.id);
  }
  return String(turn.prompt || "");
}

function clearTurnEditState(turnId = state.chat.editingTurnId) {
  if (!turnId) return;
  if (state.chat.editingTurnId === turnId) {
    state.chat.editingTurnId = null;
  }
  state.chat.editDraftByTurnId.delete(turnId);
}

function markActiveTopicTurnsWithoutAnimation() {
  const topic = getActiveTopic();
  if (!topic || !Array.isArray(topic.turns)) return;
  topic.turns.forEach((turn) => {
    if (turn?.id) state.chat.turnIdsWithoutAnimation.add(turn.id);
  });
}

function resizeTurnEditor(editorEl) {
  if (!editorEl) return;
  const fixedHeight = 72;
  editorEl.style.height = `${fixedHeight}px`;
  const hasOverflow = editorEl.scrollHeight > fixedHeight;
  editorEl.style.overflowY = hasOverflow ? "auto" : "hidden";
  editorEl.classList.toggle("scrollbar-active", hasOverflow);
}

function focusTurnEditor(turnId) {
  if (!turnId) return;
  requestAnimationFrame(() => {
    const editor = elements.chatMessages?.querySelector(
      `.user-edit-input[data-turn-id="${turnId}"]`
    );
    if (!(editor instanceof HTMLTextAreaElement)) return;
    resizeTurnEditor(editor);
    editor.focus();
    const len = editor.value.length;
    editor.setSelectionRange(len, len);
  });
}

function startEditingTurn(turn) {
  if (!turn?.id || isTopicRunning(state.chat.activeTopicId)) return;
  markActiveTopicTurnsWithoutAnimation();
  state.chat.editingTurnId = turn.id;
  state.chat.editDraftByTurnId.set(turn.id, String(turn.prompt || ""));
  renderChatMessages();
  focusTurnEditor(turn.id);
}

function cancelEditingTurn(turnId = state.chat.editingTurnId) {
  markActiveTopicTurnsWithoutAnimation();
  clearTurnEditState(turnId);
  renderChatMessages();
}

function createUserImagesContainer(
  images,
  {
    containerClass = "user-images",
    itemClass = "user-image-item",
    imageClass = "",
  } = {}
) {
  if (!Array.isArray(images) || images.length === 0) return null;

  const imagesContainer = document.createElement("div");
  imagesContainer.className = containerClass;

  for (const image of images) {
    const imgWrapper = document.createElement("button");
    imgWrapper.type = "button";
    imgWrapper.className = `${itemClass} user-image-trigger`;
    imgWrapper.setAttribute(
      "aria-label",
      `查看图片${image.name ? `：${image.name}` : ""}`
    );
    imgWrapper.addEventListener("click", () => {
      openImagePreview({
        src: image.dataUrl,
        alt: image.name || "用户上传的图片",
        trigger: imgWrapper,
      });
    });

    const img = document.createElement("img");
    img.src = image.dataUrl;
    img.alt = image.name || "用户上传的图片";
    img.loading = "lazy";
    if (imageClass) img.className = imageClass;

    imgWrapper.appendChild(img);
    imagesContainer.appendChild(imgWrapper);
  }

  return imagesContainer;
}

function resolveAssistantImageUrl(image) {
  if (typeof image === "string") {
    return image.trim();
  }
  if (!image || typeof image !== "object") {
    return "";
  }
  if (typeof image.url === "string" && image.url.trim()) {
    return image.url.trim();
  }
  if (typeof image.dataUrl === "string" && image.dataUrl.trim()) {
    return image.dataUrl.trim();
  }
  const imageValue = image.image_url;
  if (imageValue && typeof imageValue === "object") {
    return String(imageValue.url || "").trim();
  }
  return String(imageValue || "").trim();
}

export function renderAssistantImages(container, images) {
  if (!(container instanceof HTMLElement)) return;

  container.innerHTML = "";
  const normalizedImages = Array.isArray(images) ? images : [];
  const seen = new Set();
  let count = 0;

  for (const image of normalizedImages) {
    const imageUrl = resolveAssistantImageUrl(image);
    if (!imageUrl || seen.has(imageUrl)) continue;
    seen.add(imageUrl);
    count += 1;

    const imageButton = document.createElement("button");
    imageButton.type = "button";
    imageButton.className = "assistant-image-item user-image-trigger";
    imageButton.setAttribute("aria-label", `查看生成图片 ${count}`);
    imageButton.addEventListener("click", () => {
      openImagePreview({
        src: imageUrl,
        alt: `生成图片 ${count}`,
        trigger: imageButton,
      });
    });

    const img = document.createElement("img");
    img.src = imageUrl;
    img.alt = `生成图片 ${count}`;
    img.loading = "lazy";
    imageButton.appendChild(img);
    container.appendChild(imageButton);
  }

  container.hidden = count === 0;
}

async function handleSubmitTurnEdit(turn) {
  if (!turn?.id || isTopicRunning(state.chat.activeTopicId)) return false;
  const draft = getTurnEditDraft(turn);
  clearTurnEditState(turn.id);
  const ok = await _submitTurnEdit(turn, draft);
  if (!ok) {
    state.chat.editingTurnId = turn.id;
    state.chat.editDraftByTurnId.set(turn.id, draft);
    renderChatMessages();
    focusTurnEditor(turn.id);
    return false;
  }
  return true;
}

function createIconActionButton({
  className = "",
  title = "",
  ariaLabel = "",
  path = "",
}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  if (ariaLabel) button.setAttribute("aria-label", ariaLabel);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  svg.innerHTML = path;
  button.appendChild(svg);
  return button;
}

function setSourcesPanelExpanded(panelEl, buttonEl, expanded) {
  if (!panelEl || !buttonEl) return;
  panelEl.hidden = !expanded;
  panelEl.dataset.expanded = expanded ? "1" : "0";
  buttonEl.setAttribute("aria-expanded", expanded ? "true" : "false");
  buttonEl.classList.toggle("is-active", expanded);
}

function stripMarkdownForThinkingSummary(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~>#-]+/g, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeThinkingText(thinkingText) {
  return String(thinkingText || "")
    .replace(/\r/g, "")
    .replace(/\*\*\*\*/g, "**\n\n**")
    .replace(/____/g, "__\n\n__");
}

function extractThinkingSummary(thinkingText) {
  const normalizedText = normalizeThinkingText(thinkingText);
  const raw = normalizedText.trim();
  if (!raw) return "";
  const hasTrailingNewline = /\n\s*$/.test(normalizedText);

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let latestTitle = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const isLastLine = index === lines.length - 1;
    if (isLastLine && !hasTrailingNewline) continue;
    if (line.startsWith("```")) continue;

    let candidate = "";
    if (/^#{1,6}\s+/.test(line)) {
      candidate = line.replace(/^#{1,6}\s+/, "");
    } else if (/^\*\*[^*]+\*\*$/.test(line) || /^__[^_]+__$/.test(line)) {
      candidate = line.replace(/^\*\*|\*\*$|^__|__$/g, "");
    } else {
      const plain = stripMarkdownForThinkingSummary(line);
      const looksLikeTitle =
        plain.length >= 4 &&
        plain.length <= 72 &&
        !/[。！？.!?：:]$/.test(plain);
      if (looksLikeTitle) candidate = plain;
    }

    candidate = stripMarkdownForThinkingSummary(candidate);
    if (!candidate) continue;
    latestTitle = candidate;
  }

  if (latestTitle) return latestTitle;
  return "";
}

function buildThinkingLabel(
  thinkingText,
  isComplete = false,
  previousLabel = "",
  thinkingTimeSec = null
) {
  if (isComplete && String(thinkingText || "").trim()) {
    return formatThinkingCompleteLabel(thinkingTimeSec);
  }
  const summary = extractThinkingSummary(thinkingText);
  if (summary) return summary;
  return previousLabel || "思考中";
}

function formatThinkingCompleteLabel(thinkingTimeSec = null) {
  if (!Number.isFinite(thinkingTimeSec)) return "思考完成";
  return `思考完成，用时 ${thinkingTimeSec.toFixed(1)} 秒`;
}

export function isTopicRunning(topicId) {
  return !!topicId && state.chat.runningControllers.has(topicId);
}

export function syncSendButtonModeByActiveTopic() {
  const activeTopicId = state.chat.activeTopicId;
  setSendButtonMode(isTopicRunning(activeTopicId) ? "stop" : "send");
  syncDesktopBackendUi();
}

export function markTopicRunning(topicId, controller) {
  if (!topicId || !controller) return;
  state.chat.runningControllers.set(topicId, controller);
  if (topicId === state.chat.activeTopicId) {
    syncSendButtonModeByActiveTopic();
  }
  syncTopicActionButtons(topicId);
  renderTopicList();
}

export function unmarkTopicRunning(topicId, controller) {
  if (!topicId) return;
  const current = state.chat.runningControllers.get(topicId);
  if (controller && current && current !== controller) return;
  state.chat.runningControllers.delete(topicId);
  if (topicId === state.chat.activeTopicId) {
    syncSendButtonModeByActiveTopic();
  }
  syncTopicActionButtons(topicId);
  renderTopicList();
}

export function getLiveTurnUi(topicId, turnId, fallbackUi) {
  const liveUi = state.chat.turnUiById.get(turnId);
  if (liveUi?.statusEl?.isConnected) return liveUi;

  const fallbackIsLive = !!fallbackUi?.statusEl?.isConnected;
  if (topicId !== state.chat.activeTopicId) {
    return fallbackIsLive ? fallbackUi : null;
  }

  renderChatMessages();
  const reboundUi = state.chat.turnUiById.get(turnId);
  if (reboundUi?.statusEl?.isConnected) return reboundUi;

  return fallbackIsLive ? fallbackUi : null;
}

export function initChat() {
  const topicsRaw = localStorage.getItem(STORAGE_KEYS.topics);
  const activeRaw = localStorage.getItem(STORAGE_KEYS.activeTopicId);

  if (topicsRaw) {
    try {
      const parsed = JSON.parse(topicsRaw);
      if (Array.isArray(parsed)) {
        state.chat.topics = parsed;
        for (const topic of state.chat.topics) {
          if (
            typeof topic?.title === "string" &&
            /^新话题\s*\d+$/.test(topic.title.trim())
          ) {
            topic.title = "新话题";
          }
          // 兼容旧数据：将 models.A 迁移为 models.main
          if (Array.isArray(topic.turns)) {
            for (const turn of topic.turns) {
              if (turn.models?.A && !turn.models.main) {
                turn.models.main = turn.models.A;
              }
              delete turn.models.A;
              delete turn.models.B;
            }
          }
        }
      }
    } catch (e) {
      console.error("加载话题失败:", e);
    }
  }

  if (activeRaw && state.chat.topics.some((t) => t.id === activeRaw)) {
    state.chat.activeTopicId = activeRaw;
  }

  if (!state.chat.topics.length) {
    const topic = createTopic();
    state.chat.activeTopicId = topic.id;
    saveChatState();
  }

  if (!state.chat.activeTopicId) {
    state.chat.activeTopicId = state.chat.topics[0].id;
  }
}

export function scheduleSaveChat() {
  if (state.chat.saveTimer) clearTimeout(state.chat.saveTimer);
  state.chat.saveTimer = setTimeout(() => {
    state.chat.saveTimer = null;
    saveChatState();
  }, 500);
}

export function saveChatState() {
  try {
    localStorage.setItem(
      STORAGE_KEYS.topics,
      JSON.stringify(state.chat.topics)
    );
    if (state.chat.activeTopicId)
      localStorage.setItem(
        STORAGE_KEYS.activeTopicId,
        state.chat.activeTopicId
      );
  } catch (e) {
    console.error("保存话题失败:", e);
  }
}

export function createTopic(forceCreate = false) {
  // 检查是否已存在空的新话题（避免重复创建）
  if (!forceCreate) {
    const emptyNewTopic = state.chat.topics.find(
      (t) =>
        t.title === "新话题" &&
        t.turns.length === 0
    );

    if (emptyNewTopic) {
      return emptyNewTopic;
    }
  }

  const now = Date.now();
  const topic = {
    id: createId(),
    title: "新话题",
    createdAt: now,
    updatedAt: now,
    turns: [],
  };

  state.chat.topics.unshift(topic);
  scheduleSaveChat();
  return topic;
}

export function deleteTopic(topicId) {
  _stopGeneration(topicId);
  if (openTopicActionMenuId === topicId) {
    openTopicActionMenuId = null;
  }
  const topic = state.chat.topics.find((item) => item.id === topicId) || null;
  if (topic && state.chat.editingTurnId) {
    const editingTurnExists = Array.isArray(topic.turns) &&
      topic.turns.some((turn) => turn.id === state.chat.editingTurnId);
    if (editingTurnExists) {
      clearTurnEditState(state.chat.editingTurnId);
    }
  }
  const before = state.chat.topics.length;
  state.chat.topics = state.chat.topics.filter((t) => t.id !== topicId);
  if (!state.chat.topics.length) {
    const topic = createTopic();
    state.chat.activeTopicId = topic.id;
  } else if (state.chat.activeTopicId === topicId) {
    state.chat.activeTopicId = state.chat.topics[0].id;
  }
  if (before !== state.chat.topics.length) scheduleSaveChat();
}

export function deleteTurn(turnId, topicId = state.chat.activeTopicId) {
  if (!turnId || !topicId) return false;

  const topic = state.chat.topics.find((item) => item.id === topicId) || null;
  if (!topic || !Array.isArray(topic.turns)) return false;

  const turnIndex = topic.turns.findIndex((turn) => turn?.id === turnId);
  if (turnIndex < 0) return false;

  if (state.chat.editingTurnId === turnId) {
    clearTurnEditState(turnId);
  }
  state.chat.turnUiById.delete(turnId);

  topic.turns.splice(turnIndex, 1);
  topic.updatedAt = Date.now();
  scheduleSaveChat();
  return true;
}

export async function requestDeleteTopic(topicId = state.chat.activeTopicId) {
  const topic = state.chat.topics.find((item) => item.id === topicId);
  if (!topic) return false;

  if (isTopicRunning(topic.id)) {
    const stopThenDelete = await showConfirm(
      "该话题正在生成中，删除前会先停止生成，是否继续？",
      {
        title: "删除话题",
        okText: "继续",
      }
    );
    if (!stopThenDelete) return false;
  }

  const confirmed = await showConfirm(
    `确定要删除话题「${topic.title || "未命名话题"}」吗？`,
    {
      title: "删除话题",
      okText: "删除",
      danger: true,
      hint: "",
    }
  );
  if (!confirmed) return false;

  deleteTopic(topic.id);
  renderAll();
  return true;
}

export async function requestDeleteTurn(turn, topicId = state.chat.activeTopicId) {
  if (!turn?.id || !topicId) return false;

  const topic = state.chat.topics.find((item) => item.id === topicId) || null;
  if (!topic || !Array.isArray(topic.turns)) return false;

  const targetTurn = topic.turns.find((item) => item?.id === turn.id) || null;
  if (!targetTurn) return false;

  if (isTopicRunning(topic.id)) {
    const stopThenDelete = await showConfirm(
      "当前消息正在生成中，删除前会先停止生成，是否继续？",
      {
        title: "删除消息",
        okText: "继续",
      }
    );
    if (!stopThenDelete) return false;
  }

  const promptPreview = String(targetTurn.prompt || "").trim();
  const messageLabel = promptPreview
    ? `这条消息“${promptPreview.slice(0, 30)}${promptPreview.length > 30 ? "..." : ""}”`
    : "这条消息";
  const confirmed = await showConfirm(`确定要删除${messageLabel}吗？`, {
    title: "删除消息",
    okText: "删除",
    danger: true,
    hint: "",
  });
  if (!confirmed) return false;

  if (isTopicRunning(topic.id)) {
    _stopGeneration(topic.id);
  }

  if (!deleteTurn(targetTurn.id, topic.id)) {
    return false;
  }

  renderAll();
  return true;
}

export function getActiveTopic() {
  return (
    state.chat.topics.find((t) => t.id === state.chat.activeTopicId) || null
  );
}

export function setActiveTopic(topicId) {
  state.chat.activeTopicId = topicId;
  localStorage.setItem(STORAGE_KEYS.activeTopicId, topicId);
  syncSendButtonModeByActiveTopic();
}

export function renderAll() {
  renderTopicList();
  renderChatMessages();
  syncSendButtonModeByActiveTopic();
}

function positionFloatingTopicActionMenu() {
  if (!(floatingTopicActionMenuEl instanceof HTMLElement) || !(floatingTopicActionTriggerEl instanceof HTMLElement)) {
    return;
  }

  if (isMobileLayout()) {
    const viewportPadding = 12;
    const gap = 8;
    const triggerRect = floatingTopicActionTriggerEl.getBoundingClientRect();
    const maxWidth = Math.max(104, window.innerWidth - viewportPadding * 2);

    floatingTopicActionMenuEl.style.position = "fixed";
    floatingTopicActionMenuEl.style.left = "0px";
    floatingTopicActionMenuEl.style.top = "0px";
    floatingTopicActionMenuEl.style.right = "auto";
    floatingTopicActionMenuEl.style.bottom = "auto";
    floatingTopicActionMenuEl.style.width = "";
    floatingTopicActionMenuEl.style.minWidth = "104px";
    floatingTopicActionMenuEl.style.maxWidth = `${maxWidth}px`;

    const width = Math.min(
      Math.max(floatingTopicActionMenuEl.offsetWidth, 104),
      maxWidth
    );
    const height = floatingTopicActionMenuEl.offsetHeight;
    const left = Math.min(
      Math.max(viewportPadding, Math.round(triggerRect.right - width)),
      Math.max(viewportPadding, window.innerWidth - viewportPadding - width)
    );

    let top = Math.round(triggerRect.bottom + gap);
    if (top + height > window.innerHeight - viewportPadding) {
      top = Math.max(
        viewportPadding,
        Math.round(triggerRect.top - gap - height)
      );
    }

    floatingTopicActionMenuEl.style.left = `${left}px`;
    floatingTopicActionMenuEl.style.top = `${top}px`;
    floatingTopicActionMenuEl.style.width = `${width}px`;
    return;
  }

  const triggerRect = floatingTopicActionTriggerEl.getBoundingClientRect();
  const menuRect = floatingTopicActionMenuEl.getBoundingClientRect();
  const viewportPadding = 12;
  const gap = 8;
  let left = Math.round(triggerRect.right + gap);
  if (left + menuRect.width > window.innerWidth - viewportPadding) {
    left = Math.max(
      viewportPadding,
      Math.round(triggerRect.left - gap - menuRect.width)
    );
  }

  let top = Math.round(triggerRect.top);
  if (top + menuRect.height > window.innerHeight - viewportPadding) {
    top = Math.max(
      viewportPadding,
      Math.round(window.innerHeight - viewportPadding - menuRect.height)
    );
  }

  floatingTopicActionMenuEl.style.left = `${left}px`;
  floatingTopicActionMenuEl.style.top = `${top}px`;
}

function closeFloatingTopicActionMenu() {
  if (!(floatingTopicActionMenuEl instanceof HTMLElement)) {
    floatingTopicActionTriggerEl = null;
    return;
  }
  floatingTopicActionMenuEl.classList.remove("is-floating-topic-menu");
  floatingTopicActionMenuEl.style.visibility = "";
  clearBodyDropdownPosition(floatingTopicActionMenuEl);
  floatingTopicActionMenuEl.style.left = "";
  floatingTopicActionMenuEl.style.top = "";
  floatingTopicActionMenuEl.hidden = true;
  restoreDropdownOrigin(floatingTopicActionMenuEl);
  floatingTopicActionMenuEl = null;
  floatingTopicActionTriggerEl = null;
}

function openFloatingTopicActionMenu(menuEl, triggerEl) {
  if (!(menuEl instanceof HTMLElement) || !(triggerEl instanceof HTMLElement)) return;
  rememberDropdownOrigin(menuEl);
  if (menuEl.parentElement !== document.body) {
    document.body.appendChild(menuEl);
  }
  menuEl.hidden = false;
  menuEl.classList.add("is-floating-topic-menu");
  menuEl.style.visibility = "hidden";
  floatingTopicActionMenuEl = menuEl;
  floatingTopicActionTriggerEl = triggerEl;
  positionFloatingTopicActionMenu();
  menuEl.style.visibility = "visible";
  window.requestAnimationFrame(() => {
    positionFloatingTopicActionMenu();
  });
}

function syncTopicActionMenuUi() {
  if (!elements.topicList) return;
  const items = elements.topicList.querySelectorAll(".topic-item");
  items.forEach((item) => {
    const isOpen = item.dataset.topicId === openTopicActionMenuId;
    item.classList.toggle("topic-menu-open", isOpen);
    const trigger = item.querySelector(".topic-action-trigger");
    if (trigger) {
      trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }
    const menu = item.querySelector(".topic-action-dropdown");
    if (menu) {
      if (isOpen && trigger) {
        openFloatingTopicActionMenu(menu, trigger);
      } else if (menu !== floatingTopicActionMenuEl) {
        menu.hidden = true;
      }
    }
  });
}

function setTopicActionMenu(topicId = null) {
  closeFloatingTopicActionMenu();
  openTopicActionMenuId = topicId;
  syncTopicActionMenuUi();
}

export function closeTopicActionMenu() {
  if (!openTopicActionMenuId) return;
  setTopicActionMenu(null);
}

export function renderTopicList() {
  if (!elements.topicList) return;
  closeFloatingTopicActionMenu();

  // 清空列表
  elements.topicList.innerHTML = "";

  const topics = [...state.chat.topics].sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
  );
  const onlyTopic = topics[0] || null;
  const hideDeleteForOnlyNewTopic =
    topics.length === 1 &&
    (onlyTopic?.title || "").trim().startsWith("新话题") &&
    (!Array.isArray(onlyTopic?.turns) || onlyTopic.turns.length === 0);

  for (const topic of topics) {
    const item = document.createElement("div");
    const isGeneratingTitle = state.chat.generatingTitleTopicIds.has(topic.id);
    const isGenerating = isTopicRunning(topic.id);
    const isActionMenuOpen = openTopicActionMenuId === topic.id;
    const canRegenerateTitle =
      Array.isArray(topic.turns) && topic.turns.some((turn) => !!String(turn?.prompt || "").trim());
    const topicTitle = (topic.title || "未命名话题").trim() || "未命名话题";
    item.className = `topic-item${
      topic.id === state.chat.activeTopicId ? " active" : ""
    }${isGeneratingTitle ? " generating-title" : ""}${
      isGenerating ? " running" : ""
    }${isActionMenuOpen ? " topic-menu-open" : ""
    }`;
    item.dataset.topicId = topic.id;
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.setAttribute("aria-label", `切换到话题：${topicTitle}`);

    const title = document.createElement("div");
    title.className = "topic-title";
    title.textContent = topicTitle;

    const meta = document.createElement("div");
    meta.className = "topic-meta";
    meta.textContent = `${topic.turns?.length || 0} 条${
      isGenerating ? " · 生成中" : ""
    } · ${formatTime(
      topic.updatedAt || topic.createdAt
    )}`;

    const footer = document.createElement("div");
    footer.className = "topic-footer";
    footer.appendChild(meta);

    const content = document.createElement("div");
    content.className = "topic-content";
    content.appendChild(title);
    content.appendChild(footer);

    if (!hideDeleteForOnlyNewTopic) {
      const actionWrap = document.createElement("div");
      actionWrap.className = "topic-action-menu";
      actionWrap.addEventListener("click", (e) => {
        e.stopPropagation();
      });
      actionWrap.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setTopicActionMenu(null);
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
        }
      });

      const moreBtn = document.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "topic-action-trigger";
      moreBtn.setAttribute("aria-label", `更多操作：${topic.title || "未命名话题"}`);
      moreBtn.setAttribute("aria-haspopup", "menu");
      moreBtn.setAttribute("aria-expanded", isActionMenuOpen ? "true" : "false");
      moreBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="6" cy="12" r="1.7"></circle>
          <circle cx="12" cy="12" r="1.7"></circle>
          <circle cx="18" cy="12" r="1.7"></circle>
        </svg>
        <span class="sr-only">更多操作</span>
      `;
      let suppressClickUntil = 0;
      const toggleTopicActionMenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const nextTopicId = openTopicActionMenuId === topic.id ? null : topic.id;
        setTopicActionMenu(nextTopicId);
      };
      moreBtn.addEventListener(PRESS_START_EVENT, (e) => {
        if ("button" in e && e.button !== 0) return;
        suppressClickUntil = Date.now() + 400;
        toggleTopicActionMenu(e);
      });
      moreBtn.addEventListener("click", (e) => {
        if (Date.now() <= suppressClickUntil) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        toggleTopicActionMenu(e);
      });

      const menu = document.createElement("div");
      menu.className = "topic-action-dropdown";
      menu.setAttribute("role", "menu");
      menu.hidden = !isActionMenuOpen;

      const regenerateBtn = document.createElement("button");
      regenerateBtn.type = "button";
      regenerateBtn.className = "topic-action-item";
      regenerateBtn.setAttribute("role", "menuitem");
      regenerateBtn.disabled = isGeneratingTitle || !canRegenerateTitle;
      regenerateBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36"></path>
          <path d="M21 3v6h-6"></path>
        </svg>
        <span>${isGeneratingTitle ? "正在生成话题..." : "重新生成话题"}</span>
      `;
      regenerateBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (regenerateBtn.disabled) return;
        setTopicActionMenu(null);
        await _regenerateTopicTitle(topic.id);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "topic-action-item danger";
      deleteBtn.setAttribute("role", "menuitem");
      deleteBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 7h16"></path>
          <path d="M10 11v6"></path>
          <path d="M14 11v6"></path>
          <path d="M6 7l1 11a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-11"></path>
          <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
        </svg>
        <span>删除话题</span>
      `;
      deleteBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setTopicActionMenu(null);
        item.classList.add("delete-pending");
        try {
          await requestDeleteTopic(topic.id);
        } finally {
          if (item.isConnected) {
            item.classList.remove("delete-pending");
          }
        }
      });

      menu.appendChild(regenerateBtn);
      menu.appendChild(deleteBtn);
      actionWrap.appendChild(moreBtn);
      actionWrap.appendChild(menu);
      footer.appendChild(actionWrap);
    }

    item.appendChild(content);

    const activateTopic = () => {
      const isAlreadyActive = topic.id === state.chat.activeTopicId;
      openTopicActionMenuId = null;
      collapseSidebarForMobile();
      if (isAlreadyActive) return;

      setActiveTopic(topic.id);
      renderAll();
    };

    item.addEventListener("click", activateTopic);
    item.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activateTopic();
    });

    elements.topicList.appendChild(item);
  }

  syncTopicActionMenuUi();
  updateHeaderMeta();
}

export function renderChatMessages() {
  if (!elements.chatMessages) return;
  elements.chatMessages.innerHTML = "";
  state.chat.turnUiById.clear();

  const topic = getActiveTopic();
  if (!topic || !Array.isArray(topic.turns) || !topic.turns.length) {
    setEmptyThreadState(true);
    elements.chatMessages.appendChild(createEmptyChatState());
    if (elements.scrollToBottomBtn) {
      elements.scrollToBottomBtn.style.display = "none";
    }
    reconcileHtmlPreviewWithTopic(topic);
    return;
  }

  setEmptyThreadState(false);

  for (const turn of topic.turns) {
    const { el, cards } = createTurnElement(turn, topic.id);
    if (cards?.main) {
      state.chat.turnUiById.set(turn.id, cards.main);
    }
    elements.chatMessages.appendChild(el);
  }
  syncTopicActionButtons(topic.id);
  updateScrollToBottomButton();
  reconcileHtmlPreviewWithTopic(topic);
}

export function createTurnElement(turn, topicId = state.chat.activeTopicId) {
  const turnEl = document.createElement("div");
  turnEl.className = "turn";
  turnEl.dataset.turnId = turn.id;
  if (topicId) {
    turnEl.dataset.topicId = topicId;
  }

  const hasUserImages = Array.isArray(turn.images) && turn.images.length > 0;
  const hasUserText =
    typeof turn.prompt === "string" && turn.prompt.trim().length > 0;
  const hasUserContent = hasUserImages || hasUserText;
  const isEditing = state.chat.editingTurnId === turn.id;
  const disableTurnAnimation = state.chat.turnIdsWithoutAnimation.has(turn.id);
  let userWrap = null;

  if (hasUserContent) {
    userWrap = document.createElement("div");
    userWrap.className = `user-bubble-wrap${isEditing ? " is-editing" : ""}${
      disableTurnAnimation ? " no-animate" : ""
    }`;
    if (topicId) {
      userWrap.dataset.topicId = topicId;
    }

    const userActions = document.createElement("div");
    userActions.className = "user-message-actions";

    const userEditBtn = createIconActionButton({
      className: "message-copy-btn copy-icon-btn user-edit-trigger",
      title: "编辑并重新发送",
      ariaLabel: "编辑并重新发送",
      path: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>',
    });
    userEditBtn.dataset.topicId = topicId || "";
    userEditBtn.disabled = isTopicRunning(topicId);
    userEditBtn.addEventListener("click", () => {
      if (userEditBtn.disabled) return;
      startEditingTurn(turn);
    });
    userActions.appendChild(userEditBtn);

    const userRegenerateBtn = createIconActionButton({
      className: "message-copy-btn copy-icon-btn regenerate-btn user-regenerate-btn",
      title: "重新生成",
      ariaLabel: "重新生成",
      path: '<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="m3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>',
    });
    userRegenerateBtn.dataset.topicId = topicId || "";
    userRegenerateBtn.disabled = isTopicRunning(topicId);
    userRegenerateBtn.addEventListener("click", async () => {
      if (userRegenerateBtn.disabled) return;
      await _regenerateTurn(turn);
    });
    userActions.appendChild(userRegenerateBtn);

    const userDeleteBtn = createIconActionButton({
      className: "message-copy-btn copy-icon-btn delete-btn user-delete-btn",
      title: "删除消息",
      ariaLabel: "删除消息",
      path: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path>',
    });
    userDeleteBtn.dataset.topicId = topicId || "";
    userDeleteBtn.addEventListener("click", async () => {
      await requestDeleteTurn(turn, topicId);
    });
    userActions.appendChild(userDeleteBtn);

    if (hasUserText) {
      const userCopyBtn = createCopyButton(() => turn.prompt || "", {
        label: "复制",
        icon: true,
      });
      userCopyBtn.classList.add("user-copy-btn");
      userActions.appendChild(userCopyBtn);
    }

    if (isEditing) {
      const editPanel = document.createElement("div");
      editPanel.className = "user-edit-panel";

      if (hasUserImages) {
        const editImages = createUserImagesContainer(turn.images, {
          containerClass: "user-edit-images",
          itemClass: "user-edit-image-item",
          imageClass: "user-edit-image",
        });
        if (editImages) {
          editPanel.appendChild(editImages);
        }
      }

      const editTextarea = document.createElement("textarea");
      editTextarea.className = "user-edit-input";
      editTextarea.dataset.turnId = turn.id;
      editTextarea.rows = 1;
      editTextarea.placeholder = "在这里修改这条消息";
      editTextarea.value = getTurnEditDraft(turn);
      editTextarea.addEventListener("input", () => {
        state.chat.editDraftByTurnId.set(turn.id, editTextarea.value);
        resizeTurnEditor(editTextarea);
        submitBtn.disabled =
          isTopicRunning(topicId) ||
          (!String(editTextarea.value || "").trim() && !hasUserImages);
      });
      editTextarea.addEventListener("keydown", async (event) => {
        if (event.key !== "Enter" || event.shiftKey) return;
        event.preventDefault();
        if (submitBtn.disabled) return;
        await handleSubmitTurnEdit(turn);
      });
      editPanel.appendChild(editTextarea);

      const editFooter = document.createElement("div");
      editFooter.className = "user-edit-footer";

      const editActions = document.createElement("div");
      editActions.className = "user-edit-actions";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "user-edit-btn secondary user-edit-cancel";
      cancelBtn.textContent = "取消";
      cancelBtn.addEventListener("click", () => {
        cancelEditingTurn(turn.id);
      });

      const submitBtn = document.createElement("button");
      submitBtn.type = "button";
      submitBtn.className = "user-edit-btn primary user-edit-submit";
      submitBtn.textContent = "重新发送";
      submitBtn.dataset.topicId = topicId || "";
      submitBtn.dataset.hasImages = hasUserImages ? "1" : "0";
      submitBtn.disabled =
        isTopicRunning(topicId) ||
        (!String(editTextarea.value || "").trim() && !hasUserImages);
      submitBtn.addEventListener("click", async () => {
        if (submitBtn.disabled) return;
        await handleSubmitTurnEdit(turn);
      });

      editActions.appendChild(cancelBtn);
      editActions.appendChild(submitBtn);
      editFooter.appendChild(editActions);
      userWrap.appendChild(editPanel);
      userWrap.appendChild(editFooter);

      requestAnimationFrame(() => {
        resizeTurnEditor(editTextarea);
      });
    } else {
      const userBubble = document.createElement("div");
      userBubble.className = "user-bubble";

      // 如果有图片，先显示图片
      if (hasUserImages) {
        const imagesContainer = createUserImagesContainer(turn.images);
        if (imagesContainer) {
          userBubble.appendChild(imagesContainer);
        }
      }

      // 显示文本消息
      if (hasUserText) {
        const textContent = document.createElement("div");
        textContent.className = "user-text";
        textContent.textContent = turn.prompt;
        userBubble.appendChild(textContent);
      }

      userWrap.appendChild(userBubble);
      userWrap.appendChild(userActions);
    }
  }

  if (disableTurnAnimation) {
    state.chat.turnIdsWithoutAnimation.delete(turn.id);
  }

  let webSearchEl = null;
  if (turn.webSearch) {
    webSearchEl = document.createElement("div");
    webSearchEl.className = "web-search";
    renderWebSearchSection(webSearchEl, turn.webSearch);
  }

  const assistants = document.createElement("div");
  assistants.className = "turn-assistants single-model";

  // 只渲染 A 侧模型卡片（兼容旧数据）
  const cards = {};
  if (turn.models.main) {
    const aCard = createAssistantCard(turn, topicId, disableTurnAnimation);
    assistants.appendChild(aCard.el);
    cards.main = aCard;
  }

  if (userWrap) turnEl.appendChild(userWrap);
  if (webSearchEl) turnEl.appendChild(webSearchEl);
  turnEl.appendChild(assistants);

  return { el: turnEl, cards, webSearchEl };
}

export function createAssistantCard(
  turn,
  topicId = state.chat.activeTopicId,
  disableAnimation = false
) {
  const side = "main";
  const modelDisplaySnapshot = (turn?.models?.main?.displayName || "").trim();
  const modelSnapshot = turn?.models?.main?.model || "";
  const contentSnapshot = turn?.models?.main?.content || "";
  const imagesSnapshot = Array.isArray(turn?.models?.main?.images)
    ? turn.models.main.images
    : [];
  const thinkingSnapshot = normalizeThinkingText(turn?.models?.main?.thinking || "");
  const toolEventsSnapshot = Array.isArray(turn?.models?.main?.toolEvents)
    ? turn.models.main.toolEvents
    : [];
  const webSearchEventsSnapshot = Array.isArray(turn?.models?.main?.webSearchEvents)
    ? turn.models.main.webSearchEvents
    : [];
  const mergedToolEventsSnapshot = mergeToolEventsWithWebSearch(
    toolEventsSnapshot,
    webSearchEventsSnapshot
  );
  const tokenSnapshot = turn?.models?.main?.tokens;
  const timeSnapshot = turn?.models?.main?.timeCostSec;
  const statusSnapshot = turn?.models?.main?.status || "ready";

  const message = document.createElement("div");
  message.className = `assistant-message${disableAnimation ? " no-animate" : ""}`;
  if (topicId) {
    message.dataset.topicId = topicId;
  }

  // 头部：模型名称 + 状态
  const header = document.createElement("div");
  header.className = "assistant-message-header";

  const modelName = document.createElement("span");
  modelName.className = "assistant-model-name";
  const displayModel = modelDisplaySnapshot || modelSnapshot || elements.modelName.textContent || "未配置";
  const displayService = turn?.models?.main?.serviceName || "";
  
  if (displayService) {
    const sName = document.createElement("span");
    sName.className = "assistant-service-name";
    sName.textContent = displayService;
    
    const divider = document.createElement("span");
    divider.className = "assistant-model-divider";
    divider.textContent = " / ";
    
    const mName = document.createElement("span");
    mName.className = "assistant-model-id";
    mName.textContent = displayModel;
    
    modelName.appendChild(sName);
    modelName.appendChild(divider);
    modelName.appendChild(mName);
  } else {
    modelName.textContent = displayModel;
  }



  const statusEl = document.createElement("span");
  statusEl.className = "status";

  header.appendChild(modelName);
  header.appendChild(statusEl);

  // 内容区域
  const content = document.createElement("div");
  content.className = "assistant-message-content";

  const thinkingSection = document.createElement("div");
  thinkingSection.className = "thinking-section collapsed";
  thinkingSection.style.display = "none";

  const thinkingHeader = document.createElement("div");
  thinkingHeader.className = "thinking-header";
  const thinkingLabel = document.createElement("span");
  const storedThinkingLabel = turn?.models?.[side]?.thinkingLabel || "";
  const thinkingCompleteSnapshot = !!turn?.models?.[side]?.thinkingComplete;
  const thinkingSummary = buildThinkingLabel(
    thinkingSnapshot,
    statusSnapshot === "complete" || thinkingCompleteSnapshot,
    storedThinkingLabel,
    turn?.models?.[side]?.thinkingTime
  );
  thinkingLabel.className = "thinking-summary";
  if (thinkingCompleteSnapshot || statusSnapshot === "complete") {
    thinkingLabel.classList.add("is-complete");
  }
  thinkingLabel.textContent = thinkingSummary;
  thinkingLabel.title = thinkingSummary;
  thinkingHeader.appendChild(thinkingLabel);

  const thinkingArrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  thinkingArrow.setAttribute("class", "thinking-header-arrow");
  thinkingArrow.setAttribute("viewBox", "0 0 24 24");
  thinkingArrow.setAttribute("fill", "none");
  thinkingArrow.setAttribute("stroke", "currentColor");
  thinkingArrow.setAttribute("stroke-width", "2");
  thinkingArrow.setAttribute("stroke-linecap", "round");
  thinkingArrow.setAttribute("stroke-linejoin", "round");

  const thinkingArrowLine = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  thinkingArrowLine.setAttribute("points", "6 9 12 15 18 9");
  thinkingArrow.appendChild(thinkingArrowLine);
  thinkingHeader.appendChild(thinkingArrow);

  thinkingHeader.addEventListener("click", () => {
    thinkingSection.dataset.userToggled = "1";
    thinkingSection.classList.toggle("collapsed");
    // 保存折叠状态到数据中
    const collapsed = thinkingSection.classList.contains("collapsed");
    if (turn?.models?.[side]) {
      turn.models[side].thinkingCollapsed = collapsed;
      scheduleSaveChat();
    }
  });

  const thinkingContent = document.createElement("div");
  thinkingContent.className = "thinking-content";
  if (thinkingSnapshot) {
    renderMarkdownToElement(thinkingContent, thinkingSnapshot);
  }

  thinkingSection.appendChild(thinkingHeader);
  thinkingSection.appendChild(thinkingContent);

  if (thinkingSnapshot) {
    thinkingSection.style.display = "block";
    // 如果有保存的折叠状态，使用该状态；否则默认折叠
    const shouldCollapse = turn?.models?.[side]?.thinkingCollapsed !== false;
    if (shouldCollapse) {
      thinkingSection.classList.add("collapsed");
    } else {
      thinkingSection.classList.remove("collapsed");
    }
  }

  const responseSection = document.createElement("div");
  responseSection.className = "response-section";
  const responseImages = document.createElement("div");
  responseImages.className = "response-images";
  renderAssistantImages(responseImages, imagesSnapshot);
  const responseContent = document.createElement("div");
  responseContent.className = "response-content";
  responseContent.dataset.topicId = String(topicId || "");
  responseContent.dataset.turnId = String(turn?.id || "");
  responseContent.dataset.turnCreatedAt = String(turn?.createdAt || 0);
  renderMarkdownToElement(responseContent, contentSnapshot);
  responseSection.appendChild(responseImages);
  responseSection.appendChild(responseContent);

  const toolCallsSection = document.createElement("div");
  toolCallsSection.className = "tool-calls-section";
  toolCallsSection.style.display = "none";

  const toolCallsList = document.createElement("ul");
  toolCallsList.className = "tool-calls-list";

  toolCallsSection.appendChild(toolCallsList);
  renderToolEvents(toolCallsSection, toolCallsList, mergedToolEventsSnapshot);
  toolCallsSection.classList.toggle(
    "tc-expanded",
    turn?.models?.[side]?.toolCallsExpanded === true
  );
  toolCallsSection.addEventListener("toolcalls-toggle", (event) => {
    const expanded = event?.detail?.expanded === true;
    if (turn?.models?.[side]) {
      turn.models[side].toolCallsExpanded = expanded;
      scheduleSaveChat();
    }
  });

  // 来源状态条
  const sourcesSnapshot = Array.isArray(turn?.models?.main?.sources)
    ? turn.models.main.sources
    : [];
  const sourcesStatus = document.createElement("div");
  sourcesStatus.className = "sources-status";
  sourcesStatus.hidden = true;
  renderSourcesStatus(sourcesStatus, sourcesSnapshot);

  content.appendChild(thinkingSection);
  content.appendChild(toolCallsSection);
  content.appendChild(sourcesStatus);
  content.appendChild(responseSection);

  // 底部：元数据 + 操作按钮
  const footer = document.createElement("div");
  footer.className = "assistant-message-footer";

  const metaInfo = document.createElement("div");
  metaInfo.className = "message-meta";

  const tokenEl = document.createElement("span");
  tokenEl.className = "meta-item token-count";
  tokenEl.textContent = `${
    Number.isFinite(tokenSnapshot)
      ? tokenSnapshot
      : estimateTokensFromText(contentSnapshot)
  } tokens`;

  const timeEl = document.createElement("span");
  timeEl.className = "meta-item time-cost";
  timeEl.textContent = `${
    Number.isFinite(timeSnapshot) ? timeSnapshot.toFixed(1) : "0.0"
  }s`;

  const speedEl = document.createElement("span");
  speedEl.className = "meta-item token-speed";
  if (
    Number.isFinite(tokenSnapshot) &&
    Number.isFinite(timeSnapshot) &&
    timeSnapshot > 0
  ) {
    const speed = tokenSnapshot / timeSnapshot;
    speedEl.textContent = `${speed.toFixed(1)} t/s`;
  } else {
    speedEl.textContent = "";
    speedEl.style.display = "none";
  }

  metaInfo.appendChild(tokenEl);
  metaInfo.appendChild(timeEl);
  metaInfo.appendChild(speedEl);

  const sourcesToggleBtn = document.createElement("button");
  sourcesToggleBtn.type = "button";
  sourcesToggleBtn.className = "source-toggle-btn";
  sourcesToggleBtn.hidden = true;
  sourcesToggleBtn.setAttribute("aria-expanded", "false");
  renderSourcesToggle(sourcesToggleBtn, sourcesSnapshot);

  const actions = document.createElement("div");
  actions.className = "message-actions";

  // 复制按钮
  const copyBtn = createCopyButton(() => turn?.models?.[side]?.content || "", {
    label: "复制",
    icon: true,
    className: "action-btn copy-btn message-copy-btn",
  });

  const regenerateBtn = document.createElement("button");
  regenerateBtn.type = "button";
  regenerateBtn.className = "action-btn regenerate-btn";
  regenerateBtn.setAttribute("aria-label", "重新生成");
  regenerateBtn.dataset.topicId = topicId || "";
  regenerateBtn.dataset.status = statusSnapshot;
  regenerateBtn.innerHTML = `
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="23 4 23 10 17 10"></polyline>
      <polyline points="1 20 1 14 7 14"></polyline>
      <path d="m3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
    </svg>
  `;
  regenerateBtn.addEventListener("click", async () => {
    if (regenerateBtn.disabled) return;
    await _regenerateTurn(turn);
  });
  regenerateBtn.disabled = statusSnapshot === "loading" || isTopicRunning(topicId);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "action-btn delete-btn";
  deleteBtn.setAttribute("aria-label", "删除消息");
  deleteBtn.dataset.topicId = topicId || "";
  deleteBtn.innerHTML = `
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18"></path>
      <path d="M8 6V4h8v2"></path>
      <path d="M19 6l-1 14H6L5 6"></path>
      <path d="M10 11v6"></path>
      <path d="M14 11v6"></path>
    </svg>
  `;
  deleteBtn.addEventListener("click", async () => {
    await requestDeleteTurn(turn, topicId);
  });

  actions.appendChild(copyBtn);
  actions.appendChild(regenerateBtn);
  actions.appendChild(deleteBtn);

  footer.appendChild(metaInfo);
  footer.appendChild(sourcesToggleBtn);
  footer.appendChild(actions);

  const sourcesPanel = document.createElement("div");
  sourcesPanel.className = "sources-section sources-panel";
  sourcesPanel.hidden = true;
  sourcesPanel.dataset.expanded = "0";
  renderSources(sourcesPanel, sourcesSnapshot);

  sourcesToggleBtn.addEventListener("click", () => {
    if (sourcesToggleBtn.hidden || sourcesToggleBtn.disabled) return;
    const expanded = sourcesPanel.dataset.expanded === "1";
    setSourcesPanelExpanded(sourcesPanel, sourcesToggleBtn, !expanded);
  });

  message.appendChild(header);
  message.appendChild(content);
  message.appendChild(footer);
  message.appendChild(sourcesPanel);
  applyStatus(statusEl, statusSnapshot);

  if (
    statusSnapshot === "loading" &&
    (
      thinkingSnapshot ||
      contentSnapshot ||
      mergedToolEventsSnapshot.length > 0
    )
  ) {
    message.classList.remove("loading");
    message.classList.add("streaming");
  }

  return {
    el: message,
    statusEl,
    modelNameEl: modelName,
    responseEl: responseContent,
    responseImagesEl: responseImages,
    toolCallsSectionEl: toolCallsSection,
    toolCallsListEl: toolCallsList,
    thinkingSectionEl: thinkingSection,
    thinkingContentEl: thinkingContent,
    thinkingLabelEl: thinkingLabel,
    tokenEl,
    timeEl,
    speedEl,
    copyBtn,
    regenerateBtn,
    deleteBtn,
    sourcesStatusEl: sourcesStatus,
    sourcesToggleBtnEl: sourcesToggleBtn,
    sourcesSectionEl: sourcesPanel,
    turn: turn,
    side: side,
  };
}

export function triggerCreateTopic() {
  if (state.chat.isCreatingTopic) return; // 防止重复创建

  // 检查当前话题是否为空（无消息）
  const currentTopic = getActiveTopic();
  if (currentTopic) {
    const hasRealContent = currentTopic.turns.some(
      (turn) => turn.prompt?.trim()
    );

    if (!hasRealContent && currentTopic.turns.length <= 1) {
      // 当前话题为空，无需创建新话题
      elements.promptInput?.focus();
      return;
    }
  }

  state.chat.isCreatingTopic = true;
  try {
    const topic = createTopic();
    setActiveTopic(topic.id);
    collapseSidebarForMobile();
    renderAll();
    elements.promptInput?.focus();
  } finally {
    state.chat.isCreatingTopic = false;
  }
}

export async function clearActiveTopicMessages() {
  const topic = getActiveTopic();
  if (!topic) return;
  if (isTopicRunning(topic.id)) {
    const stopThenClear = await showConfirm(
      "当前话题正在生成中，仍要清空并停止生成吗？",
      {
        title: "清空会话",
        okText: "继续",
      }
    );
    if (!stopThenClear) return;
  }
  const confirmed = await showConfirm("确定要清空当前话题的所有消息吗？", {
    title: "清空会话",
    okText: "清空",
    danger: true,
    hint: "",
  });
  if (!confirmed) return;
  if (isTopicRunning(topic.id)) _stopGeneration(topic.id);

  for (const turn of topic.turns) {
    clearTurnEditState(turn?.id);
  }
  topic.turns = [];
  topic.updatedAt = Date.now();
  scheduleSaveChat();
  renderAll();
}
