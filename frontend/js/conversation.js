import { state, elements, createId, isDesktopBackendAvailable, buildApiUrl, estimateTokensFromText } from './state.js';
import { t } from './i18n.js';
import { showAlert } from './dialog.js';
import { getConfig, getWebSearchConfig, resolveModelDisplayName } from './config.js';
import {
  renderMarkdownToElement,
  splitStreamingMarkdown,
  tryAppendPlainTextDelta,
} from './markdown.js';
import { attachWebSearchToToolEvents, normalizeWebSearchProvider, renderToolEvents, renderSourcesStatus } from './web-search.js';
import { autoGrowPromptInput, scrollToBottom, updateScrollToBottomButton, applyStatus, setSendButtonMode } from './ui.js';
import { getActiveTopic, createTopic, setActiveTopic, isTopicRunning, isDefaultTopicTitle, markTopicRunning, unmarkTopicRunning, getLiveTurnUi, scheduleSaveChat, renderTopicList, renderChatMessages, createTurnElement, syncSendButtonModeByActiveTopic, setEmptyThreadState, renderAssistantImages } from './chat.js';
import { clearImages } from './images.js';
import { syncHtmlPreviewForTurn } from './html-preview.js';
import { streamJsonSse } from './stream-client.js';
import {
  appendThinkingChunk,
  buildThinkingLabel,
  formatThinkingCompleteLabel,
  normalizeThinkingText,
} from './thinking.js';

function appendAssistantImages(existingImages, nextImages) {
  const target = Array.isArray(existingImages) ? existingImages : [];
  const incoming = Array.isArray(nextImages) ? nextImages : [];
  const seen = new Set(
    target
      .map((item) => String(item?.url || item?.dataUrl || "").trim())
      .filter(Boolean)
  );
  let appended = false;

  for (const item of incoming) {
    const imageUrl = String(item?.url || item?.dataUrl || "").trim();
    if (!imageUrl || seen.has(imageUrl)) continue;
    seen.add(imageUrl);
    target.push({ url: imageUrl });
    appended = true;
  }

  return appended;
}

function createMainModelState(config) {
  return {
    provider: config.provider,
    model: config.model,
    serviceName: config.serviceName || "",
    displayName: resolveModelDisplayName(config.model, config.customModelName),
    thinking: "",
    thinkingLabel: t("思考中"),
    thinkingComplete: false,
    toolEvents: [],
    webSearchEvents: [],
    sources: [],
    content: "",
    images: [],
    tokens: null,
    timeCostSec: null,
    status: "loading",
    previewAutoOpened: false,
    thinkingCollapsed: true,
    toolCallsExpanded: false,
  };
}

const STREAM_THINKING_RENDER_INTERVAL_MS = 24;
const STREAM_PREVIEW_INTERVAL_MS = 250;
const STREAM_THINKING_BASE_REVEAL_CPS = 58;
const STREAM_THINKING_BACKLOG_REVEAL_CPS = 0.22;
const STREAM_THINKING_MAX_REVEAL_CHARS = 10;
const STREAM_CONTENT_BASE_REVEAL_CPS = 48;
const STREAM_CONTENT_BACKLOG_REVEAL_CPS = 2;

function clearMarkdownElement(element) {
  if (!(element instanceof HTMLElement)) return;
  element.innerHTML = "";
  element.hidden = true;
}

function syncResponseRenderMeta(responseEl, topicId, turn) {
  if (!(responseEl instanceof HTMLElement)) return;
  responseEl.dataset.topicId = String(topicId || "");
  responseEl.dataset.turnId = String(turn?.id || "");
  responseEl.dataset.turnCreatedAt = String(turn?.createdAt || 0);
}

function renderResponseMarkdown(uiRef, topicId, turn, content, options = {}) {
  const responseEl = uiRef?.responseEl;
  if (!(responseEl instanceof HTMLElement)) {
    return {
      stableText: "",
      liveText: "",
    };
  }

  syncResponseRenderMeta(responseEl, topicId, turn);

  const stableEl = uiRef?.responseStableEl;
  const liveEl = uiRef?.responseLiveEl;
  const skipCodeHighlight = options?.skipCodeHighlight === true;
  const forceFull = options?.forceFull === true;
  const previousStableText = String(options?.previousStableText || "");
  const previousLiveText = String(options?.previousLiveText || "");
  const splitResult = forceFull
    ? {
        stableText: String(content || ""),
        liveText: "",
      }
    : splitStreamingMarkdown(content);
  const stableText = splitResult.stableText;
  const liveText = splitResult.liveText;

  if (!(stableEl instanceof HTMLElement) || !(liveEl instanceof HTMLElement)) {
    renderMarkdownToElement(responseEl, content, { skipCodeHighlight });
    return {
      stableText,
      liveText,
    };
  }

  if (stableText) {
    stableEl.hidden = false;
    if (forceFull || stableText !== previousStableText) {
      renderMarkdownToElement(stableEl, stableText, { skipCodeHighlight });
    }
  } else {
    clearMarkdownElement(stableEl);
  }

  if (liveText) {
    liveEl.hidden = false;
    if (forceFull || liveText !== previousLiveText) {
      const appended =
        !forceFull &&
        stableText === previousStableText &&
        tryAppendPlainTextDelta(liveEl, previousLiveText, liveText);
      if (!appended) {
        renderMarkdownToElement(liveEl, liveText, { skipCodeHighlight });
      }
    }
  } else {
    clearMarkdownElement(liveEl);
  }

  return {
    stableText,
    liveText,
  };
}

function hasEffectiveApiKey(config) {
  return !!String(config?.apiKey || "").trim();
}

function hasEffectiveModel(config) {
  return !!String(config?.model || "").trim();
}

