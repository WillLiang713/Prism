import { state, elements, createId, isDesktopBackendAvailable, buildApiUrl, estimateTokensFromText } from './state.js';
import { showAlert } from './dialog.js';
import { getConfig, getWebSearchConfig, resolveModelDisplayName } from './config.js';
import { renderMarkdownToElement } from './markdown.js';
import { normalizeWebSearchProvider, renderToolEvents, renderWebSearchEvents, renderSources, renderSourcesStatus, renderSourcesToggle } from './web-search.js';
import { autoGrowPromptInput, scrollToBottom, updateScrollToBottomButton, applyStatus, setSendButtonMode } from './ui.js';
import { getActiveTopic, createTopic, setActiveTopic, isTopicRunning, markTopicRunning, unmarkTopicRunning, getLiveTurnUi, scheduleSaveChat, renderTopicList, renderChatMessages, createTurnElement, syncSendButtonModeByActiveTopic } from './chat.js';
import { clearImages } from './images.js';

export async function sendPrompt() {
  if (!isDesktopBackendAvailable()) {
    return;
  }

  const prompt = (elements.promptInput.value || "").trim();
  const hasImages =
    state.images.selectedImages && state.images.selectedImages.length > 0;

  if (!prompt && !hasImages) {
    await showAlert("请输入内容或上传图片", {
      title: "无法发送",
    });
    return;
  }

  const config = getConfig();
  const webSearchConfig = getWebSearchConfig();

  if (!config.apiKey || !config.model) {
    await showAlert("请先配置模型", {
      title: "缺少配置",
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

  turn.models.main = {
    provider: config.provider,
    model: config.model,
    displayName: resolveModelDisplayName(config.model, config.customModelName),
    thinking: "",
    toolEvents: [],
    webSearchEvents: [],
    content: "",
    tokens: null,
    timeCostSec: null,
    status: "loading",
    thinkingCollapsed: true,
  };

  topic.turns = Array.isArray(topic.turns) ? topic.turns : [];
  topic.turns.push(turn);
  topic.updatedAt = now;

  scheduleSaveChat();

  const createdEls = createTurnElement(turn);
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
    initUi.modelNameEl.textContent =
      resolveModelDisplayName(config.model, config.customModelName) || "未配置";
  }

  const abortController = new AbortController();
  markTopicRunning(topicId, abortController);

  let thinkingStartTime = null;
  let thinkingEndTime = null;

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
      if (thinkingStartTime) {
        uiRef.thinkingTimeEl.textContent = `${turn.models.main.thinkingTime.toFixed(
          1
        )}s`;
      }
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
    const webSearchProvider = normalizeWebSearchProvider(
      webSearchConfig?.provider
    );
    const selectedWebSearchTool =
      webSearchProvider === "exa" ? "exa_search" : "tavily_search";
    const requestBody = {
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
      apiUrl: config.apiUrl || null,
      prompt: prompt,
      images: images,
      systemPrompt: config.systemPrompt || null,
      reasoningEffort: config.reasoningEffort,
      historyTurns: historyTurns,
      enableTools: true,
      selectedTools: useWebSearchTool
        ? [selectedWebSearchTool, "get_current_time"]
        : ["get_current_time"],
      webSearchProvider: webSearchProvider,
      webSearchMaxResults: webSearchConfig?.maxResults || 5,
      tavilyApiKey: (webSearchConfig?.tavilyApiKey || "").trim() || null,
      exaApiKey: (webSearchConfig?.exaApiKey || "").trim() || null,
      exaSearchType: webSearchConfig?.exaSearchType || "auto",
      tavilyMaxResults: webSearchConfig?.maxResults || 5,
      tavilySearchDepth: webSearchConfig?.searchDepth || "basic",
    };

    // 调用后端接口
    const response = await fetch(buildApiUrl("/api/chat/stream"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: abortController.signal,
    });

    if (!response.ok)
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    // 处理流式响应
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim() || line.startsWith(":")) continue;
        if (!line.startsWith("data: ")) continue;

        const data = line.slice(6);
        if (data === "[DONE]") continue;

        try {
          const chunk = JSON.parse(data);
          const uiRef = resolveUi();

          if (chunk.type === "thinking" && chunk.data) {
            if (!thinkingStartTime) thinkingStartTime = Date.now();
            turn.models.main.thinking += chunk.data;
            if (uiRef?.thinkingSectionEl) {
              uiRef.thinkingSectionEl.style.display = "block";
              if (uiRef.thinkingSectionEl.dataset.userToggled !== "1") {
                uiRef.thinkingSectionEl.classList.remove("collapsed");
              }
              renderMarkdownToElement(
                uiRef.thinkingContentEl,
                turn.models.main.thinking
              );
            }
            scheduleSaveChat();
            updateScrollToBottomButton();
            // 首次收到思考内容时，移除loading类以显示body和footer
            const message = uiRef?.statusEl?.closest(".assistant-message");
            if (message && message.classList.contains("loading")) {
              message.classList.remove("loading");
              message.classList.add("streaming");
            }
            // 如果启用了自动滚动，则跟随内容滚动
            if (state.autoScroll && topicId === state.chat.activeTopicId) {
              scrollToBottom(elements.chatMessages, false);
            }
          } else if (chunk.type === "content" && chunk.data) {
            if (thinkingStartTime && !thinkingEndTime)
              thinkingEndTime = Date.now();
            turn.models.main.content += chunk.data;
            if (uiRef?.responseEl) {
              renderMarkdownToElement(uiRef.responseEl, turn.models.main.content);
              const tokens = estimateTokensFromText(turn.models.main.content);
              uiRef.tokenEl.textContent = `${tokens} tokens`;
            }
            scheduleSaveChat();
            updateScrollToBottomButton();
            // 首次收到内容时，移除loading类以显示body和footer
            const message = uiRef?.statusEl?.closest(".assistant-message");
            if (message && message.classList.contains("loading")) {
              message.classList.remove("loading");
              message.classList.add("streaming");
            }
            // 如果启用了自动滚动，则跟随内容滚动
            if (state.autoScroll && topicId === state.chat.activeTopicId) {
              scrollToBottom(elements.chatMessages, false);
            }
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
              turn.models.main.toolEvents = turn.models.main.toolEvents.slice(
                -50
              );
            }
            if (uiRef?.toolCallsSectionEl && uiRef?.toolCallsListEl) {
              renderToolEvents(
                uiRef.toolCallsSectionEl,
                uiRef.toolCallsListEl,
                turn.models.main.toolEvents
              );
              if (uiRef.toolCallsSectionEl.dataset.userToggled !== "1") {
                uiRef.toolCallsSectionEl.classList.add("tc-expanded");
              }
            }
            scheduleSaveChat();
            updateScrollToBottomButton();
            const message = uiRef?.statusEl?.closest(".assistant-message");
            if (message && message.classList.contains("loading")) {
              message.classList.remove("loading");
              message.classList.add("streaming");
            }
            if (state.autoScroll && topicId === state.chat.activeTopicId) {
              scrollToBottom(elements.chatMessages, false);
            }
          } else if (chunk.type === "web_search" && chunk.data) {
            const payload =
              chunk.data && typeof chunk.data === "object" ? chunk.data : {};
            if (!Array.isArray(turn.models.main.webSearchEvents)) {
              turn.models.main.webSearchEvents = [];
            }
            turn.models.main.webSearchEvents.push(payload);
            if (turn.models.main.webSearchEvents.length > 10) {
              turn.models.main.webSearchEvents = turn.models.main.webSearchEvents.slice(
                -10
              );
            }
            if (uiRef?.webSearchSectionEl) {
              renderWebSearchEvents(
                uiRef.webSearchSectionEl,
                turn.models.main.webSearchEvents
              );
              if (uiRef.webSearchSectionEl.dataset.userToggled !== "1") {
                uiRef.webSearchSectionEl.classList.add("sp-expanded");
              }
            }
            scheduleSaveChat();
            updateScrollToBottomButton();
            const message = uiRef?.statusEl?.closest(".assistant-message");
            if (message && message.classList.contains("loading")) {
              message.classList.remove("loading");
              message.classList.add("streaming");
            }
            if (state.autoScroll && topicId === state.chat.activeTopicId) {
              scrollToBottom(elements.chatMessages, false);
            }
          } else if (chunk.type === "sources" && Array.isArray(chunk.data)) {
            if (!Array.isArray(turn.models.main.sources)) {
              turn.models.main.sources = [];
            }
            for (const s of chunk.data) {
              if (s?.url && !turn.models.main.sources.some(x => x.url === s.url)) {
                turn.models.main.sources.push(s);
              }
            }
            // 不在流式过程中渲染来源，等响应完成后再显示
            scheduleSaveChat();
          } else if (chunk.type === "error") {
            throw new Error(chunk.data);
          }
        } catch (e) {
          if (e.message && e.message !== data) {
            throw e;
          }
          console.error(`解析响应失败:`, e, data);
        }
      }
    }

    updateTime();
    turn.models.main.status = "complete";
    const uiRef = resolveUi();
    if (uiRef?.statusEl) {
      applyStatus(uiRef.statusEl, "complete");
    }

    // 响应完成后再渲染来源入口与详情，避免来源先于内容显示
    if (Array.isArray(turn.models.main.sources)) {
      renderSourcesStatus(uiRef?.sourcesStatusEl, turn.models.main.sources);
      renderSourcesToggle(uiRef?.sourcesToggleBtnEl, turn.models.main.sources);
      renderSources(uiRef?.sourcesSectionEl, turn.models.main.sources);
    }

    if (
      turn.models.main.thinking &&
      uiRef?.thinkingSectionEl?.dataset?.userToggled !== "1"
    ) {
      uiRef.thinkingSectionEl.classList.add("collapsed");
      turn.models.main.thinkingCollapsed = true;
    }

    if (
      Array.isArray(turn.models.main.toolEvents) &&
      turn.models.main.toolEvents.length > 0 &&
      uiRef?.toolCallsSectionEl?.dataset?.userToggled !== "1"
    ) {
      uiRef.toolCallsSectionEl.classList.remove("tc-expanded");
    }

    if (
      Array.isArray(turn.models.main.webSearchEvents) &&
      turn.models.main.webSearchEvents.length > 0 &&
      uiRef?.webSearchSectionEl?.dataset?.userToggled !== "1"
    ) {
      uiRef.webSearchSectionEl.classList.remove("sp-expanded");
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
  } catch (error) {
    const uiRef = resolveUi();
    if (error?.name === "AbortError") {
      turn.models.main.status = "stopped";
      if (uiRef?.statusEl) applyStatus(uiRef.statusEl, "stopped");
    } else {
      console.error("模型错误:", error);
      turn.models.main.status = "error";
      turn.models.main.content = `错误: ${error.message}`;
      if (uiRef?.responseEl) {
        renderMarkdownToElement(uiRef.responseEl, turn.models.main.content);
      }
      if (uiRef?.statusEl) applyStatus(uiRef.statusEl, "error");
    }
  } finally {
    if (timeTimer) clearInterval(timeTimer);
    timeTimer = null;
    unmarkTopicRunning(topicId, abortController);
  }
}

