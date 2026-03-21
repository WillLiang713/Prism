import { state, elements, isDesktopRuntime, isDesktopBackendAvailable, getProviderMode, buildApiUrl } from './state.js';
import { openFloatingDropdown, closeFloatingDropdown, closeAllConfigSelectPickers } from './dropdown.js';

/* ---- late-binding stubs (resolved by config.js via setConfigFns) ---- */
let _updateModelNames = () => {};
let _getConfigFromForm = () => ({});
let _autoSaveManagedServiceDraft = async () => false;
let _applyHeaderModelSelection = async () => false;
let _getServiceDisplayName = (service) =>
  String(service?.name || "").trim() || "未命名服务";

const PRESS_START_EVENT =
  typeof window !== "undefined" && "PointerEvent" in window
    ? "pointerdown"
    : "mousedown";

export function setConfigFns(fns) {
  if (fns.updateModelNames) _updateModelNames = fns.updateModelNames;
  if (fns.getConfigFromForm) _getConfigFromForm = fns.getConfigFromForm;
  if (fns.autoSaveManagedServiceDraft) {
    _autoSaveManagedServiceDraft = fns.autoSaveManagedServiceDraft;
  }
  if (fns.applyHeaderModelSelection) {
    _applyHeaderModelSelection = fns.applyHeaderModelSelection;
  }
  if (fns.getServiceDisplayName) {
    _getServiceDisplayName = fns.getServiceDisplayName;
  }
}

export function setModelHint(side, text) {
  const el =
    side === "Title"
      ? elements.titleGenerationModelHint
      : elements.modelHint;
  if (!el) return;
  el.textContent = text || "";
}

