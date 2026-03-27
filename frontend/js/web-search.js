import { state, elements, STORAGE_KEYS, truncateText, buildApiUrl, isDesktopRuntime, resolveProviderSelection } from './state.js';
import {
  mountBodyDropdown,
  unmountBodyDropdown,
  clearBodyDropdownPosition,
  positionBodyDropdown,
} from './dropdown.js';
import { isMobileLayout } from './layout.js';

const WEB_SEARCH_TOOL_MODE_LABELS = {
  builtin: "OpenAI Web Search",
  anthropic_search: "Anthropic Web Search",
  gemini_search: "Google Search",
  tavily: "Tavily",
  exa: "Exa",
};

const WEB_SEARCH_TOOL_MODE_COMPACT_LABELS = {
  builtin: "OpenAI",
  anthropic_search: "Anthropic",
  gemini_search: "Google",
  tavily: "Tavily",
  exa: "Exa",
};

const TOOL_EVENT_DISPLAY_NAMES = {
  web_search: "OpenAI Web Search",
  web_search_preview: "OpenAI Web Search",
  anthropic_search: "Anthropic Web Search",
  gemini_search: "Google Search",
  tavily_search: "Tavily Search",
  exa_search: "Exa Search",
  get_current_time: "当前时间",
};

const WEB_SEARCH_DISABLED_LABEL = "关闭联网";
const WEB_SEARCH_TOOL_DROPDOWN_MIN_WIDTH = 108;

function mountWebSearchToolDropdown(dropdownEl = elements.webSearchToolDropdown) {
  if (!(dropdownEl instanceof HTMLElement)) return;
  mountBodyDropdown(dropdownEl);
}

function unmountWebSearchToolDropdown(dropdownEl = elements.webSearchToolDropdown) {
  if (!(dropdownEl instanceof HTMLElement)) return;
  unmountBodyDropdown(dropdownEl);
}

function clearWebSearchToolDropdownPosition(dropdownEl = elements.webSearchToolDropdown) {
  clearBodyDropdownPosition(dropdownEl);
}

export function positionWebSearchToolSelector() {
  const dropdownEl = elements.webSearchToolDropdown;
  const buttonEl = elements.webSearchToolCurrent;
  if (!(dropdownEl instanceof HTMLElement) || !(buttonEl instanceof HTMLElement)) return;
  if (!state.webSearch.selectorOpen) {
    clearWebSearchToolDropdownPosition(dropdownEl);
    return;
  }
  positionBodyDropdown(dropdownEl, buttonEl, {
    minWidth: WEB_SEARCH_TOOL_DROPDOWN_MIN_WIDTH,
    minViewportWidth: 180,
    viewportPadding: 12,
    gap: 8,
    align: "center",
  });
}

export function renderWebSearchSection(container, webSearch, options = {}) {
  if (!container) return;
  container.innerHTML = "";
  if (!webSearch) return;

  const allowToggle = options.allowToggle !== false;
  const defaultCollapsed = options.defaultCollapsed !== false;
  const showTitle = options.showTitle !== false;
  const showStatus = options.showStatus !== false;
  const customStatusText = typeof options.statusText === "string"
    ? options.statusText
    : "";

  const header = document.createElement("div");
  header.className = "web-search-header";

  if (showTitle) {
    const title = document.createElement("span");
    title.className = "web-search-title";
    title.textContent = "联网搜索";
    header.appendChild(title);
  }

  if (showStatus) {
    const status = document.createElement("span");
    status.className = `web-search-status ${webSearch.status || "ready"}`;

    // 添加spinner元素
    const spinner = document.createElement("span");
    spinner.className = "web-search-status-spinner";
    status.appendChild(spinner);

    // 添加状态文本
    const statusText = document.createElement("span");
    statusText.textContent = customStatusText || (
      webSearch.status === "loading"
        ? "搜索中"
        : webSearch.status === "error"
        ? "搜索失败"
        : "联网搜索"
    );
    status.appendChild(statusText);
    header.appendChild(status);
  }

  const body = document.createElement("div");
  body.className = "web-search-body";

  if (webSearch.status === "loading") {
    const hint = document.createElement("div");
    hint.className = "web-search-hint";
    hint.textContent = "搜索中…";
    body.appendChild(hint);
  } else if (webSearch.status === "error") {
    const err = document.createElement("div");
    err.className = "web-search-error";
    err.textContent = webSearch.error || "联网搜索失败";
    body.appendChild(err);
  } else {
    if (webSearch.answer) {
      const ans = document.createElement("div");
      ans.className = "web-search-answer";
      ans.textContent = truncateText(webSearch.answer, 600);
      body.appendChild(ans);
    }

    const results = Array.isArray(webSearch.results) ? webSearch.results : [];
    if (results.length) {
      const list = document.createElement("ol");
      list.className = "web-search-results";
      results.forEach((r) => {
        const item = document.createElement("li");
        item.className = "web-search-result-card";

        const link = document.createElement("a");
        link.className = "web-search-result-link";
        link.href = r.url || "#";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = r.title || r.url || "(无标题)";
        item.appendChild(link);

        if (r.url) {
          const meta = document.createElement("div");
          meta.className = "web-search-result-meta";
          try {
            meta.textContent = new URL(r.url).hostname || r.url;
          } catch {
            meta.textContent = r.url;
          }
          item.appendChild(meta);
        }

        const snippet = document.createElement("div");
        snippet.className = "web-search-snippet";
        snippet.textContent = truncateText(r.content || r.snippet || "", 260);
        if (snippet.textContent) item.appendChild(snippet);

        list.appendChild(item);
      });
      body.appendChild(list);
    } else {
      const empty = document.createElement("div");
      empty.className = "web-search-hint";
      empty.textContent = "未返回结果。";
      body.appendChild(empty);
    }
  }

  if (allowToggle && header.childElementCount > 0) {
    // 绑定折叠/展开事件
    header.addEventListener("click", () => {
      container.classList.toggle("collapsed");
      container.classList.toggle("expanded");
      // 用户手动操作后，标记为已手动操作，取消自动折叠
      container.dataset.userToggled = "1";
    });
  }

  if (header.childElementCount > 0) {
    container.appendChild(header);
  }
  container.appendChild(body);

  if (defaultCollapsed) {
    container.classList.add("collapsed");
    container.classList.remove("expanded");
  } else {
    container.classList.remove("collapsed");
    container.classList.add("expanded");
  }
}