export async function sendPrompt() {
  if (!isDesktopBackendAvailable()) {
    return;
  }

  const prompt = (elements.promptInput.value || "").trim();
  const hasImages =
    state.images.selectedImages && state.images.selectedImages.length > 0;

  if (!prompt && !hasImages) {
    await showAlert(t("请输入内容或上传图片"), {
      title: t("无法发送"),
    });
    return;
  }

  const config = getConfig();
  const webSearchConfig = getWebSearchConfig();

  if (!hasEffectiveApiKey(config) || !hasEffectiveModel(config)) {
    await showAlert(t("请先配置模型"), {
      title: t("缺少配置"),
    });
    return;
  }

  const now = Date.now();
  let topic = getActiveTopic();
  if (!topic) {
    // 检查是否有空话题可以复用
    const emptyTopic = state.chat.topics.find(
      (t) =>
        t.turns.length === 0
    );

    if (emptyTopic) {
      topic = emptyTopic;
      setActiveTopic(topic.id);
    } else {
      topic = createTopic();
      setActiveTopic(topic.id);
    }
  }

  if (isTopicRunning(topic.id)) return;

  const turn = {
    id: createId(),
    createdAt: now,
    prompt,
    images: [...state.images.selectedImages], // 保存当前选择的图片
    webSearch: null,
    models: {},
  };

  turn.models.main = createMainModelState(config);

  topic.turns = Array.isArray(topic.turns) ? topic.turns : [];
  topic.turns.push(turn);
  topic.updatedAt = now;

  scheduleSaveChat();

  // 如果是该话题的第一条消息，移除空状态提示
  if (topic.turns.length === 1) {
    const emptyState = elements.chatMessages.querySelector(".empty-chat-state");
    if (emptyState) emptyState.remove();
    setEmptyThreadState(false);
  }

  const createdEls = createTurnElement(turn, topic.id);
  elements.chatMessages.appendChild(createdEls.el);
  if (createdEls.cards?.main) {
    state.chat.turnUiById.set(turn.id, createdEls.cards.main);
  }
  renderTopicList();

  // 发送后立即滚动到底部，并启用自动滚动
  state.autoScroll = true;
  scrollToBottom(elements.chatMessages, false);

  elements.promptInput.value = "";
  autoGrowPromptInput();
  clearImages(); // 清空已选择的图片
  elements.promptInput.focus();

  await callModel(
    prompt,
    config,
    topic.id,
    turn,
    createdEls.cards.main,
    Date.now(),
    webSearchConfig
  );

  scheduleSaveChat();

  // 自动生成标题
  autoGenerateTitle(topic.id);
}

export function stopGeneration(topicId = state.chat.activeTopicId) {
  if (!topicId) return false;
  const ctrl = state.chat.runningControllers.get(topicId);
  if (!ctrl) return false;
  ctrl.abort();
  state.chat.runningControllers.delete(topicId);
  if (topicId === state.chat.activeTopicId) {
    syncSendButtonModeByActiveTopic();
  }
  renderTopicList();
  return true;
}

export async function regenerateTurn(turn, options = {}) {
  if (!isDesktopBackendAvailable() || !turn?.id) {
    return false;
  }

  const topic = state.chat.topics.find((item) =>
    Array.isArray(item?.turns) && item.turns.some((entry) => entry.id === turn.id)
  );
  if (!topic || isTopicRunning(topic.id)) {
    return false;
  }
  const turnIndex = topic.turns.findIndex((entry) => entry.id === turn.id);
  const shouldScrollToBottom =
    options?.scrollToBottom === true ||
    (options?.scrollToBottom !== false && turnIndex === topic.turns.length - 1);

  const config = getConfig();
  const webSearchConfig = getWebSearchConfig();

  if (!hasEffectiveApiKey(config) || !hasEffectiveModel(config)) {
    await showAlert(t("请先配置模型"), {
      title: t("缺少配置"),
    });
    return false;
  }

  turn.models.main = createMainModelState(config);
  turn.webSearch = null;
  topic.updatedAt = Date.now();
  scheduleSaveChat();
  renderTopicList();

  const turnEl = elements.chatMessages?.querySelector(
    `.turn[data-turn-id="${turn.id}"]`
  );
  let ui = null;
  if (turnEl) {
    const createdEls = createTurnElement(turn, topic.id);
    turnEl.replaceWith(createdEls.el);
    if (createdEls.cards?.main) {
      state.chat.turnUiById.set(turn.id, createdEls.cards.main);
      ui = createdEls.cards.main;
    }
  } else if (topic.id === state.chat.activeTopicId) {
    renderChatMessages();
    ui = state.chat.turnUiById.get(turn.id) || null;
  }

  const activeTurnEl = elements.chatMessages?.querySelector(
    `.turn[data-turn-id="${turn.id}"]`
  );

  if (shouldScrollToBottom) {
    state.autoScroll = true;
    state.chat.suppressScrollToBottomButton = false;
    scrollToBottom(elements.chatMessages, false);
    updateScrollToBottomButton();
  } else {
    state.autoScroll = false;
    state.chat.autoScrollLockUntil = 0;
    state.chat.suppressScrollToBottomButton = true;
    updateScrollToBottomButton();
    activeTurnEl?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }

  await callModel(
    turn.prompt,
    config,
    topic.id,
    turn,
    ui,
    Date.now(),
    webSearchConfig
  );

  scheduleSaveChat();
  state.chat.suppressScrollToBottomButton = false;
  updateScrollToBottomButton();
  return true;
}

export async function submitTurnEdit(turn, nextPrompt) {
  if (!turn?.id) return false;

  const normalizedPrompt = String(nextPrompt || "").trim();
  const hasImages = Array.isArray(turn.images) && turn.images.length > 0;
  if (!normalizedPrompt && !hasImages) {
    await showAlert(t("请输入内容或保留图片后再重新发送"), {
      title: t("无法重新发送"),
    });
    return false;
  }

  turn.prompt = normalizedPrompt;
  return regenerateTurn(turn, { scrollToBottom: false });
}

