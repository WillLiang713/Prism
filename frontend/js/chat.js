import { state, elements, STORAGE_KEYS, createId, formatTime } from './state.js';
import { renderMarkdownToElement, createCopyButton } from './markdown.js';
import { renderWebSearchSection, renderToolEvents, mergeToolEventsWithWebSearch, renderSources, renderSourcesStatus, renderSourcesToggle } from './web-search.js';
import { setSendButtonMode, applyStatus, scrollToBottom, updateScrollToBottomButton, updateHeaderMeta } from './ui.js';
import { showConfirm } from './dialog.js';
import { collapseSidebarForMobile } from './layout.js';
import { syncDesktopBackendUi } from './desktop.js';
import { resolveModelDisplayName } from './config.js';
import { estimateTokensFromText } from './state.js';

let _stopGeneration = () => {};
export function setStopGeneration(fn) { _stopGeneration = fn; }

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

function extractThinkingSummary(thinkingText) {
  const raw = String(thinkingText || "").replace(/\r/g, "").trim();
  if (!raw) return "";
  const hasTrailingNewline = /\n\s*$/.test(String(thinkingText || "").replace(/\r/g, ""));

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

function buildThinkingLabel(thinkingText, isComplete = false, previousLabel = "") {
  if (isComplete && String(thinkingText || "").trim()) return "思考完成";
  const summary = extractThinkingSummary(thinkingText);
  if (summary) return summary;
  return previousLabel || "思考中";
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

export function renderTopicList() {
  if (!elements.topicList) return;

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
    item.className = `topic-item${
      topic.id === state.chat.activeTopicId ? " active" : ""
    }${isGeneratingTitle ? " generating-title" : ""}${
      isGenerating ? " running" : ""
    }`;
    item.dataset.topicId = topic.id;

    const title = document.createElement("div");
    title.className = "topic-title";
    title.textContent = topic.title || "未命名话题";

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

    if (!hideDeleteForOnlyNewTopic) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "topic-delete-btn";
      deleteBtn.textContent = "删除";
      deleteBtn.title = "删除该话题";
      deleteBtn.setAttribute(
        "aria-label",
        `删除话题：${topic.title || "未命名话题"}`
      );
      deleteBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await requestDeleteTopic(topic.id);
      });
      footer.appendChild(deleteBtn);
    }

    item.appendChild(title);
    item.appendChild(footer);

    item.addEventListener("click", () => {
      const isAlreadyActive = topic.id === state.chat.activeTopicId;
      collapseSidebarForMobile();
      if (isAlreadyActive) return;

      setActiveTopic(topic.id);
      renderAll();
    });

    elements.topicList.appendChild(item);
  }

  updateHeaderMeta();
}

export function renderChatMessages() {
  if (!elements.chatMessages) return;
  elements.chatMessages.innerHTML = "";
  state.chat.turnUiById.clear();

  const topic = getActiveTopic();
  if (!topic || !Array.isArray(topic.turns) || !topic.turns.length) {
    if (elements.scrollToBottomBtn) {
      elements.scrollToBottomBtn.style.display = "none";
    }
    return;
  }

  for (const turn of topic.turns) {
    const { el, cards } = createTurnElement(turn);
    if (cards?.main) {
      state.chat.turnUiById.set(turn.id, cards.main);
    }
    elements.chatMessages.appendChild(el);
  }
  updateScrollToBottomButton();
}

export function createTurnElement(turn) {
  const turnEl = document.createElement("div");
  turnEl.className = "turn";
  turnEl.dataset.turnId = turn.id;

  const hasUserImages = Array.isArray(turn.images) && turn.images.length > 0;
  const hasUserText =
    typeof turn.prompt === "string" && turn.prompt.trim().length > 0;
  const hasUserContent = hasUserImages || hasUserText;
  let userWrap = null;

  if (hasUserContent) {
    userWrap = document.createElement("div");
    userWrap.className = "user-bubble-wrap";

    const userBubble = document.createElement("div");
    userBubble.className = "user-bubble";

    // 如果有图片，先显示图片
    if (hasUserImages) {
      const imagesContainer = document.createElement("div");
      imagesContainer.className = "user-images";

      for (const image of turn.images) {
        const imgWrapper = document.createElement("div");
        imgWrapper.className = "user-image-item";

        const img = document.createElement("img");
        img.src = image.dataUrl;
        img.alt = image.name || "用户上传的图片";
        img.loading = "lazy";

        imgWrapper.appendChild(img);
        imagesContainer.appendChild(imgWrapper);
      }

      userBubble.appendChild(imagesContainer);
    }

    // 显示文本消息
    if (hasUserText) {
      const textContent = document.createElement("div");
      textContent.className = "user-text";
      textContent.textContent = turn.prompt;
      userBubble.appendChild(textContent);
    }

    if (hasUserText) {
      const userCopyBtn = createCopyButton(() => turn.prompt || "", {
        label: "复制",
        icon: true,
      });
      userCopyBtn.classList.add("user-copy-btn");
      userWrap.appendChild(userCopyBtn);
    }

    userWrap.appendChild(userBubble);
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
    const aCard = createAssistantCard(turn);
    assistants.appendChild(aCard.el);
    cards.main = aCard;
  }

  if (userWrap) turnEl.appendChild(userWrap);
  if (webSearchEl) turnEl.appendChild(webSearchEl);
  turnEl.appendChild(assistants);

  return { el: turnEl, cards, webSearchEl };
}

export function createAssistantCard(turn) {
  const side = "main";
  const modelDisplaySnapshot = (turn?.models?.main?.displayName || "").trim();
  const modelSnapshot = turn?.models?.main?.model || "";
  const contentSnapshot = turn?.models?.main?.content || "";
  const thinkingSnapshot = turn?.models?.main?.thinking || "";
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
  message.className = "assistant-message";

  // 头部：模型名称 + 状态
  const header = document.createElement("div");
  header.className = "assistant-message-header";

  const modelName = document.createElement("span");
  modelName.className = "assistant-model-name";
  modelName.textContent =
    modelDisplaySnapshot || modelSnapshot || elements.modelName.textContent || "未配置";

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
    storedThinkingLabel
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
  const responseContent = document.createElement("div");
  responseContent.className = "response-content";
  renderMarkdownToElement(responseContent, contentSnapshot);
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

  actions.appendChild(copyBtn);

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
    toolCallsSectionEl: toolCallsSection,
    toolCallsListEl: toolCallsList,
    thinkingSectionEl: thinkingSection,
    thinkingContentEl: thinkingContent,
    thinkingLabelEl: thinkingLabel,
    tokenEl,
    timeEl,
    speedEl,
    copyBtn,
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

  topic.turns = [];
  topic.updatedAt = Date.now();
  scheduleSaveChat();
  renderAll();
}
