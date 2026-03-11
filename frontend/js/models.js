import { state, elements, isDesktopRuntime, isDesktopBackendAvailable, getProviderMode, buildApiUrl } from './state.js';
import { openFloatingDropdown, closeFloatingDropdown, closeAllConfigSelectPickers } from './dropdown.js';

/* ---- late-binding stubs (resolved by config.js via setConfigFns) ---- */
let _updateModelNames = () => {};
let _getConfigFromForm = () => ({});

const PRESS_START_EVENT =
  typeof window !== "undefined" && "PointerEvent" in window
    ? "pointerdown"
    : "mousedown";

export function setConfigFns(fns) {
  if (fns.updateModelNames) _updateModelNames = fns.updateModelNames;
  if (fns.getConfigFromForm) _getConfigFromForm = fns.getConfigFromForm;
}

export function setModelHint(side, text) {
  if (side === "Title") return;
  const el = elements.modelHint;
  if (!el) return;
  el.textContent = text || "";
}

export function updateModelHint(side) {
  const config = _getConfigFromForm(side || "main");
  const apiKey = (config.apiKey || "").trim();
  const apiUrl = (config.apiUrl || "").trim();

  if (isDesktopRuntime() && !state.runtime.backendReady) {
    setModelHint(
      side || "main",
      state.runtime.backendFailed
        ? "本地服务启动失败，重试成功后再拉取模型列表"
        : "本地服务启动中，后端就绪后会自动拉取模型列表"
    );
    return;
  }

  if (!apiKey) {
    setModelHint(
      side || "main",
      "先填写 API Key、API 地址，再拉取模型列表"
    );
    return;
  }

  if (!apiUrl) {
    setModelHint(
      side || "main",
      "先填写 API 地址，再拉取模型列表"
    );
    return;
  }

  setModelHint(
    side || "main",
    "填模型ID；可下拉选或手动输入"
  );
}

export function getCachedModelIds(side) {
  const slot = state.modelFetch[side];
  return Array.isArray(slot?.models) ? slot.models : [];
}

export function getModelDropdownLimit(side) {
  const slot = state.modelFetch[side];
  if (!slot) return 120;
  return Math.max(40, Math.min(2000, Number(slot.dropdownLimit) || 120));
}

export function resetModelDropdownLimit(side) {
  const slot = state.modelFetch[side];
  if (!slot) return;
  slot.dropdownLimit = 120;
}

export function increaseModelDropdownLimit(side, delta = 200) {
  const slot = state.modelFetch[side];
  if (!slot) return;
  slot.dropdownLimit =
    getModelDropdownLimit(side) + Math.max(40, Number(delta) || 200);
}

export function isModelDropdownOpen(side) {
  const el = side === "Title" ? elements.modelDropdownTitle : elements.modelDropdown;
  return !!el && !el.hidden;
}