export function formatToolEventDisplay(event) {
  if (!event || typeof event !== "object") {
    return {
      title: "未知工具",
      body: "",
    };
  }

  const rawName = (event.name || "未知工具").trim();
  const name = TOOL_EVENT_DISPLAY_NAMES[rawName] || rawName;
  const status = event.status || "info";
  const rawArgs = event.arguments;
  const normalizedArgs = rawArgs && typeof rawArgs === "object"
    ? Object.fromEntries(
        Object.entries(rawArgs).filter(([, value]) => {
          if (value == null) return false;
          if (typeof value === "string") return value.trim() !== "";
          return true;
        })
      )
    : rawArgs;
  const args = normalizedArgs && typeof normalizedArgs === "object"
    ? Object.keys(normalizedArgs).length > 0
      ? JSON.stringify(normalizedArgs, null, 0)
      : ""
    : typeof rawArgs === "string"
    ? rawArgs
    : "";

  if (status === "start") {
    return {
      title: name,
      body: args ? `参数：${truncateText(args, 180)}` : "等待工具返回结果",
    };
  }

  if (status === "error") {
    return {
      title: name,
      body: event.resultSummary || event.error || "未知错误",
    };
  }

  if (status === "success") {
    return {
      title: name,
      body: event.resultSummary || "调用完成",
    };
  }

  return {
    title: name,
    body: event.resultSummary || "",
  };
}

function normalizeToolEventRound(value) {
  const round = Number(value);
  return Number.isFinite(round) ? round : null;
}

function getToolEventIdentity(event, fallbackIndex = 0) {
  if (!event || typeof event !== "object") {
    return `unknown:${fallbackIndex}`;
  }

  const callId = String(event.callId || "").trim();
  if (callId) return `call:${callId}`;

  const name = String(event.name || "").trim();
  const round = normalizeToolEventRound(event.round);
  if (name && round !== null) return `round:${round}|name:${name}`;

  return `unknown:${fallbackIndex}`;
}

function mergeToolEventState(previousEvent, nextEvent) {
  const previous = previousEvent && typeof previousEvent === "object"
    ? previousEvent
    : {};
  const next = nextEvent && typeof nextEvent === "object" ? nextEvent : {};

  return {
    ...previous,
    ...next,
    callId: String(next.callId || previous.callId || "").trim(),
    arguments: next.arguments ?? previous.arguments,
    resultSummary: next.resultSummary || previous.resultSummary || "",
    error: next.error || previous.error || "",
    webSearch: next.webSearch || previous.webSearch || null,
  };
}

function compactToolEvents(events) {
  const items = Array.isArray(events) ? events : [];
  const compacted = [];
  const indexByIdentity = new Map();

  items.forEach((event, index) => {
    if (!event || typeof event !== "object") return;

    const identity = getToolEventIdentity(event, index);
    const existingIndex = indexByIdentity.get(identity);

    if (existingIndex === undefined) {
      indexByIdentity.set(identity, compacted.length);
      compacted.push({ ...event });
      return;
    }

    compacted[existingIndex] = mergeToolEventState(
      compacted[existingIndex],
      event
    );
  });

  return compacted;
}

function isSameToolCall(event, webSearchEvent) {
  if (!event || !webSearchEvent) return false;

  const eventCallId = String(event.callId || "").trim();
  const searchCallId = String(webSearchEvent.callId || "").trim();
  if (eventCallId && searchCallId) {
    return eventCallId === searchCallId;
  }

  const eventName = String(event.name || "").trim();
  const searchName = String(webSearchEvent.name || "").trim();
  if (!eventName || !searchName || eventName !== searchName) return false;

  const eventRound = normalizeToolEventRound(event.round);
  const searchRound = normalizeToolEventRound(webSearchEvent.round);
  return eventRound !== null && searchRound !== null && eventRound === searchRound;
}