export async function autoGenerateTitle(topicId = state.chat.activeTopicId) {
  if (!topicId) return;
  const topic = state.chat.topics.find((t) => t.id === topicId) || null;
  if (!topic) return;

  // 只在标题为"新话题"且有实际对话时才自动生成
  if (!topic.title.startsWith("新话题")) return;

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

  if (!resolvedTitleConfig.apiKey || !resolvedTitleConfig.model) {
    console.warn("标题生成配置不完整，无法生成标题");
    return;
  }

  try {
    const title = await generateTopicTitle(topic.id, resolvedTitleConfig);
    const nextTitle = (title || "").trim() || fallbackTopicTitleFromTurns(topic);
    topic.title = nextTitle;
    topic.updatedAt = Date.now();
    scheduleSaveChat();
    renderTopicList();
  } catch (error) {
    console.warn("自动生成标题失败:", error.message);
    if (topic.title.startsWith("新话题")) {
      topic.title = fallbackTopicTitleFromTurns(topic);
      topic.updatedAt = Date.now();
      scheduleSaveChat();
      renderTopicList();
    }
    // 静默失败，不影响用户体验
  }
}

export async function generateTopicTitle(topicId, config) {
  const topic = state.chat.topics.find((t) => t.id === topicId);
  if (!topic) {
    throw new Error("话题不存在");
  }

  const normalizedConfig = {
    ...config,
    apiKey: (config?.apiKey || "").trim(),
    model: resolveAutoTitleModel(topic, config),
  };

  // 检查模型配置
  if (!normalizedConfig.apiKey || !normalizedConfig.model) {
    throw new Error("标题生成配置不完整（需要 API Key 和模型名称）");
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
    throw new Error("话题中没有有效的对话内容");
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
      throw new Error(errorData.detail || `生成失败: ${response.status}`);
    }

    const data = await response.json();
    return data.title || "新对话";
  } finally {
    state.chat.generatingTitleTopicIds.delete(topicId);
    renderTopicList();
  }
}

export function resolveAutoTitleModel(topic, config) {
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
  return "新对话";
}