export function updateModelHint(side) {
  const resolvedSide = side || "main";
  const slot = state.modelFetch[resolvedSide];
  const config = _getConfigFromForm(resolvedSide);
  const hasApiKey = !!String(config.apiKey || "").trim();
  const apiUrl = (config.apiUrl || "").trim();

  if (isDesktopRuntime() && !state.runtime.backendReady) {
    setModelHint(resolvedSide, "");
    return;
  }

  if (!hasApiKey) {
    setModelHint(
      resolvedSide,
      "先填写 API Key、API 地址，再拉取模型列表"
    );
    return;
  }

  if (!apiUrl) {
    setModelHint(
      resolvedSide,
      "先填写 API 地址，再拉取模型列表"
    );
    return;
  }

  const base = normalizeBaseUrlForModels(config);
  const providerMode = getProviderMode(config);
  const fetchKey = `${providerMode}|${base}|k`;
  if (
    Array.isArray(slot?.models) &&
    slot.models.length &&
    slot.lastKey === fetchKey
  ) {
    setModelHint(
      resolvedSide,
      resolvedSide === "Title"
        ? `已获取 ${slot.models.length} 个模型ID，可下拉选或手动输入`
        : `已获取 ${slot.models.length} 个模型ID，可下拉选或手动输入`
    );
    return;
  }

  setModelHint(
    resolvedSide,
    resolvedSide === "Title"
      ? "可独立指定；也可留空跟随主模型"
      : "填模型ID；可下拉选或手动输入"
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

export function resetModelFetchState(side, options = {}) {
  const slot = state.modelFetch[side];
  if (!slot) return;
  if (slot.timer) {
    clearTimeout(slot.timer);
    slot.timer = null;
  }
  slot.datalistFillToken += 1;
  slot.inFlight = false;
  slot.lastKey = "";
  slot.lastFetchedAt = 0;
  slot.models = [];
  slot.dropdownQuery = null;
  slot.pendingAfterReady = false;
  slot.dropdownLimit = 120;
  if (options.closeDropdown !== false) {
    closeModelDropdown(side);
  }
}

function createHeaderModelFetchSlot() {
  return {
    inFlight: false,
    lastKey: "",
    lastFetchedAt: 0,
    models: [],
    error: "",
    requestToken: 0,
  };
}

function getHeaderModelFetchSlot(serviceId) {
  const resolvedId = String(serviceId || "");
  if (!resolvedId) {
    return createHeaderModelFetchSlot();
  }
  let slot = state.headerModelFetchSlots.get(resolvedId);
  if (!slot) {
    slot = createHeaderModelFetchSlot();
    state.headerModelFetchSlots.set(resolvedId, slot);
  }
  return slot;
}

function pruneHeaderModelFetchSlots() {
  const serviceIds = new Set(
    state.services.map((service) => String(service?.id || "")).filter(Boolean)
  );
  for (const serviceId of state.headerModelFetchSlots.keys()) {
    if (!serviceIds.has(serviceId)) {
      state.headerModelFetchSlots.delete(serviceId);
    }
  }
}

function getServiceModelFetchConfig(service) {
  return {
    provider: service?.model?.provider || "openai",
    endpointMode: service?.model?.endpointMode || "chat_completions",
    apiKey: String(service?.model?.apiKey || "").trim(),
    apiUrl: String(service?.model?.apiUrl || "").trim(),
  };
}

function canFetchServiceModels(service) {
  const config = getServiceModelFetchConfig(service);
  return !!config.apiKey && !!config.apiUrl;
}

function getHeaderServiceFetchKey(service) {
  const config = getServiceModelFetchConfig(service);
  if (!config.apiKey || !config.apiUrl) return "";
  const base = normalizeBaseUrlForModels(config);
  const providerMode = getProviderMode(config);
  return `${providerMode}|${base}|k`;
}

function syncHeaderSlotFromMainModelCache() {
  const activeService = state.services.find(
    (service) => service.id === state.activeServiceId
  );
  if (!activeService) return;
  const headerSlot = getHeaderModelFetchSlot(activeService.id);
  const mainSlot = state.modelFetch.main;
  const fetchKey = getHeaderServiceFetchKey(activeService);
  if (!fetchKey || mainSlot.lastKey !== fetchKey) return;
  if (!Array.isArray(mainSlot.models) || !mainSlot.models.length) return;
  headerSlot.models = [...mainSlot.models];
  headerSlot.lastKey = fetchKey;
  headerSlot.lastFetchedAt = mainSlot.lastFetchedAt;
  headerSlot.error = "";
}

function getHeaderConfiguredServices() {
  pruneHeaderModelFetchSlots();
  syncHeaderSlotFromMainModelCache();
  return state.services.filter((service) => canFetchServiceModels(service));
}

async function fetchHeaderModelsForService(service, options = {}) {
  const force = options.force === true;
  const slot = getHeaderModelFetchSlot(service?.id);
  const config = getServiceModelFetchConfig(service);
  if (!config.apiKey || !config.apiUrl) {
    slot.models = [];
    slot.error = "";
    slot.lastKey = "";
    slot.lastFetchedAt = 0;
    if (isHeaderModelDropdownOpen()) {
      renderHeaderModelDropdown();
    }
    return [];
  }

  const fetchKey = getHeaderServiceFetchKey(service);
  const now = Date.now();
  if (
    !force &&
    slot.lastKey === fetchKey &&
    slot.models.length &&
    now - slot.lastFetchedAt < 60_000
  ) {
    return slot.models;
  }
  if (slot.inFlight) {
    return slot.models;
  }

  slot.requestToken += 1;
  const requestToken = slot.requestToken;
  slot.inFlight = true;
  slot.error = "";
  if (isHeaderModelDropdownOpen()) {
    renderHeaderModelDropdown();
  }

  try {
    const ids = await fetchModelsOnce(config);
    if (slot.requestToken !== requestToken) {
      return slot.models;
    }
    slot.models = ids;
    slot.error = "";
    slot.lastKey = fetchKey;
    slot.lastFetchedAt = Date.now();
  } catch (error) {
    if (slot.requestToken !== requestToken) {
      return slot.models;
    }
    slot.error = error?.message || "获取模型列表失败";
    slot.lastKey = fetchKey;
    slot.lastFetchedAt = Date.now();
  } finally {
    if (slot.requestToken === requestToken) {
      slot.inFlight = false;
    }
    if (isHeaderModelDropdownOpen()) {
      renderHeaderModelDropdown();
    }
  }

  return slot.models;
}

function prefetchHeaderModels() {
  const services = getHeaderConfiguredServices();
  for (const service of services) {
    void fetchHeaderModelsForService(service);
  }
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
  const slot = state.modelFetch[side];
  if (!el) return;
  el.onscroll = null;
  el.hidden = true;
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = "";
  if (slot) slot.dropdownQuery = null;
  closeFloatingDropdown(el);
  setModelDropdownButtonState(side, false);
}

export function isHeaderModelDropdownOpen() {
  return !!elements.headerModelDropdown && !elements.headerModelDropdown.hidden;
}

export function setHeaderModelDropdownButtonState(isOpen) {
  const btn = elements.headerModelTrigger;
  if (!btn) return;
  btn.classList.toggle("open", !!isOpen);
  btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

export function closeHeaderModelDropdown() {
  const dropdownEl = elements.headerModelDropdown;
  if (!dropdownEl) return;
  dropdownEl.hidden = true;
  dropdownEl.setAttribute("aria-hidden", "true");
  dropdownEl.innerHTML = "";
  closeFloatingDropdown(dropdownEl);
  setHeaderModelDropdownButtonState(false);
}

function createHeaderGroupStatusText(slot) {
  if (slot?.inFlight) return "加载中";
  if (slot?.error && !slot?.models?.length) return "获取失败";
  if (!slot?.models?.length) return "暂无模型";
  return `${slot.models.length} 个模型`;
}

export function renderHeaderModelDropdown() {
  const dropdownEl = elements.headerModelDropdown;
  if (!dropdownEl) return;

  dropdownEl.innerHTML = "";
  const services = getHeaderConfiguredServices();
  if (!services.length) {
    const empty = document.createElement("div");
    empty.className = "model-dropdown-empty";
    empty.textContent = "暂无可用服务，请先在配置中心配置可连接的服务";
    dropdownEl.appendChild(empty);
    return;
  }

  const activeServiceId = String(state.activeServiceId || "");
  const activeModelId =
    String(elements.model?.value || "").trim() ||
    String(
      state.services.find((service) => service.id === activeServiceId)?.model?.model || ""
    ).trim();

  for (const service of services) {
    const slot = getHeaderModelFetchSlot(service.id);
    const section = document.createElement("section");
    section.className = "header-model-group";
    section.dataset.serviceId = service.id;

    const heading = document.createElement("div");
    heading.className = "header-model-group-heading";

    const title = document.createElement("span");
    title.className = "header-model-group-title";
    title.textContent = _getServiceDisplayName(service);
    heading.appendChild(title);

    const meta = document.createElement("span");
    meta.className = "header-model-group-meta";
    meta.textContent = createHeaderGroupStatusText(slot);
    heading.appendChild(meta);

    if (service.id === activeServiceId) {
      section.classList.add("is-active-service");
    }

    section.appendChild(heading);

    if (!slot.models.length) {
      const empty = document.createElement("div");
      empty.className = "header-model-group-empty";
      empty.textContent = slot.inFlight
        ? "正在获取模型列表…"
        : slot.error || "当前服务还没有可选模型";
      section.appendChild(empty);
      dropdownEl.appendChild(section);
      continue;
    }

    for (const id of slot.models) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "model-dropdown-item";
      if (service.id === activeServiceId && id === activeModelId) {
        btn.classList.add("is-active");
        btn.setAttribute("aria-selected", "true");
      }
      btn.dataset.value = id;
      btn.dataset.serviceId = service.id;
      btn.textContent = id;
      btn.addEventListener(PRESS_START_EVENT, (e) => e.preventDefault());
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const applied = await _applyHeaderModelSelection(service.id, id);
        if (applied) {
          closeHeaderModelDropdown();
          return;
        }
        btn.disabled = false;
      });
      section.appendChild(btn);
    }

    dropdownEl.appendChild(section);
  }
}