function createNormalizedWebSearchEvent(webSearchEvent) {
  if (!webSearchEvent || typeof webSearchEvent !== "object") return null;
  const rawName = String(webSearchEvent.name || "").trim();
  return {
    ...webSearchEvent,
    callId: String(webSearchEvent.callId || "").trim(),
    name: TOOL_EVENT_DISPLAY_NAMES[rawName] || rawName || "Web Search",
    query: String(webSearchEvent.query || "").trim(),
    answer: String(webSearchEvent.answer || "").trim(),
    results: Array.isArray(webSearchEvent.results) ? webSearchEvent.results : [],
  };
}

export function attachWebSearchToToolEvents(toolEvents, webSearchEvent) {
  const items = Array.isArray(toolEvents) ? toolEvents : [];
  const normalized = createNormalizedWebSearchEvent(webSearchEvent);
  if (!normalized) return items;

  let matchedIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const event = items[index];
    if (!event || typeof event !== "object") continue;
    if (!isSameToolCall(event, normalized)) continue;
    if (event.status === "error") continue;
    if (!event.webSearch) {
      matchedIndex = index;
      break;
    }
    if (matchedIndex === -1) matchedIndex = index;
  }

  if (matchedIndex >= 0) {
    items[matchedIndex] = {
      ...items[matchedIndex],
      webSearch: normalized,
    };
    return items;
  }

  items.push({
    callId: String(normalized.callId || "").trim(),
    status: normalized.status === "error" ? "error" : "success",
    round: normalized.round,
    name: normalized.name,
    resultSummary: normalized.query
      ? `查询：${truncateText(normalized.query, 80)}`
      : "Web Search",
    webSearch: normalized,
    synthetic: true,
  });
  return items;
}

export function mergeToolEventsWithWebSearch(toolEvents, webSearchEvents) {
  const merged = Array.isArray(toolEvents)
    ? toolEvents.map((event) =>
        event && typeof event === "object" ? { ...event } : event
      )
    : [];

  const searches = Array.isArray(webSearchEvents) ? webSearchEvents : [];
  searches.forEach((event) => {
    attachWebSearchToToolEvents(merged, event);
  });
  return compactToolEvents(merged);
}

function renderToolEventWebSearch(container, webSearchEvent) {
  const normalized = createNormalizedWebSearchEvent(webSearchEvent);
  if (!container || !normalized) return;

  const card = document.createElement("div");
  card.className = "web-search expanded tool-call-search-preview";

  const answerParts = [];
  if (normalized.query) answerParts.push(`查询：${normalized.query}`);
  if (normalized.answer) answerParts.push(`摘要：${normalized.answer}`);

  renderWebSearchSection(
    card,
    {
      status: normalized.status || "ready",
      answer: answerParts.join("\n"),
      results: normalized.results,
    },
    {
      allowToggle: false,
      defaultCollapsed: false,
      showTitle: false,
      showStatus: false,
    }
  );

  card.classList.remove("collapsed");
  card.classList.add("expanded");
  container.appendChild(card);
}

export function renderToolEvents(sectionEl, listEl, events) {
  if (!sectionEl || !listEl) return;
  const items = compactToolEvents(events);

  if (!items.length) {
    sectionEl.style.display = "none";
    listEl.innerHTML = "";
    return;
  }

  sectionEl.style.display = "block";
  listEl.innerHTML = "";

  // Determine overall status
  const hasError = items.some((e) => e.status === "error");
  const allDone = items.every((e) => e.status === "success" || e.status === "error");
  sectionEl.classList.remove("tc-running", "tc-success", "tc-error");
  if (hasError) sectionEl.classList.add("tc-error");
  else if (allDone) sectionEl.classList.add("tc-success");
  else sectionEl.classList.add("tc-running");

  // Build header if not already present
  if (!sectionEl.querySelector(".tool-calls-header")) {
    const header = document.createElement("div");
    header.className = "tool-calls-header";

    header.innerHTML = `
      <span class="tool-calls-header-text"></span>`;

    // Wrap list in detail container
    const detail = document.createElement("div");
    detail.className = "tool-calls-detail";

    // Move listEl into detail
    sectionEl.innerHTML = "";
    detail.appendChild(listEl);
    sectionEl.appendChild(header);
    sectionEl.appendChild(detail);

    header.addEventListener("click", () => {
      sectionEl.dataset.userToggled = "1";
      sectionEl.classList.toggle("tc-expanded");
      sectionEl.dispatchEvent(
        new CustomEvent("toolcalls-toggle", {
          detail: {
            expanded: sectionEl.classList.contains("tc-expanded"),
          },
        })
      );
    });
  }

  // Update header text
  const headerText = sectionEl.querySelector(".tool-calls-header-text");
  if (headerText) {
    const count = items.length;
    headerText.textContent = `工具调用 · ${count} 步`;
  }

  // Render items
  items.forEach((event) => {
    const display = formatToolEventDisplay(event);
    const li = document.createElement("li");
    li.className = `tool-call-item ${event.status || "info"}`;

    const titleRow = document.createElement("div");
    titleRow.className = "tool-call-item-title-row";

    const title = document.createElement("span");
    title.className = "tool-call-item-title";
    title.textContent = display.title;

    titleRow.appendChild(title);
    li.appendChild(titleRow);

    if (display.body) {
      const body = document.createElement("div");
      body.className = "tool-call-item-body";
      body.textContent = display.body;
      li.appendChild(body);
    }

    if (event?.webSearch) {
      renderToolEventWebSearch(li, event.webSearch);
    }

    listEl.appendChild(li);
  });
}