export async function callModel(
  prompt,
  config,
  topicId,
  turn,
  ui,
  startTime,
  webSearchConfig
) {
  const resolveUi = () => {
    const nextUi = getLiveTurnUi(topicId, turn.id, ui);
    if (nextUi) ui = nextUi;
    return ui;
  };

  const initUi = resolveUi();
  if (initUi) {
    applyStatus(initUi.statusEl, "loading");
    const mIdSpan = initUi.modelNameEl.querySelector(".assistant-model-id");
    if (mIdSpan) {
      mIdSpan.textContent = resolveModelDisplayName(config.model) || t("未配置");
    } else {
      initUi.modelNameEl.textContent = resolveModelDisplayName(config.model) || t("未配置");
    }


  }

  const abortController = new AbortController();
  markTopicRunning(topicId, abortController);

  let thinkingStartTime = null;
  let thinkingEndTime = null;
  let contentRenderFrame = 0;
  let thinkingRenderTimer = null;
  let thinkingFinalRenderPending = false;
  let contentFinalRenderPending = false;
  let thinkingContentGateStartedAt = 0;
  let resumeAutoScrollAfterThinkingGate = false;
  let previewSyncTimer = null;
  let previewSyncBlockedAutoOpen = false;
  let autoScrollFrame = 0;
  let autoScrollFollowUpFrame = 0;
  let lastThinkingRenderAt = 0;
  let lastPreviewSyncAt = 0;
  let visibleThinking = "";
  let lastThinkingRevealAt = 0;
  let thinkingRevealBudget = 0;
  let visibleContent = "";
  let lastContentRevealAt = 0;
  let contentRevealBudget = 0;
  let lastRenderedContent = "";
  let lastRenderedStableContent = "";
  let lastRenderedLiveContent = "";
  let lastRenderedThinking = "";
  let lastThinkingContentEl = null;
  let streamRenderSkipCodeHighlight = true;
  let lastThinkingRenderSkipCodeHighlight = true;
  let lastContentRenderSkipCodeHighlight = true;

  const lockStreamingAutoScroll = () => {
    if (!state.autoScroll) return;
    state.chat.autoScrollLockUntil = Date.now() + 350;
  };

  const performAutoScroll = (smooth = false) => {
    if (!state.autoScroll || topicId !== state.chat.activeTopicId) return;
    lockStreamingAutoScroll();
    scrollToBottom(elements.chatMessages, smooth);
    const uiRef = resolveUi();
    const thinkingDetail = uiRef?.thinkingContentEl?.closest?.(".thinking-detail");
    if (
      thinkingDetail instanceof HTMLElement &&
      !uiRef?.thinkingSectionEl?.classList.contains("collapsed")
    ) {
      thinkingDetail.scrollTop = thinkingDetail.scrollHeight;
    }
  };

  // 流式渲染会先收到 chunk，再在下一帧真正写入 DOM。
  // 这里做两次跟随滚动，避免只滚到正文底部，漏掉底部状态行。
  const scheduleAutoScroll = ({ smooth = false, followUp = true } = {}) => {
    if (!state.autoScroll || topicId !== state.chat.activeTopicId) return;
    if (!elements.chatMessages) return;
    lockStreamingAutoScroll();
    if (autoScrollFrame) return;
    autoScrollFrame = requestAnimationFrame(() => {
      autoScrollFrame = 0;
      performAutoScroll(smooth);
      if (!followUp) return;
      if (autoScrollFollowUpFrame) {
        cancelAnimationFrame(autoScrollFollowUpFrame);
      }
      autoScrollFollowUpFrame = requestAnimationFrame(() => {
        autoScrollFollowUpFrame = 0;
        performAutoScroll(false);
      });
    });
  };

  const isThinkingRevealBlockingContent = () => {
    if (turn.models.main.thinkingComplete !== true) return false;
    const normalizedThinking = normalizeThinkingText(turn.models.main.thinking);
    return (
      !!normalizedThinking.trim() &&
      visibleThinking.length < normalizedThinking.length
    );
  };

  const hasPendingContentRender = () =>
    contentFinalRenderPending ||
    visibleContent.length < String(turn.models.main.content || "").length;

  const releaseContentRenderIfReady = () => {
    if (isThinkingRevealBlockingContent() || !hasPendingContentRender()) return;
    if (resumeAutoScrollAfterThinkingGate) {
      const userScrollIntentAt = Number(state.chat.userScrollIntentAt || 0);
      if (!userScrollIntentAt || userScrollIntentAt <= thinkingContentGateStartedAt) {
        state.autoScroll = true;
      }
    }
    thinkingContentGateStartedAt = 0;
    resumeAutoScrollAfterThinkingGate = false;
    scheduleContentRender();
  };

  const requestPreviewSync = (autoOpen = true) => {
    if (isThinkingRevealBlockingContent()) {
      previewSyncBlockedAutoOpen = previewSyncBlockedAutoOpen || autoOpen === true;
      return;
    }
    schedulePreviewSync(autoOpen);
  };

  const flushThinkingRender = ({ force = false } = {}) => {
    if (thinkingRenderTimer) {
      clearTimeout(thinkingRenderTimer);
      thinkingRenderTimer = null;
    }
    lockStreamingAutoScroll();
    const uiRef = resolveUi();
    if (!uiRef?.thinkingSectionEl || !uiRef?.thinkingContentEl) return;
    if (uiRef.thinkingContentEl !== lastThinkingContentEl) {
      lastThinkingContentEl = uiRef.thinkingContentEl;
      visibleThinking = "";
      thinkingRevealBudget = 0;
      lastRenderedThinking = "";
      lastThinkingRenderSkipCodeHighlight = streamRenderSkipCodeHighlight;
      resetThinkingRevealClock();
    }
    const normalizedThinking = normalizeThinkingText(turn.models.main.thinking);
    if (!normalizedThinking.trim()) {
      uiRef.thinkingSectionEl.style.display = "none";
      uiRef.thinkingContentEl.textContent = "";
      visibleThinking = "";
      thinkingRevealBudget = 0;
      thinkingFinalRenderPending = false;
      lastRenderedThinking = "";
      lastThinkingRenderSkipCodeHighlight = streamRenderSkipCodeHighlight;
      lastThinkingRenderAt = Date.now();
      return;
    }

    advanceVisibleThinking(normalizedThinking, { force });
    const nextThinking = force ? normalizedThinking : visibleThinking;
    const hasHiddenThinkingBacklog =
      !force && visibleThinking.length < normalizedThinking.length;
    const skipThinkingCodeHighlight =
      streamRenderSkipCodeHighlight ||
      (thinkingFinalRenderPending && hasHiddenThinkingBacklog);
    if (
      !force &&
      nextThinking === lastRenderedThinking &&
      skipThinkingCodeHighlight === lastThinkingRenderSkipCodeHighlight
    ) {
      if (hasHiddenThinkingBacklog) {
        scheduleThinkingRender();
      } else {
        thinkingFinalRenderPending = false;
        releaseContentRenderIfReady();
      }
      return;
    }
    uiRef.thinkingSectionEl.style.display = "block";
    renderMarkdownToElement(uiRef.thinkingContentEl, nextThinking, {
      skipCodeHighlight: skipThinkingCodeHighlight,
    });
    lastRenderedThinking = nextThinking;
    lastThinkingRenderSkipCodeHighlight = skipThinkingCodeHighlight;
    lastThinkingRenderAt = Date.now();
    scheduleAutoScroll({ followUp: false });

    if (hasHiddenThinkingBacklog) {
      scheduleThinkingRender();
    } else {
      thinkingFinalRenderPending = false;
      releaseContentRenderIfReady();
    }
  };

  const scheduleThinkingRender = () => {
    const elapsed = Date.now() - lastThinkingRenderAt;
    if (elapsed >= STREAM_THINKING_RENDER_INTERVAL_MS) {
      flushThinkingRender();
      return;
    }
    if (thinkingRenderTimer) return;
    thinkingRenderTimer = setTimeout(
      flushThinkingRender,
      STREAM_THINKING_RENDER_INTERVAL_MS - elapsed
    );
  };

  const resetThinkingRevealClock = () => {
    lastThinkingRevealAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();
  };

  const advanceVisibleThinking = (targetThinking, { force = false } = {}) => {
    const target = String(targetThinking || "");
    if (force) {
      const changed = visibleThinking !== target;
      visibleThinking = target;
      thinkingRevealBudget = 0;
      resetThinkingRevealClock();
      return changed;
    }

    if (!target.startsWith(visibleThinking)) {
      let commonLength = 0;
      const maxCommonLength = Math.min(visibleThinking.length, target.length);
      while (
        commonLength < maxCommonLength &&
        visibleThinking[commonLength] === target[commonLength]
      ) {
        commonLength += 1;
      }
      visibleThinking = target.slice(0, commonLength);
      thinkingRevealBudget = 0;
      resetThinkingRevealClock();
    }

    const backlog = target.length - visibleThinking.length;
    if (backlog <= 0) return false;

    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const deltaMs = lastThinkingRevealAt
      ? Math.min(34, Math.max(8, now - lastThinkingRevealAt))
      : 16;
    lastThinkingRevealAt = now;

    const revealRatePerSec =
      STREAM_THINKING_BASE_REVEAL_CPS +
      backlog * STREAM_THINKING_BACKLOG_REVEAL_CPS;
    thinkingRevealBudget += (revealRatePerSec * deltaMs) / 1000;
    const nextCharCount = Math.min(
      backlog,
      STREAM_THINKING_MAX_REVEAL_CHARS,
      Math.floor(thinkingRevealBudget)
    );

    if (nextCharCount <= 0) return false;

    thinkingRevealBudget -= nextCharCount;
    visibleThinking = target.slice(0, visibleThinking.length + nextCharCount);
    return true;
  };

  const advanceVisibleContent = ({ force = false } = {}) => {
    const targetContent = String(turn.models.main.content || "");
    if (force || visibleContent.length > targetContent.length) {
      const changed = visibleContent !== targetContent;
      visibleContent = targetContent;
      contentRevealBudget = 0;
      lastContentRevealAt =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      return changed;
    }

    const backlog = targetContent.length - visibleContent.length;
    if (backlog <= 0) return false;

    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const deltaMs = lastContentRevealAt
      ? Math.min(34, Math.max(8, now - lastContentRevealAt))
      : 16;
    lastContentRevealAt = now;

    const revealRatePerSec =
      STREAM_CONTENT_BASE_REVEAL_CPS +
      backlog * STREAM_CONTENT_BACKLOG_REVEAL_CPS;
    contentRevealBudget += (revealRatePerSec * deltaMs) / 1000;
    const nextCharCount = Math.min(
      backlog,
      Math.floor(contentRevealBudget)
    );

    if (nextCharCount <= 0) return false;

    contentRevealBudget -= nextCharCount;

    visibleContent = targetContent.slice(0, visibleContent.length + nextCharCount);
    return true;
  };

  const flushContentRender = ({ force = false, ignoreThinkingGate = false } = {}) => {
    if (contentRenderFrame) {
      cancelAnimationFrame(contentRenderFrame);
      contentRenderFrame = 0;
    }
    const uiRef = resolveUi();
    if (!uiRef?.responseEl) return;
    lockStreamingAutoScroll();
    if (!ignoreThinkingGate && isThinkingRevealBlockingContent()) {
      if (!thinkingContentGateStartedAt) {
        thinkingContentGateStartedAt = Date.now();
      }
      resumeAutoScrollAfterThinkingGate =
        resumeAutoScrollAfterThinkingGate || state.autoScroll === true;
      if (force) {
        contentFinalRenderPending = true;
      }
      scheduleThinkingRender();
      scheduleAutoScroll({ followUp: false });
      return;
    }

    const shouldForce = force || contentFinalRenderPending;
    advanceVisibleContent({ force: shouldForce });
    const nextContent = shouldForce ? turn.models.main.content : visibleContent;
    const nextSplit = shouldForce
      ? { stableText: nextContent, liveText: "" }
      : splitStreamingMarkdown(nextContent);
    if (
      !shouldForce &&
      nextContent === lastRenderedContent &&
      nextSplit.stableText === lastRenderedStableContent &&
      nextSplit.liveText === lastRenderedLiveContent &&
      streamRenderSkipCodeHighlight === lastContentRenderSkipCodeHighlight
    ) {
      return;
    }
    const renderedSplit = renderResponseMarkdown(
      uiRef,
      topicId,
      turn,
      nextContent,
      {
        skipCodeHighlight: streamRenderSkipCodeHighlight,
        forceFull: shouldForce,
        previousStableText: lastRenderedStableContent,
        previousLiveText: lastRenderedLiveContent,
      }
    );
    const tokens = estimateTokensFromText(nextContent);
    if (uiRef.tokenEl) {
      uiRef.tokenEl.textContent = `${tokens} tokens`;
    }
    lastRenderedContent = nextContent;
    lastRenderedStableContent = renderedSplit.stableText;
    lastRenderedLiveContent = renderedSplit.liveText;
    lastContentRenderSkipCodeHighlight = streamRenderSkipCodeHighlight;
    if (shouldForce) {
      contentFinalRenderPending = false;
    }
    if (previewSyncBlockedAutoOpen) {
      const shouldAutoOpenPreview = previewSyncBlockedAutoOpen;
      previewSyncBlockedAutoOpen = false;
      schedulePreviewSync(shouldAutoOpenPreview);
    }
    scheduleAutoScroll();

    if (!force && visibleContent.length < String(turn.models.main.content || "").length) {
      scheduleContentRender();
    }
  };

  const renderContentError = (uiRef, text) => {
    if (!uiRef?.responseEl) return;
    visibleContent = String(text || "");
    contentRevealBudget = 0;
    const renderedSplit = renderResponseMarkdown(uiRef, topicId, turn, text, {
      skipCodeHighlight: streamRenderSkipCodeHighlight,
      forceFull: true,
      previousStableText: lastRenderedStableContent,
      previousLiveText: lastRenderedLiveContent,
    });
    lastRenderedContent = text;
    lastRenderedStableContent = renderedSplit.stableText;
    lastRenderedLiveContent = renderedSplit.liveText;
    scheduleAutoScroll();
  };

  const scheduleContentRender = () => {
    if (contentRenderFrame) return;
    contentRenderFrame = requestAnimationFrame(() => {
      contentRenderFrame = 0;
      flushContentRender();
    });
  };

  const flushPreviewSync = (autoOpen = true) => {
    if (previewSyncTimer) {
      clearTimeout(previewSyncTimer);
      previewSyncTimer = null;
    }
    syncHtmlPreviewForTurn(topicId, turn, {
      autoOpen,
      forceReload: false,
      preserveDuringLoad: true,
    });
    lastPreviewSyncAt = Date.now();
  };

  const schedulePreviewSync = (autoOpen = true) => {
    const elapsed = Date.now() - lastPreviewSyncAt;
    if (elapsed >= STREAM_PREVIEW_INTERVAL_MS) {
      flushPreviewSync(autoOpen);
      return;
    }
    if (previewSyncTimer) return;
    previewSyncTimer = setTimeout(
      () => flushPreviewSync(autoOpen),
      STREAM_PREVIEW_INTERVAL_MS - elapsed
    );
  };

  const updateTime = () => {
    const elapsed = (Date.now() - startTime) / 1000;
    turn.models.main.timeCostSec = elapsed;

    if (thinkingStartTime) {
      const end = thinkingEndTime || Date.now();
      const thinkingElapsed = (end - thinkingStartTime) / 1000;
      turn.models.main.thinkingTime = thinkingElapsed;
    }

    const uiRef = resolveUi();
    if (uiRef) {
      uiRef.timeEl.textContent = `${elapsed.toFixed(1)}s`;
    }

    // 实时更新速度
    const tokens =
      turn.models.main.tokens ||
      estimateTokensFromText(turn.models.main.content);
    if (tokens > 0 && elapsed > 0.1 && uiRef) {
      const speed = tokens / elapsed;
      uiRef.speedEl.textContent = `${speed.toFixed(1)} t/s`;
      uiRef.speedEl.style.display = "inline";
    }

    scheduleAutoScroll({ followUp: false });
  };

  let timeTimer = setInterval(updateTime, 200);

  try {
    const images = turn?.images || [];

    // 获取历史turns（不包含当前turn）
    const topic = state.chat.topics.find((t) => t.id === topicId) || null;
    const currentTurnIndex =
      topic?.turns?.findIndex((t) => t.id === turn.id) ?? -1;
    const historyTurns =
      currentTurnIndex > 0 ? topic.turns.slice(0, currentTurnIndex) : [];

    // 构建请求体（发送到后端）
    const useWebSearchTool = !!webSearchConfig?.enabled;
    const endpointMode = config.endpointMode === "responses"
      ? "responses"
      : "chat_completions";
    const useResponsesEndpoint = endpointMode === "responses";
    const webSearchToolMode = String(webSearchConfig?.toolMode || "tavily").toLowerCase();
    const useBuiltinWebSearch =
      useResponsesEndpoint &&
      useWebSearchTool &&
      webSearchToolMode === "builtin";
    const isAnthropicProvider = config.provider === "anthropic";
    const webSearchProvider = normalizeWebSearchProvider(
      webSearchToolMode === "anthropic_search" ||
      webSearchToolMode === "exa" ||
      webSearchToolMode === "tavily" ||
      webSearchToolMode === "gemini_search"
        ? webSearchToolMode
        : webSearchConfig?.provider
    );
    const isGeminiProvider = config.provider === "gemini";
    const useAnthropicWebSearch =
      isAnthropicProvider &&
      useWebSearchTool &&
      webSearchProvider === "anthropic_search";
    const useGeminiGoogleSearch =
      isGeminiProvider && useWebSearchTool && webSearchProvider === "gemini_search";
    const useCustomTools = !(isGeminiProvider && useGeminiGoogleSearch);
    const selectedWebSearchTool =
      webSearchProvider === "exa"
        ? "exa_search"
        : webSearchProvider === "tavily"
        ? "tavily_search"
        : "";
    const selectedTools = ["get_current_time"];
    if (useWebSearchTool && !useBuiltinWebSearch && selectedWebSearchTool) {
      selectedTools.unshift(selectedWebSearchTool);
    }
    const requestBody = {
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
      apiUrl: config.apiUrl || null,
      prompt: prompt,
      images: images,
      systemPrompt: config.systemPrompt || null,
      endpointMode,
      reasoningEffort: config.reasoningEffort,
      historyTurns: historyTurns,
      enableBuiltinWebSearch: useBuiltinWebSearch,
      enableAnthropicWebSearch: useAnthropicWebSearch,
      enableTools: useCustomTools,
      enableGoogleSearch: useGeminiGoogleSearch,
      selectedTools: useCustomTools ? selectedTools : [],
      webSearchProvider: webSearchProvider,
      webSearchMaxResults: webSearchConfig?.maxResults || 5,
      tavilyApiKey: useResponsesEndpoint
        ? null
        : (webSearchConfig?.tavilyApiKey || "").trim() || null,
      exaApiKey: useResponsesEndpoint
        ? null
        : (webSearchConfig?.exaApiKey || "").trim() || null,
      exaSearchType: webSearchConfig?.exaSearchType || "auto",
      tavilyMaxResults: webSearchConfig?.maxResults || 5,
      tavilySearchDepth: webSearchConfig?.searchDepth || "basic",
    };

    await streamJsonSse(
      buildApiUrl(
        useResponsesEndpoint ? "/api/responses/stream" : "/api/chat/stream"
      ),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
        onChunk(chunk) {
          const uiRef = resolveUi();

          if (chunk.type === "thinking" && chunk.data) {
            if (!thinkingStartTime) thinkingStartTime = Date.now();
            turn.models.main.thinking = appendThinkingChunk(
              turn.models.main.thinking,
              chunk.data
            );
            const hasAssistantOutputStarted =
              Boolean(String(turn.models.main.content || "").trim()) ||
              (Array.isArray(turn.models.main.images) &&
                turn.models.main.images.length > 0);
            const shouldKeepThinkingComplete =
              turn.models.main.thinkingComplete || hasAssistantOutputStarted;
            if (shouldKeepThinkingComplete && !thinkingEndTime) {
              thinkingEndTime = Date.now();
            }
            if (uiRef?.thinkingSectionEl) {
              scheduleThinkingRender();
              if (uiRef.thinkingLabelEl) {
                if (shouldKeepThinkingComplete) {
                  turn.models.main.thinkingComplete = true;
                  const completeLabel = formatThinkingCompleteLabel(
                    turn.models.main.thinkingTime
                  );
                  turn.models.main.thinkingLabel = completeLabel;
                  uiRef.thinkingLabelEl.textContent = completeLabel;
                  uiRef.thinkingLabelEl.classList.add("is-complete");
                } else {
                  const summary = buildThinkingLabel(
                    turn.models.main.thinking,
                    false,
                    turn.models.main.thinkingLabel
                  );
                  turn.models.main.thinkingLabel = summary;
                  uiRef.thinkingLabelEl.textContent = summary;
                  uiRef.thinkingLabelEl.classList.remove("is-complete");
                }
              }
            }
            scheduleSaveChat();
            updateScrollToBottomButton();
            const message = uiRef?.statusEl?.closest(".assistant-message");
            if (message && message.classList.contains("loading")) {
              message.classList.remove("loading");
              message.classList.add("streaming");
            }
            scheduleAutoScroll();
          } else if (chunk.type === "content" && chunk.data) {
            if (thinkingStartTime && !thinkingEndTime) {
              thinkingEndTime = Date.now();
            }
            turn.models.main.content += chunk.data;
            if (thinkingStartTime) {
              turn.models.main.thinkingComplete = true;
              if (uiRef?.thinkingLabelEl) {
                const completeLabel = formatThinkingCompleteLabel(
                  turn.models.main.thinkingTime
                );
                turn.models.main.thinkingLabel = completeLabel;
                uiRef.thinkingLabelEl.textContent = completeLabel;
                uiRef.thinkingLabelEl.classList.add("is-complete");
              }
            }
            scheduleContentRender();
            requestPreviewSync(true);
            scheduleSaveChat();
            updateScrollToBottomButton();
            const message = uiRef?.statusEl?.closest(".assistant-message");
            if (message && message.classList.contains("loading")) {
              message.classList.remove("loading");
              message.classList.add("streaming");
            }
            scheduleAutoScroll();
          } else if (chunk.type === "images" && Array.isArray(chunk.data)) {
            if (thinkingStartTime && !thinkingEndTime) {
              thinkingEndTime = Date.now();
            }
            if (!Array.isArray(turn.models.main.images)) {
              turn.models.main.images = [];
            }
            const hasNewImages = appendAssistantImages(
              turn.models.main.images,
              chunk.data
            );
            if (hasNewImages && uiRef?.responseImagesEl) {
              renderAssistantImages(uiRef.responseImagesEl, turn.models.main.images);
            }
            if (thinkingStartTime && uiRef?.thinkingLabelEl) {
              turn.models.main.thinkingComplete = true;
              const completeLabel = formatThinkingCompleteLabel(
                turn.models.main.thinkingTime
              );
              turn.models.main.thinkingLabel = completeLabel;
              uiRef.thinkingLabelEl.textContent = completeLabel;
              uiRef.thinkingLabelEl.classList.add("is-complete");
            }
            if (hasNewImages) {
              scheduleSaveChat();
            }
            updateScrollToBottomButton();
            const message = uiRef?.statusEl?.closest(".assistant-message");
            if (message && message.classList.contains("loading")) {
              message.classList.remove("loading");
              message.classList.add("streaming");
            }
            scheduleAutoScroll();
          } else if (chunk.type === "tokens" && Number.isFinite(chunk.data)) {
            turn.models.main.tokens = chunk.data;
            if (uiRef?.tokenEl) {
              uiRef.tokenEl.textContent = `${chunk.data} tokens`;
            }
            scheduleSaveChat();
          } else if (chunk.type === "tool" && chunk.data) {
            const payload =
              chunk.data && typeof chunk.data === "object" ? chunk.data : {};
            if (!Array.isArray(turn.models.main.toolEvents)) {
              turn.models.main.toolEvents = [];
            }
            turn.models.main.toolEvents.push(payload);
            if (turn.models.main.toolEvents.length > 50) {
              turn.models.main.toolEvents = turn.models.main.toolEvents.slice(-50);
            }
            if (uiRef?.toolCallsSectionEl && uiRef?.toolCallsListEl) {
              renderToolEvents(
                uiRef.toolCallsSectionEl,
                uiRef.toolCallsListEl,
                turn.models.main.toolEvents
              );
            }
            scheduleSaveChat();
            updateScrollToBottomButton();
            const message = uiRef?.statusEl?.closest(".assistant-message");
            if (message && message.classList.contains("loading")) {
              message.classList.remove("loading");
              message.classList.add("streaming");
            }
            scheduleAutoScroll();
          } else if (chunk.type === "web_search" && chunk.data) {
            const payload =
              chunk.data && typeof chunk.data === "object" ? chunk.data : {};
            if (!Array.isArray(turn.models.main.toolEvents)) {
              turn.models.main.toolEvents = [];
            }
            attachWebSearchToToolEvents(turn.models.main.toolEvents, payload);
            if (uiRef?.toolCallsSectionEl && uiRef?.toolCallsListEl) {
              renderToolEvents(
                uiRef.toolCallsSectionEl,
                uiRef.toolCallsListEl,
                turn.models.main.toolEvents
              );
            }
            scheduleSaveChat();
            updateScrollToBottomButton();
            const message = uiRef?.statusEl?.closest(".assistant-message");
            if (message && message.classList.contains("loading")) {
              message.classList.remove("loading");
              message.classList.add("streaming");
            }
            scheduleAutoScroll();
          } else if (chunk.type === "sources" && Array.isArray(chunk.data)) {
            if (!Array.isArray(turn.models.main.sources)) {
              turn.models.main.sources = [];
            }
            for (const s of chunk.data) {
              if (s?.url && !turn.models.main.sources.some((x) => x.url === s.url)) {
                turn.models.main.sources.push(s);
              }
            }
            scheduleSaveChat();
          } else if (chunk.type === "error") {
            throw new Error(chunk.data);
          }
        },
      }
    );

    streamRenderSkipCodeHighlight = false;
    thinkingFinalRenderPending = true;
    flushThinkingRender();
    flushContentRender({ force: true });
    updateTime();
    turn.models.main.status = "complete";
    const uiRef = resolveUi();
    if (uiRef?.statusEl) {
      applyStatus(uiRef.statusEl, "complete");
    }

    // 响应完成后再渲染来源摘要，避免来源先于内容显示
    if (Array.isArray(turn.models.main.sources)) {
      renderSourcesStatus(uiRef?.sourcesStatusEl, turn.models.main.sources);
      if (uiRef?.sourcesStatusRowEl) {
        uiRef.sourcesStatusRowEl.hidden = !!uiRef?.sourcesStatusEl?.hidden;
      }
    }

    if (
      turn.models.main.thinking &&
      uiRef?.thinkingSectionEl?.dataset?.userToggled !== "1"
    ) {
      uiRef.thinkingSectionEl.classList.add("collapsed");
      turn.models.main.thinkingCollapsed = true;
    }
    if (turn.models.main.thinking && uiRef?.thinkingLabelEl) {
      turn.models.main.thinkingComplete = true;
      const completeLabel = formatThinkingCompleteLabel(
        turn.models.main.thinkingTime
      );
      turn.models.main.thinkingLabel = completeLabel;
      uiRef.thinkingLabelEl.textContent = completeLabel;
      uiRef.thinkingLabelEl.classList.add("is-complete");
    }

    if (
      Array.isArray(turn.models.main.toolEvents) &&
      turn.models.main.toolEvents.length > 0 &&
      uiRef?.toolCallsSectionEl
    ) {
      uiRef.toolCallsSectionEl.classList.toggle(
        "tc-expanded",
        turn.models.main.toolCallsExpanded === true
      );
    }

    if (!Number.isFinite(turn.models.main.tokens)) {
      const tokens = estimateTokensFromText(turn.models.main.content);
      turn.models.main.tokens = tokens;
      if (uiRef?.tokenEl) {
        uiRef.tokenEl.textContent = `${tokens} tokens`;
      }

      // 确保最终速度显示正确
      if (turn.models.main.timeCostSec > 0 && uiRef?.speedEl) {
        const speed = tokens / turn.models.main.timeCostSec;
        uiRef.speedEl.textContent = `${speed.toFixed(1)} t/s`;
        uiRef.speedEl.style.display = "inline";
      }
    }

    requestPreviewSync(true);
    performAutoScroll(false);
    scheduleAutoScroll();
  } catch (error) {
    streamRenderSkipCodeHighlight = false;
    thinkingFinalRenderPending = false;
    flushThinkingRender({ force: true });
    flushContentRender({ force: true, ignoreThinkingGate: true });
    const uiRef = resolveUi();
    if (error?.name === "AbortError") {
      turn.models.main.status = "stopped";
      if (uiRef?.statusEl) applyStatus(uiRef.statusEl, "stopped");
    } else {
      console.error("模型错误:", error);
      turn.models.main.status = "error";
      turn.models.main.content = t("错误: {message}", {
        message: error.message,
      });
      if (uiRef?.responseEl) {
        renderContentError(uiRef, turn.models.main.content);
      }
      if (uiRef?.statusEl) applyStatus(uiRef.statusEl, "error");
    }
    flushPreviewSync(false);
    performAutoScroll(false);
    scheduleAutoScroll();
  } finally {
    performAutoScroll(false);
    if (timeTimer) clearInterval(timeTimer);
    timeTimer = null;
    if (contentRenderFrame) cancelAnimationFrame(contentRenderFrame);
    if (autoScrollFrame) cancelAnimationFrame(autoScrollFrame);
    if (autoScrollFollowUpFrame) cancelAnimationFrame(autoScrollFollowUpFrame);
    if (thinkingRenderTimer && !thinkingFinalRenderPending) {
      clearTimeout(thinkingRenderTimer);
    }
    if (previewSyncTimer) clearTimeout(previewSyncTimer);
    unmarkTopicRunning(topicId, abortController);
  }
}