export function openHeaderModelDropdown() {
  const dropdownEl = elements.headerModelDropdown;
  const triggerEl = elements.headerModelTrigger;
  if (!dropdownEl || !triggerEl) return;

  closeModelDropdown("main");
  closeModelDropdown("Title");
  closeAllConfigSelectPickers();
  prefetchHeaderModels();
  renderHeaderModelDropdown();
  openFloatingDropdown(dropdownEl, triggerEl, { host: document.body });
  setHeaderModelDropdownButtonState(true);
}

export function toggleHeaderModelDropdown() {
  if (isHeaderModelDropdownOpen()) {
    closeHeaderModelDropdown();
    return;
  }
  openHeaderModelDropdown();
}

export function getModelDropdownQuery(side, fallback = "") {
  const slot = state.modelFetch[side];
  if (!slot) return (fallback || "").toString();
  return slot.dropdownQuery == null ? null : String(slot.dropdownQuery || fallback || "");
}

export function setModelDropdownQuery(side, query) {
  const slot = state.modelFetch[side];
  if (!slot) return;
  slot.dropdownQuery = query == null ? null : String(query || "");
}

export function renderModelDropdown(side, filterText = null) {
  const dropdownEl = side === "Title" ? elements.modelDropdownTitle : elements.modelDropdown;
  if (!dropdownEl) return;

  const slot = state.modelFetch[side];
  const isLoading = !!slot?.inFlight;
  const all = getCachedModelIds(side);
  const q = filterText == null
    ? ""
    : String(filterText || "").trim().toLowerCase();
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
      if (input) {
        input.value = id;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (side !== "Title") _updateModelNames();
      closeModelDropdown(side);
      void _autoSaveManagedServiceDraft();
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

  setModelDropdownQuery(side, null);
  renderModelDropdown(side, null);
  const anchorEl = inputEl.closest?.(".model-picker-row") || inputEl;
  openFloatingDropdown(dropdownEl, anchorEl);
  setModelDropdownButtonState(side, true);

  dropdownEl.onscroll = () => {
    const remaining =
      dropdownEl.scrollHeight - dropdownEl.scrollTop - dropdownEl.clientHeight;
    if (remaining > 40) return;
    const all = getCachedModelIds(side);
    const activeQuery = getModelDropdownQuery(side, inputEl.value);
    const q = (activeQuery || "").toString().trim().toLowerCase();
    const models = q ? all.filter((m) => m.toLowerCase().includes(q)) : all;
    if (getModelDropdownLimit(side) >= models.length) return;
    increaseModelDropdownLimit(side, 240);
    renderModelDropdown(side, activeQuery);
  };
}

export function toggleModelDropdown(side) {
  if (isModelDropdownOpen(side)) closeModelDropdown(side);
  else {
    closeModelDropdown(side === "Title" ? "main" : "Title");
    closeAllConfigSelectPickers();
    openModelDropdown(side);
  }
}

export function updateModelDropdownFilter(side) {
  if (side !== "Title" && !elements.modelDropdownBtn) {
    return;
  }
  const dropdownEl = side === "Title" ? elements.modelDropdownTitle : elements.modelDropdown;
  const inputEl =
    side === "Title" ? elements.titleGenerationModel : elements.model;
  if (!dropdownEl || !inputEl) return;

  const nextQuery = inputEl.value || "";
  setModelDropdownQuery(side, nextQuery);

  if (side === "Title" && !nextQuery.trim()) {
    closeModelDropdown(side);
    return;
  }

  if (!isModelDropdownOpen(side)) {
    if (side === "Title") {
      return;
    }
    const models = getCachedModelIds(side);
    if (models.length) {
      resetModelDropdownLimit(side);
      renderModelDropdown(side, nextQuery);
      const anchorEl = inputEl.closest?.(".model-picker-row") || inputEl;
      openFloatingDropdown(dropdownEl, anchorEl);
      setModelDropdownButtonState(side, true);
    }
    return;
  }

  resetModelDropdownLimit(side);
  renderModelDropdown(side, nextQuery);
}

export function normalizeBaseUrlForModels(config) {
  const providerMode = getProviderMode(config);
  let url = (config?.apiUrl || "").trim();
  if (!url) {
    if (providerMode === "gemini") {
      return "https://generativelanguage.googleapis.com/v1beta";
    }
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

    if (providerMode === "gemini") {
      const modelsIndex = pathLower.indexOf("/models/");
      if (modelsIndex >= 0) {
        basePath = path.slice(0, modelsIndex);
      } else if (pathLower.endsWith("/models")) {
        basePath = path.slice(0, -"/models".length);
      } else if (pathLower.includes(":generatecontent")) {
        basePath = path.split(":", 1)[0];
        if (basePath.toLowerCase().includes("/models/")) {
          basePath = basePath.slice(0, basePath.toLowerCase().indexOf("/models/"));
        }
      } else {
        basePath = path;
      }
    } else if (v1Index >= 0) {
      basePath = path.slice(0, v1Index + 3);
    } else if (pathLower.endsWith("/chat/completions")) {
      basePath = path.slice(0, -"/chat/completions".length);
    } else if (pathLower.endsWith("/responses")) {
      basePath = path.slice(0, -"/responses".length);
    } else if (pathLower.endsWith("/messages")) {
      basePath = path.slice(0, -"/messages".length);
    } else if (pathLower.endsWith("/models")) {
      basePath = path.slice(0, -"/models".length);
    } else {
      basePath = path;
    }

    if (!basePath) {
      basePath = providerMode === "gemini" ? "/v1beta" : "/v1";
    } else if (
      providerMode === "gemini" &&
      !basePath.toLowerCase().endsWith("/v1beta") &&
      !basePath.toLowerCase().endsWith("/v1")
    ) {
      basePath = `${basePath}/v1beta`;
    } else if (providerMode !== "gemini" && !basePath.toLowerCase().endsWith("/v1")) {
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
    if (side === "main" && isHeaderModelDropdownOpen()) {
      syncHeaderSlotFromMainModelCache();
      renderHeaderModelDropdown();
    }
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

  const requestToken = slot.datalistFillToken;
  slot.inFlight = true;
  if (side === "main" && isHeaderModelDropdownOpen()) {
    renderHeaderModelDropdown();
  }
  try {
    const ids = await fetchModelsOnce(config);
    if (slot.datalistFillToken !== requestToken) {
      return;
    }
    slot.models = ids;
    if (side === "main") {
      syncHeaderSlotFromMainModelCache();
    }
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
      renderModelDropdown(side, getModelDropdownQuery(side, inputEl?.value || ""));
    }
    if (side === "main" && isHeaderModelDropdownOpen()) {
      renderHeaderModelDropdown();
    }
    slot.lastKey = fetchKey;
    slot.lastFetchedAt = now;
  } catch (e) {
    if (slot.datalistFillToken !== requestToken) {
      return;
    }
    console.warn(`模型列表获取失败:`, e?.message || e);
    slot.models = [];
    closeModelDropdown(side);
    if (side === "main" && isHeaderModelDropdownOpen()) {
      syncHeaderSlotFromMainModelCache();
      renderHeaderModelDropdown();
    }
    if (side !== "Title") {
      setModelHint(side, "自动获取失败，请手动输入模型ID");
    }
  } finally {
    if (slot.datalistFillToken === requestToken) {
      slot.inFlight = false;
    }
  }
}