export function renderWebSearchEvents(sectionEl, events) {
  if (!sectionEl) return;
  const items = Array.isArray(events) ? events : [];
  if (!items.length) {
    sectionEl.style.display = "none";
    sectionEl.innerHTML = "";
    return;
  }

  sectionEl.style.display = "block";

  const hasError = items.some((e) => String(e?.status || "") === "error");
  const allDone = items.every((e) => String(e?.status || "") !== "loading");
  sectionEl.classList.remove("sp-running", "sp-success", "sp-error");
  if (hasError) sectionEl.classList.add("sp-error");
  else if (allDone) sectionEl.classList.add("sp-success");
  else sectionEl.classList.add("sp-running");

  let list = sectionEl.querySelector(".search-preview-list");
  if (!sectionEl.querySelector(".search-preview-header") || !list) {
    const header = document.createElement("div");
    header.className = "search-preview-header";
    header.innerHTML = `
      <span class="search-preview-header-text"></span>
      <svg class="search-preview-header-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>`;

    const detail = document.createElement("div");
    detail.className = "search-preview-detail";

    list = document.createElement("div");
    list.className = "search-preview-list";

    sectionEl.innerHTML = "";
    detail.appendChild(list);
    sectionEl.appendChild(header);
    sectionEl.appendChild(detail);

    header.addEventListener("click", () => {
      sectionEl.dataset.userToggled = "1";
      sectionEl.classList.toggle("sp-expanded");
    });
  }

  const headerText = sectionEl.querySelector(".search-preview-header-text");
  if (headerText) {
    const roundCount = items.length;
    headerText.textContent = `联网结果 · ${roundCount} 次`;
  }

  list.innerHTML = "";

  items.forEach((event) => {
    const card = document.createElement("div");
    card.className = "web-search expanded search-preview-item";

    const queryText = (event?.query || "").trim();
    const answerText = (event?.answer || "").trim();
    const answerParts = [];
    if (queryText) answerParts.push(`查询：${queryText}`);
    if (answerText) answerParts.push(`摘要：${answerText}`);

    renderWebSearchSection(card, {
      status: event?.status || "ready",
      answer: answerParts.join("\n"),
      results: Array.isArray(event?.results) ? event.results : [],
    }, {
      allowToggle: false,
      defaultCollapsed: false,
      showTitle: false,
      showStatus: false,
    });

    card.classList.remove("collapsed");
    card.classList.add("expanded");

    list.appendChild(card);
  });
}

function getSourceHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch (_) {
    return "";
  }
}

function getSourceItems(sources) {
  return Array.isArray(sources) ? sources.filter((item) => item?.url) : [];
}

export function renderSourcesStatus(statusEl, sources) {
  if (!statusEl) return;
  const items = getSourceItems(sources);
  if (!items.length) {
    statusEl.hidden = true;
    statusEl.innerHTML = "";
    return;
  }

  statusEl.hidden = false;
  statusEl.innerHTML = "";

  const text = document.createElement("span");
  text.className = "sources-status-text";
  text.textContent = `已核对 ${items.length} 个来源`;
  statusEl.appendChild(text);
}

export function renderSourcesToggle(buttonEl, sources) {
  if (!buttonEl) return;
  const items = getSourceItems(sources);
  if (!items.length) {
    buttonEl.hidden = true;
    buttonEl.disabled = true;
    buttonEl.classList.remove("is-active");
    buttonEl.setAttribute("aria-expanded", "false");
    buttonEl.textContent = "来源";
    buttonEl.setAttribute("aria-label", "暂无来源");
    return;
  }

  buttonEl.hidden = false;
  buttonEl.disabled = false;
  buttonEl.textContent = `来源 ${items.length}`;
  buttonEl.setAttribute("aria-label", `查看 ${items.length} 个来源`);
}