export function setModelDropdownButtonState(side, isOpen) {
  const btn = side === "Title" ? elements.modelDropdownBtnTitle : elements.modelDropdownBtn;
  if (!btn) return;
  btn.classList.toggle("open", !!isOpen);
  btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

export function closeModelDropdown(side) {
  const el = side === "Title" ? elements.modelDropdownTitle : elements.modelDropdown;
  if (!el) return;
  el.onscroll = null;
  el.hidden = true;
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = "";
  closeFloatingDropdown(el);
  setModelDropdownButtonState(side, false);
}

export function renderModelDropdown(side, filterText) {
  const dropdownEl = side === "Title" ? elements.modelDropdownTitle : elements.modelDropdown;
  if (!dropdownEl) return;

  const slot = state.modelFetch[side];
  const isLoading = !!slot?.inFlight;
  const all = getCachedModelIds(side);
  const q = (filterText || "").toString().trim().toLowerCase();
  const models = q ? all.filter((m) => m.toLowerCase().includes(q)) : all;
  const limit = getModelDropdownLimit(side);

  dropdownEl.innerHTML = "";
  if (!models.length) {
    const empty = document.createElement("div");
    empty.className = "model-dropdown-empty";
    empty.textContent = all.length
      ? "无匹配模型，可继续输入"
      : isLoading
      ? "正在获取模型列表…"
      : "暂无模型列表，请先配置Key/地址";
    dropdownEl.appendChild(empty);
    return;
  }

  const shown = models.slice(0, limit);
  for (const id of shown) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "model-dropdown-item";
    btn.textContent = id;
    btn.dataset.value = id;
    btn.addEventListener(PRESS_START_EVENT, (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      const input =
        side === "Title"
          ? elements.titleGenerationModel
          : elements.model;
      if (input) input.value = id;
      if (side !== "Title") _updateModelNames();
      closeModelDropdown(side);
    });
    dropdownEl.appendChild(btn);
  }

  if (models.length > shown.length) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "model-dropdown-item";
    more.style.fontFamily = "inherit";
    more.textContent = `加载更多（已显示 ${shown.length}/${models.length}）`;
    more.addEventListener(PRESS_START_EVENT, (e) => e.preventDefault());
    more.addEventListener("click", () => {
      increaseModelDropdownLimit(side, 240);
      renderModelDropdown(side, filterText);
    });
    dropdownEl.appendChild(more);
  }
}

export function openModelDropdown(side) {
  const dropdownEl = side === "Title" ? elements.modelDropdownTitle : elements.modelDropdown;
  const inputEl =
    side === "Title" ? elements.titleGenerationModel : elements.model;
  if (!dropdownEl || !inputEl) return;

  renderModelDropdown(side, inputEl.value);
  const anchorEl = inputEl.closest?.(".model-picker-row") || inputEl;
  openFloatingDropdown(dropdownEl, anchorEl);
  setModelDropdownButtonState(side, true);

  dropdownEl.onscroll = () => {
    const remaining =
      dropdownEl.scrollHeight - dropdownEl.scrollTop - dropdownEl.clientHeight;
    if (remaining > 40) return;
    const all = getCachedModelIds(side);
    const q = (inputEl.value || "").toString().trim().toLowerCase();
    const models = q ? all.filter((m) => m.toLowerCase().includes(q)) : all;
    if (getModelDropdownLimit(side) >= models.length) return;
    increaseModelDropdownLimit(side, 240);
    renderModelDropdown(side, inputEl.value);
  };
}

export function toggleModelDropdown(side) {
  if (isModelDropdownOpen(side)) closeModelDropdown(side);
  else {
    closeAllConfigSelectPickers();
    openModelDropdown(side);
  }
}

export function updateModelDropdownFilter(side) {
  const dropdownEl = side === "Title" ? elements.modelDropdownTitle : elements.modelDropdown;
  const inputEl =
    side === "Title" ? elements.titleGenerationModel : elements.model;
  if (!dropdownEl || !inputEl) return;

  if (!isModelDropdownOpen(side)) {
    const models = getCachedModelIds(side);
    if (models.length) openModelDropdown(side);
    return;
  }

  resetModelDropdownLimit(side);
  renderModelDropdown(side, inputEl.value);
}

export function normalizeBaseUrlForModels(config) {
  const providerMode = getProviderMode(config);
  let url = (config?.apiUrl || "").trim();
  if (!url) {
    return providerMode === "anthropic"
      ? "https://api.anthropic.com/v1"
      : "https://api.openai.com/v1";
  }
  if (!url.includes("://")) {
    url = `https://${url}`;
  }

  try {
    const u = new URL(url);
    const path = (u.pathname || "").replace(/\/+$/, "");
    const pathLower = path.toLowerCase();
    const v1Index = pathLower.indexOf("/v1");
    let basePath = "";

    if (v1Index >= 0) {
      basePath = path.slice(0, v1Index + 3);
    } else if (pathLower.endsWith("/chat/completions")) {
      basePath = path.slice(0, -"/chat/completions".length);
    } else if (pathLower.endsWith("/messages")) {
      basePath = path.slice(0, -"/messages".length);
    } else if (pathLower.endsWith("/models")) {
      basePath = path.slice(0, -"/models".length);
    } else {
      basePath = path;
    }

    if (!basePath) {
      basePath = "/v1";
    } else if (!basePath.toLowerCase().endsWith("/v1")) {
      basePath = `${basePath}/v1`;
    }

    return `${u.origin}${basePath}`;
  } catch {
    return "";
  }
}