export async function autoGenerateTitle(topicId = state.chat.activeTopicId) {
  if (!topicId) return;
  const topic = state.chat.topics.find((t) => t.id === topicId) || null;
  if (!topic) return;

  // 只在标题为"新话题"且有实际对话时才自动生成
  if (!isDefaultTopicTitle(topic.title)) return;

  const realTurns = topic.turns.filter((t) => t.prompt);
  if (realTurns.length < 1) return;
  if (state.chat.generatingTitleTopicIds.has(topic.id)) return;

  // 直接从 Title 配置获取（从主模型配置继承）
  const titleConfig = getConfig("Title");
  const resolvedTitleConfig = {
    ...titleConfig,
    apiKey: (titleConfig.apiKey || "").trim(),
    model: resolveAutoTitleModel(topic, titleConfig),
  };

  if (!hasEffectiveApiKey(resolvedTitleConfig) || !hasEffectiveModel(resolvedTitleConfig)) {
    console.warn("标题生成配置不完整，无法生成标题");
    return;
  }

  try {
    const title = await generateTopicTitle(topic.id, resolvedTitleConfig);
    const nextTitle = (title || "").trim() || fallbackTopicTitleFromTurns(topic);
    topic.title = nextTitle;
    scheduleSaveChat();
    renderTopicList();
  } catch (error) {
    console.warn("自动生成标题失败:", error.message);
    if (isDefaultTopicTitle(topic.title)) {
      topic.title = fallbackTopicTitleFromTurns(topic);
      scheduleSaveChat();
      renderTopicList();
    }
    // 静默失败，不影响用户体验
  }
}