export function renderSources(sectionEl, sources) {
  if (!sectionEl) return;
  const items = getSourceItems(sources);
  if (!items.length) {
    sectionEl.hidden = true;
    sectionEl.innerHTML = "";
    return;
  }

  sectionEl.innerHTML = "";

  const list = document.createElement("div");
  list.className = "sources-list";

  items.forEach((s, index) => {
    const chip = document.createElement("a");
    chip.className = "source-chip";
    chip.href = s.url || "#";
    chip.target = "_blank";
    chip.rel = "noopener noreferrer";

    const hostname = getSourceHostname(s.url);

    const order = document.createElement("span");
    order.className = "source-chip-index";
    order.textContent = String(index + 1).padStart(2, "0");

    const body = document.createElement("div");
    body.className = "source-chip-body";

    const label = document.createElement("span");
    label.className = "source-chip-label";
    label.textContent = s.title || hostname || s.url;

    const urlLine = document.createElement("span");
    urlLine.className = "source-chip-url";
    urlLine.textContent = hostname || s.url;

    body.appendChild(label);
    body.appendChild(urlLine);

    chip.appendChild(order);
    chip.appendChild(body);
    list.appendChild(chip);
  });

  sectionEl.appendChild(list);
}

export function buildPromptWithWebSearch(originalPrompt, webSearch) {
  const results = Array.isArray(webSearch?.results) ? webSearch.results : [];
  const lines = [];
  lines.push(
    "你将获得一些联网搜索结果。请优先基于这些结果作答。来源入口会在界面中自动展示，回复中无需重复列出参考链接。"
  );

  if (webSearch?.answer)
    lines.push(`搜索摘要：${truncateText(webSearch.answer, 1200)}`);

  if (results.length) {
    // 传递所有搜索结果给AI，不再限制为5条
    const formatted = results.map((r, i) => {
      const title = (r.title || "").trim();
      const url = (r.url || "").trim();
      const snippet = truncateText((r.content || r.snippet || "").trim(), 800);
      return [
        `[${i + 1}] ${title || url || "(无标题)"}`,
        url ? `URL: ${url}` : "",
        snippet ? `摘要: ${snippet}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    });
    lines.push("搜索结果：\n" + formatted.join("\n\n"));
  }

  lines.push("用户问题：" + originalPrompt);
  return lines.join("\n\n");
}

export function normalizeTavilySearchDepth(value) {
  return String(value || "").toLowerCase() === "advanced"
    ? "advanced"
    : "basic";
}

export function normalizeWebSearchProvider(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "anthropic_search") return "anthropic_search";
  if (normalized === "gemini_search") return "gemini_search";
  if (normalized === "exa") return "exa";
  return "tavily";
}

export function normalizeExternalWebSearchProvider(value) {
  return normalizeWebSearchProvider(value) === "exa" ? "exa" : "tavily";
}

export function normalizeExaSearchType(value) {
  const normalized = String(value || "").toLowerCase();
  const allowed = new Set([
    "auto",
    "neural",
    "fast",
    "deep",
    "deep-reasoning",
    "deep-max",
    "instant",
  ]);
  return allowed.has(normalized) ? normalized : "auto";
}

export function normalizeEndpointMode(value) {
  return String(value || "").toLowerCase() === "responses"
    ? "responses"
    : "chat_completions";
}

export function canUseBuiltinWebSearch(configLike = {}) {
  const providerConfig = resolveProviderSelection(
    configLike.providerSelection ??
      configLike.provider ??
      elements.provider?.value,
    configLike.endpointMode
  );
  const endpointMode = normalizeEndpointMode(
    configLike.endpointMode ?? providerConfig.endpointMode
  );
  const provider = String(providerConfig.provider || "openai").toLowerCase();
  return endpointMode === "responses" && provider === "openai";
}

export function canUseAnthropicWebSearch(configLike = {}) {
  const providerConfig = resolveProviderSelection(
    configLike.providerSelection ??
      configLike.provider ??
      elements.provider?.value,
    configLike.endpointMode
  );
  return String(providerConfig.provider || "").toLowerCase() === "anthropic";
}

export function canUseGeminiGoogleSearch(configLike = {}) {
  const providerConfig = resolveProviderSelection(
    configLike.providerSelection ??
      configLike.provider ??
      elements.provider?.value,
    configLike.endpointMode
  );
  return String(providerConfig.provider || "").toLowerCase() === "gemini";
}

export function getPreferredWebSearchToolMode(
  configLike = {},
  fallbackProvider = normalizeExternalWebSearchProvider(
    elements.webSearchProvider?.value
  )
) {
  if (canUseBuiltinWebSearch(configLike)) return "builtin";
  if (canUseAnthropicWebSearch(configLike)) return "anthropic_search";
  if (canUseGeminiGoogleSearch(configLike)) return "gemini_search";
  return fallbackProvider === "exa" ? "exa" : "tavily";
}

export function isNativeWebSearchToolMode(mode) {
  const normalized = String(mode || "").toLowerCase();
  return (
    normalized === "builtin" ||
    normalized === "anthropic_search" ||
    normalized === "gemini_search"
  );
}

export function resolvePreferredWebSearchState(
  configLike = {},
  options = {}
) {
  const toolMode = getPreferredWebSearchToolMode(
    configLike,
    options.fallbackProvider
  );
  const currentMode = String(options.currentMode || "").toLowerCase();
  const currentEnabled = options.currentEnabled === true;

  if (isNativeWebSearchToolMode(toolMode)) {
    return {
      toolMode,
      enabled: true,
    };
  }

  if (currentEnabled && isNativeWebSearchToolMode(currentMode)) {
    return {
      toolMode,
      enabled: false,
    };
  }

  return {
    toolMode,
    enabled: currentEnabled,
  };
}

export function normalizeWebSearchToolMode(
  value,
  supportsBuiltin = canUseBuiltinWebSearch(),
  supportsAnthropicWebSearch = canUseAnthropicWebSearch(),
  supportsGeminiGoogleSearch = canUseGeminiGoogleSearch(),
  fallbackProvider = normalizeWebSearchProvider(elements.webSearchProvider?.value)
) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "builtin" && supportsBuiltin) return "builtin";
  if (normalized === "anthropic_search" && supportsAnthropicWebSearch) {
    return "anthropic_search";
  }
  if (normalized === "gemini_search" && supportsGeminiGoogleSearch) {
    return "gemini_search";
  }
  if (normalized === "exa") return "exa";
  if (normalized === "tavily") return "tavily";
  if (fallbackProvider === "anthropic_search" && supportsAnthropicWebSearch) {
    return "anthropic_search";
  }
  if (fallbackProvider === "gemini_search" && supportsGeminiGoogleSearch) {
    return "gemini_search";
  }
  return fallbackProvider === "exa" ? "exa" : "tavily";
}

export function isWebSearchEnabled() {
  return state.webSearch?.enabled === true;
}

function persistWebSearchConfigPatch(patch) {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.config);
    const config = raw ? JSON.parse(raw) : {};
    config.webSearch = {
      ...(config.webSearch || {}),
      ...patch,
    };
    localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(config));
  } catch (error) {
    console.error("保存联网配置失败:", error);
  }
}

export function getCurrentWebSearchToolMode() {
  return normalizeWebSearchToolMode(
    state.webSearch?.toolMode,
    canUseBuiltinWebSearch(),
    canUseAnthropicWebSearch(),
    canUseGeminiGoogleSearch(),
    normalizeWebSearchProvider(elements.webSearchProvider?.value)
  );
}

export function getWebSearchToolModeLabel(mode) {
  const normalized = String(mode || "").toLowerCase();
  const fallbackMode = normalizeWebSearchToolMode(mode, true, true, true, "tavily");
  return WEB_SEARCH_TOOL_MODE_LABELS[normalized]
    || WEB_SEARCH_TOOL_MODE_LABELS[fallbackMode]
    || "Tavily";
}

function getWebSearchToolButtonLabel(mode) {
  const normalized = String(mode || "").toLowerCase();
  const fallbackMode = normalizeWebSearchToolMode(mode, true, true, true, "tavily");
  const resolvedMode = WEB_SEARCH_TOOL_MODE_LABELS[normalized] ? normalized : fallbackMode;
  if (isMobileLayout()) {
    return WEB_SEARCH_TOOL_MODE_COMPACT_LABELS[resolvedMode]
      || getWebSearchToolModeLabel(resolvedMode);
  }
  return getWebSearchToolModeLabel(resolvedMode);
}

export function getAvailableWebSearchToolModes() {
  const supportsBuiltin = canUseBuiltinWebSearch();
  const supportsAnthropicWebSearch = canUseAnthropicWebSearch();
  const supportsGeminiGoogleSearch = canUseGeminiGoogleSearch();
  const items = [
    {
      value: "off",
      label: WEB_SEARCH_DISABLED_LABEL,
    },
  ];
  if (supportsBuiltin) {
    items.push({
      value: "builtin",
      label: WEB_SEARCH_TOOL_MODE_LABELS.builtin,
    });
  }
  if (supportsAnthropicWebSearch) {
    items.push({
      value: "anthropic_search",
      label: WEB_SEARCH_TOOL_MODE_LABELS.anthropic_search,
    });
  }
  if (supportsGeminiGoogleSearch) {
    items.push({
      value: "gemini_search",
      label: WEB_SEARCH_TOOL_MODE_LABELS.gemini_search,
    });
  }
  items.push(
    { value: "tavily", label: WEB_SEARCH_TOOL_MODE_LABELS.tavily },
    { value: "exa", label: WEB_SEARCH_TOOL_MODE_LABELS.exa }
  );
  return items;
}

export function persistWebSearchToolMode(mode) {
  persistWebSearchConfigPatch({ toolMode: mode });
}

function disableBuiltinWebSearchWhenUnavailable(options = {}) {
  if (state.webSearch?.toolMode !== "builtin") return false;
  if (canUseBuiltinWebSearch()) return false;

  state.webSearch.enabled = false;
  if (options.persist === true) {
    persistWebSearchConfigPatch({ enabled: false });
  }
  closeWebSearchToolSelector();
  return true;
}

function disableGeminiGoogleSearchWhenUnavailable(options = {}) {
  if (state.webSearch?.toolMode !== "gemini_search") return false;
  if (canUseGeminiGoogleSearch()) return false;

  state.webSearch.enabled = false;
  if (options.persist === true) {
    persistWebSearchConfigPatch({ enabled: false });
  }
  closeWebSearchToolSelector();
  return true;
}

function disableAnthropicWebSearchWhenUnavailable(options = {}) {
  if (state.webSearch?.toolMode !== "anthropic_search") return false;
  if (canUseAnthropicWebSearch()) return false;

  state.webSearch.enabled = false;
  if (options.persist === true) {
    persistWebSearchConfigPatch({ enabled: false });
  }
  closeWebSearchToolSelector();
  return true;
}

export function setWebSearchEnabled(enabled, options = {}) {
  state.webSearch.enabled = enabled === true;
  if (options.persist !== false) {
    persistWebSearchConfigPatch({ enabled: state.webSearch.enabled });
  }
  renderWebSearchToolSelector();
  updateWebSearchProviderUi();
  return state.webSearch.enabled;
}

export function setWebSearchToolMode(mode, options = {}) {
  const supportsBuiltin = canUseBuiltinWebSearch();
  const supportsAnthropicWebSearch = canUseAnthropicWebSearch();
  const supportsGeminiGoogleSearch = canUseGeminiGoogleSearch();
  const normalized = normalizeWebSearchToolMode(
    mode,
    supportsBuiltin,
    supportsAnthropicWebSearch,
    supportsGeminiGoogleSearch,
    normalizeWebSearchProvider(elements.webSearchProvider?.value)
  );
  state.webSearch.toolMode = normalized;

  // `webSearchProvider` select only stores the external fallback provider.
  // Native search modes should stay in `state.webSearch.toolMode` only.
  if (normalized === "tavily" || normalized === "exa") {
    if (elements.webSearchProvider) {
      elements.webSearchProvider.value = normalized;
    }
  }

  if (options.persist !== false) {
    persistWebSearchToolMode(normalized);
  }

  renderWebSearchToolSelector();
  updateWebSearchProviderUi();
  return normalized;
}

export function applyWebSearchSelection(selection, options = {}) {
  const normalizedSelection = String(selection || "").toLowerCase();
  if (normalizedSelection === "off") {
    if (options.persist !== false) {
      persistWebSearchConfigPatch({ enabled: false });
    }
    state.webSearch.enabled = false;
    closeWebSearchToolSelector();
    renderWebSearchToolSelector();
    updateWebSearchProviderUi();
    return "off";
  }

  const nextMode = setWebSearchToolMode(selection, { persist: false });
  state.webSearch.enabled = true;
  if (options.persist !== false) {
    persistWebSearchConfigPatch({
      enabled: true,
      toolMode: nextMode,
    });
  }
  closeWebSearchToolSelector();
  renderWebSearchToolSelector();
  updateWebSearchProviderUi();
  return nextMode;
}

export function closeWebSearchToolSelector() {
  state.webSearch.selectorOpen = false;
  elements.webSearchControl?.classList.remove("is-open");
  elements.webSearchToolCurrent?.setAttribute("aria-expanded", "false");
  clearWebSearchToolDropdownPosition();
  unmountWebSearchToolDropdown();
}

export function renderWebSearchToolSelector() {
  const currentEl = elements.webSearchToolValue;
  const dropdownEl = elements.webSearchToolDropdown;
  const buttonEl = elements.webSearchToolCurrent;
  if (!currentEl || !dropdownEl || !buttonEl) return;

  const toolMode = getCurrentWebSearchToolMode();
  const enabled = isWebSearchEnabled();
  const options = getAvailableWebSearchToolModes();
  currentEl.hidden = false;
  const fullLabel = enabled ? getWebSearchToolModeLabel(toolMode) : "关";
  currentEl.textContent = enabled ? getWebSearchToolButtonLabel(toolMode) : "关";
  currentEl.title = fullLabel;
  dropdownEl.innerHTML = "";
  buttonEl.classList.toggle("is-active", enabled);
  elements.webSearchControl?.classList.toggle("is-active", enabled);
  if (elements.webSearchSwitchText) {
    elements.webSearchSwitchText.textContent = "联网";
  }

  options.forEach((option) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.value = option.value;
    btn.textContent = option.label;
    const isActive = option.value === "off" ? !enabled : enabled && option.value === toolMode;
    btn.classList.toggle("active", isActive);
    btn.addEventListener("click", () => {
      applyWebSearchSelection(option.value);
    });
    dropdownEl.appendChild(btn);
  });

  elements.webSearchControl?.classList.toggle("is-open", !!state.webSearch.selectorOpen);
  buttonEl.setAttribute(
    "aria-expanded",
    state.webSearch.selectorOpen ? "true" : "false"
  );
  if (state.webSearch.selectorOpen) {
    mountWebSearchToolDropdown(dropdownEl);
    positionWebSearchToolSelector();
    window.requestAnimationFrame(() => {
      positionWebSearchToolSelector();
    });
  } else {
    clearWebSearchToolDropdownPosition(dropdownEl);
    unmountWebSearchToolDropdown(dropdownEl);
  }
}

export function toggleWebSearchToolSelector() {
  if (!elements.webSearchToolCurrent) {
    return;
  }
  state.webSearch.selectorOpen = !state.webSearch.selectorOpen;
  renderWebSearchToolSelector();
}

export function setStatusPillState(el, isReady, text) {
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-ready", !!isReady);
  el.classList.toggle("is-pending", !isReady);
}

export function updateConfigStatusStrip() {
  const providerConfig = resolveProviderSelection(
    elements.provider?.value
  );
  const toolMode = getCurrentWebSearchToolMode();
  const webSearchEnabled = isWebSearchEnabled();
  const hasApiKey = !!String(elements.apiKey?.value || "").trim();
  const hasApiUrl = !!String(elements.apiUrl?.value || "").trim();
  const modelName = String(elements.model?.value || "").trim();
  const modelReady = hasApiKey && hasApiUrl && !!modelName;
  const modelText = modelReady
    ? `模型：${providerConfig.label} · ${modelName}`
    : "模型：待完成（需 Key + 地址 + 模型）";
  setStatusPillState(elements.modelStatusPill, modelReady, modelText);

  const maxResults = Math.max(
    1,
    Math.min(20, parseInt(elements.tavilyMaxResults?.value) || 5)
  );
  const depth = normalizeTavilySearchDepth(elements.tavilySearchDepth?.value);
  const exaType = normalizeExaSearchType(elements.exaSearchType?.value);
  const webText = !webSearchEnabled
    ? "联网：关闭"
    : toolMode === "builtin"
      ? "联网：OpenAI Web Search"
      : toolMode === "anthropic_search"
      ? "联网：Anthropic Web Search"
      : toolMode === "gemini_search"
      ? "联网：Google Search"
      : toolMode === "exa"
      ? `联网：Exa · ${exaType} · ${maxResults} 条`
      : `联网：Tavily · ${depth} · ${maxResults} 条`;
  setStatusPillState(elements.webStatusPill, true, webText);
}

export function updateWebSearchProviderUi() {
  disableBuiltinWebSearchWhenUnavailable();
  disableAnthropicWebSearchWhenUnavailable();
  disableGeminiGoogleSearchWhenUnavailable();
  state.webSearch.toolMode = getCurrentWebSearchToolMode();
  const toolMode = state.webSearch.toolMode;
  state.webSearch.enabled = isWebSearchEnabled();
  const externalProvider = normalizeExternalWebSearchProvider(
    elements.webSearchProvider?.value
  );
  const isExa = externalProvider === "exa";
  const isAnthropicSearch = toolMode === "anthropic_search";
  const isGeminiSearch = toolMode === "gemini_search";
  const usesExternalSearch = toolMode === "tavily" || toolMode === "exa";

  renderWebSearchToolSelector();
  if (elements.webSearchProviderGroup) {
    elements.webSearchProviderGroup.style.display = "";
  }
  if (elements.webSearchMaxResultsGroup) {
    elements.webSearchMaxResultsGroup.style.display = usesExternalSearch ? "" : "none";
  }
  if (elements.tavilyApiKeyGroup) {
    elements.tavilyApiKeyGroup.style.display =
      usesExternalSearch && !isExa ? "" : "none";
  }
  if (elements.tavilySearchDepthGroup) {
    elements.tavilySearchDepthGroup.style.display =
      usesExternalSearch && !isExa ? "" : "none";
  }
  if (elements.exaApiKeyGroup) {
    elements.exaApiKeyGroup.style.display = usesExternalSearch && isExa ? "" : "none";
  }
  if (elements.exaSearchTypeGroup) {
    elements.exaSearchTypeGroup.style.display = usesExternalSearch && isExa ? "" : "none";
  }
  updateConfigStatusStrip();
}

export async function tavilySearch(
  query,
  apiKey,
  maxResults = 5,
  searchDepth = "basic"
) {
  if (!isDesktopRuntime() && window.location.protocol === "file:") {
    throw new Error(
      "当前是 file:// 打开页面，无法调用本地接口；请用 python server.py 方式访问 http://localhost:3000"
    );
  }

  const resp = await fetch(buildApiUrl("/api/tavily/search"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: normalizeTavilySearchDepth(searchDepth),
      max_results: Math.max(1, Math.min(20, maxResults || 5)),
      include_answer: true,
      include_raw_content: false,
      include_images: false,
    }),
  });

  if (!resp.ok) {
    let detail = "";
    try {
      const json = await resp.json();
      detail =
        typeof json?.detail === "string" ? json.detail : JSON.stringify(json);
    } catch {
      detail = await resp.text();
    }
    throw new Error(`Tavily HTTP ${resp.status}: ${detail || resp.statusText}`);
  }

  return resp.json();
}