export async function fetchModelsOnce(config) {
  const resp = await fetch(buildApiUrl("/api/models/list"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: config?.provider || "openai",
      apiKey: config?.apiKey || "",
      apiUrl: config?.apiUrl || "",
    }),
  });

  let json = null;
  try {
    json = await resp.json();
  } catch {
    json = null;
  }

  if (!resp.ok) {
    const detail =
      typeof json?.detail === "string" && json.detail
        ? json.detail
        : typeof json?.error === "string" && json.error
        ? json.error
        : resp.statusText;
    throw new Error(
      `获取模型列表失败（${resp.status || 0}）：${detail || "未知错误"}`
    );
  }

  const ids = Array.isArray(json?.models) ? json.models : [];
  if (!ids.length) throw new Error("获取到的模型列表为空");
  return ids;
}

export function scheduleFetchModels(side, delayMs = 400) {
  const slot = state.modelFetch[side];
  if (!slot) return;

  if (slot.timer) clearTimeout(slot.timer);
  if (isDesktopRuntime() && !state.runtime.backendReady) {
    slot.pendingAfterReady = true;
    if (side !== "Title") updateModelHint(side);
    return;
  }
  slot.timer = setTimeout(() => {
    slot.timer = null;
    void fetchAndUpdateModels(side);
  }, Math.max(0, delayMs || 0));
}

export async function fetchAndUpdateModels(side) {
  const slot = state.modelFetch[side];
  if (!slot || slot.inFlight) return;
  if (isDesktopRuntime() && !state.runtime.backendReady) {
    slot.pendingAfterReady = true;
    if (side !== "Title") updateModelHint(side);
    return;
  }

  const config = _getConfigFromForm(side);
  const apiKey = (config.apiKey || "").trim();
  const apiUrl = (config.apiUrl || "").trim();
  if (!apiKey || !apiUrl) {
    slot.models = [];
    closeModelDropdown(side);
    if (side !== "Title") updateModelHint();
    slot.lastKey = "";
    slot.lastFetchedAt = 0;
    return;
  }
  const base = normalizeBaseUrlForModels(config);
  const providerMode = getProviderMode(config);
  const hasKey = !!(config.apiKey || "").trim();
  const fetchKey = `${providerMode}|${base}|${hasKey ? "k" : "-"}`;

  const now = Date.now();
  if (slot.lastKey === fetchKey && now - slot.lastFetchedAt < 60_000) return;

  slot.inFlight = true;
  try {
    const ids = await fetchModelsOnce(config);
    slot.models = ids;
    if (side !== "Title") {
      setModelHint(
        side,
        `已获取 ${ids.length} 个模型ID，可下拉选或手动输入`
      );
    }
    // 只在下拉框已经打开的情况下更新显示，不自动打开
    if (isModelDropdownOpen(side)) {
      const inputEl =
        side === "Title"
          ? elements.titleGenerationModel
          : elements.model;
      renderModelDropdown(side, inputEl?.value || "");
    }
    slot.lastKey = fetchKey;
    slot.lastFetchedAt = now;
  } catch (e) {
    console.warn(`模型列表获取失败:`, e?.message || e);
    slot.models = [];
    closeModelDropdown(side);
    if (side !== "Title") {
      setModelHint(side, "自动获取失败，请手动输入模型ID");
    }
  } finally {
    slot.inFlight = false;
  }
}