export async function regenerateTopicTitle(topicId = state.chat.activeTopicId) {
  if (!topicId) return false;
  const topic = state.chat.topics.find((t) => t.id === topicId) || null;
  if (!topic) return false;
  if (state.chat.generatingTitleTopicIds.has(topic.id)) return false;

  const titleConfig = getConfig("Title");
  const resolvedTitleConfig = {
    ...titleConfig,
    apiKey: (titleConfig.apiKey || "").trim(),
    model: resolveAutoTitleModel(topic, titleConfig),
  };

  if (!hasEffectiveApiKey(resolvedTitleConfig) || !hasEffectiveModel(resolvedTitleConfig)) {
    await showAlert(t("请先在设置里补全标题生成模型配置"), {
      title: t("无法生成标题"),
    });
    return false;
  }

  try {
    const title = await generateTopicTitle(topic.id, resolvedTitleConfig);
    const nextTitle = (title || "").trim() || fallbackTopicTitleFromTurns(topic);
    topic.title = nextTitle;
    scheduleSaveChat();
    renderTopicList();
    return true;
  } catch (error) {
    await showAlert(error?.message || t("重新生成标题失败"), {
      title: t("生成失败"),
    });
    return false;
  }
}

export async function generateTopicTitle(topicId, config) {
  const topic = state.chat.topics.find((t) => t.id === topicId);
  if (!topic) {
    throw new Error(t("话题不存在"));
  }

  const normalizedConfig = {
    ...config,
    apiKey: (config?.apiKey || "").trim(),
    model: resolveAutoTitleModel(topic, config),
  };

  // 检查模型配置
  if (!hasEffectiveApiKey(normalizedConfig) || !hasEffectiveModel(normalizedConfig)) {
    throw new Error(t("标题生成配置不完整（需要 API Key 和模型名称）"));
  }

  // 构建对话历史（最多取前6轮）
  const messages = [];
  const turns = topic.turns.slice(0, 3); // 取前3轮对话

  for (const turn of turns) {
    if (turn.prompt) {
      messages.push({
        role: "user",
        content: turn.prompt.slice(0, 200), // 限制长度
      });
    }

    // 取助手回复
    if (turn.models.main?.content) {
      messages.push({
        role: "assistant",
        content: turn.models.main.content.slice(0, 200),
      });
    }
  }

  if (messages.length === 0) {
    throw new Error(t("话题中没有有效的对话内容"));
  }

  // 标记正在生成标题
  state.chat.generatingTitleTopicIds.add(topicId);
  renderTopicList();

  try {
    // 调用后端API生成标题
    const response = await fetch(buildApiUrl("/api/topics/generate-title"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: normalizedConfig.provider,
        apiKey: normalizedConfig.apiKey,
        model: normalizedConfig.model,
        apiUrl: normalizedConfig.apiUrl || null,
        messages: messages,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `${t("生成失败")}: ${response.status}`);
    }

    const data = await response.json();
    return data.title || "新话题";
  } finally {
    state.chat.generatingTitleTopicIds.delete(topicId);
    renderTopicList();
  }
}

export function resolveAutoTitleModel(topic, config) {
  const explicitTitleModel = (config?.model || "").trim();
  if (explicitTitleModel) return explicitTitleModel;

  const mainInputModel = (elements.model?.value || "").trim();
  if (mainInputModel) return mainInputModel;

  const turns = Array.isArray(topic?.turns) ? topic.turns : [];
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const usedModel = (turns[i]?.models?.main?.model || "").trim();
    if (usedModel) return usedModel;
  }

  return "";
}

export function fallbackTopicTitleFromTurns(topic) {
  const turns = Array.isArray(topic?.turns) ? topic.turns : [];
  for (const turn of turns) {
    const text = (turn?.prompt || "").trim();
    if (!text) continue;
    const firstLine = text.split(/\r?\n/, 1)[0].trim();
    const normalized = firstLine.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    return normalized.slice(0, 24);
  }
  return "新话题";
}
