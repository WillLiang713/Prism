import { state, elements, truncateText, buildApiUrl, isDesktopRuntime } from './state.js';

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

  const name = (event.name || "未知工具").trim();
  const status = event.status || "info";
  const rawArgs = event.arguments;
  const args = rawArgs && typeof rawArgs === "object"
    ? JSON.stringify(rawArgs, null, 0)
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

export function renderToolEvents(sectionEl, listEl, events) {
  if (!sectionEl || !listEl) return;
  const items = Array.isArray(events) ? events : [];

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
      <span class="tool-calls-header-text"></span>
      <svg class="tool-calls-header-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>`;

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

function getUniqueSourceHosts(items) {
  const hosts = [];
  const seen = new Set();
  items.forEach((item) => {
    const hostname = getSourceHostname(item.url);
    if (!hostname || seen.has(hostname)) return;
    seen.add(hostname);
    hosts.push(hostname);
  });
  return hosts;
}

export function renderSourcesStatus(statusEl, sources) {
  if (!statusEl) return;
  const items = getSourceItems(sources);
  if (!items.length) {
    statusEl.hidden = true;
    statusEl.innerHTML = "";
    return;
  }

  const hosts = getUniqueSourceHosts(items);
  const visibleHosts = hosts.slice(0, 3);

  statusEl.hidden = false;
  statusEl.innerHTML = "";

  const text = document.createElement("span");
  text.className = "sources-status-text";
  text.textContent = `已核对 ${items.length} 个来源`;
  statusEl.appendChild(text);

  visibleHosts.forEach((host) => {
    const chip = document.createElement("span");
    chip.className = "sources-status-chip";
    chip.textContent = host;
    statusEl.appendChild(chip);
  });

  if (hosts.length > visibleHosts.length) {
    const more = document.createElement("span");
    more.className = "sources-status-more";
    more.textContent = `+${hosts.length - visibleHosts.length}`;
    statusEl.appendChild(more);
  }
}

export function renderSourcesToggle(buttonEl, sources) {
  if (!buttonEl) return;
  const items = getSourceItems(sources);
  if (!items.length) {
    buttonEl.hidden = true;
    buttonEl.textContent = "来源";
    buttonEl.setAttribute("aria-label", "暂无来源");
    buttonEl.setAttribute("title", "暂无来源");
    return;
  }

  buttonEl.hidden = false;
  buttonEl.textContent = `来源 ${items.length}`;
  buttonEl.setAttribute("aria-label", `查看 ${items.length} 个来源`);
  buttonEl.setAttribute("title", `查看 ${items.length} 个来源`);
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

  const title = document.createElement("div");
  title.className = "sources-title";
  title.textContent = `来源 · ${items.length}`;
  sectionEl.appendChild(title);

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
  return String(value || "").toLowerCase() === "exa" ? "exa" : "tavily";
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

export function setStatusPillState(el, isReady, text) {
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-ready", !!isReady);
  el.classList.toggle("is-pending", !isReady);
}

export function updateConfigStatusStrip() {
  const hasApiKey = !!(elements.apiKey?.value || "").trim();
  const hasApiUrl = !!(elements.apiUrl?.value || "").trim();
  const modelName = (elements.model?.value || "").trim();
  const provider = elements.provider?.value === "anthropic" ? "Anthropic" : "OpenAI";
  const modelReady = hasApiKey && hasApiUrl && !!modelName;
  const modelText = modelReady
    ? `模型：${provider} · ${modelName}`
    : "模型：待完成（需 Key + 地址 + 模型）";
  setStatusPillState(elements.modelStatusPill, modelReady, modelText);

  const webProvider = normalizeWebSearchProvider(elements.webSearchProvider?.value);
  const maxResults = Math.max(
    1,
    Math.min(20, parseInt(elements.tavilyMaxResults?.value) || 5)
  );
  const depth = normalizeTavilySearchDepth(elements.tavilySearchDepth?.value);
  const exaType = normalizeExaSearchType(elements.exaSearchType?.value);
  const webText =
    webProvider === "exa"
      ? `联网：Exa · ${exaType} · ${maxResults} 条`
      : `联网：Tavily · ${depth} · ${maxResults} 条`;
  setStatusPillState(elements.webStatusPill, true, webText);
}

export function updateWebSearchProviderUi() {
  const provider = normalizeWebSearchProvider(elements.webSearchProvider?.value);
  const isExa = provider === "exa";

  if (elements.tavilyApiKeyGroup) {
    elements.tavilyApiKeyGroup.style.display = isExa ? "none" : "";
  }
  if (elements.tavilySearchDepthGroup) {
    elements.tavilySearchDepthGroup.style.display = isExa ? "none" : "";
  }
  if (elements.exaApiKeyGroup) {
    elements.exaApiKeyGroup.style.display = isExa ? "" : "none";
  }
  if (elements.exaSearchTypeGroup) {
    elements.exaSearchTypeGroup.style.display = isExa ? "" : "none";
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
