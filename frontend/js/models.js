import { state, elements, isDesktopRuntime, isDesktopBackendAvailable, getProviderMode, buildApiUrl } from './state.js';
import { t } from './i18n.js';
import { openFloatingDropdown, closeFloatingDropdown, closeAllConfigSelectPickers, positionFloatingDropdown } from './dropdown.js';

/* ---- late-binding stubs (resolved by config.js via setConfigFns) ---- */
let _updateModelNames = () => {};
let _getConfigFromForm = () => ({});
let _getRuntimeModelConfig = () => ({});
let _autoSaveManagedServiceDraft = async () => false;
let _applyHeaderModelSelection = async () => false;
let _getServiceDisplayName = (service) =>
  String(service?.name || "").trim() || t("新服务");

const PRESS_START_EVENT =
  typeof window !== "undefined" && "PointerEvent" in window
    ? "pointerdown"
    : "mousedown";

const DEFAULT_TITLE_MODEL_PLACEHOLDER = "点击选择模型";

export function setConfigFns(fns) {
  if (fns.updateModelNames) _updateModelNames = fns.updateModelNames;
  if (fns.getConfigFromForm) _getConfigFromForm = fns.getConfigFromForm;
  if (fns.getRuntimeModelConfig) _getRuntimeModelConfig = fns.getRuntimeModelConfig;
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

function getTitleFollowDisplayText() {
  const runtimeConfig = _getRuntimeModelConfig(true) || {};
  const mainModel = String(runtimeConfig.model || "").trim();
  const mainServiceId = String(runtimeConfig.modelServiceId || "").trim();
  const sourceService = state.services.find(
    (service) => String(service?.id || "").trim() === mainServiceId
  );
  const serviceName = sourceService ? _getServiceDisplayName(sourceService) : "";

  if (!mainModel) {
    return t("当前主模型未设置");
  }

  return mainModel;
}

export function syncTitleModelFollowPresentation() {
  const inputEl = elements.titleGenerationModel;
  if (!inputEl) return;

  const runtimeConfig = _getRuntimeModelConfig(true) || {};
  const explicitTitleModel = String(runtimeConfig.titleModel || "").trim();
  const isFollowingMainModel = !explicitTitleModel;
  const displayText = isFollowingMainModel
    ? getTitleFollowDisplayText()
    : t(DEFAULT_TITLE_MODEL_PLACEHOLDER);

  if (isFollowingMainModel) {
    inputEl.dataset.followMode = "main";
  } else {
    delete inputEl.dataset.followMode;
  }

  if (!String(inputEl.value || "").trim()) {
    inputEl.placeholder = displayText;
  }
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
      t("先填写 API Key、API 地址，再拉取模型列表")
    );
    return;
  }

  if (!apiUrl) {
    setModelHint(
      resolvedSide,
      t("先填写 API 地址，再拉取模型列表")
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
        ? t("已获取 {count} 个模型ID，可点击选择或跟随主模型", {
            count: slot.models.length,
          })
        : t("已获取 {count} 个模型ID，可下拉选或手动输入", {
            count: slot.models.length,
          })
    );
    return;
  }

  setModelHint(
    resolvedSide,
    resolvedSide === "Title"
      ? t("可点击选择标题模型，也可选择“跟随主模型”")
      : t("填模型ID；可下拉选或手动输入")
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
  const serviceId = String(service?.id || "");
  const isEditingManagedService =
    !!serviceId &&
    serviceId === String(state.serviceManagerSelectedId || "") &&
    elements.configModal?.classList.contains("open");
  if (isEditingManagedService) {
    const liveConfig = _getConfigFromForm("main");
    return {
      provider: liveConfig?.provider || service?.model?.provider || "openai",
      endpointMode:
        liveConfig?.endpointMode ||
        service?.model?.endpointMode ||
        "chat_completions",
      apiKey: String(liveConfig?.apiKey || "").trim(),
      apiUrl: String(liveConfig?.apiUrl || "").trim(),
    };
  }
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

function syncHeaderSlotFromSideModelCache(serviceId, side) {
  const resolvedId = String(serviceId || "");
  const sideSlot = state.modelFetch[side];
  const service = state.services.find((item) => item.id === resolvedId);
  if (!resolvedId || !sideSlot || !service) return;
  const headerSlot = getHeaderModelFetchSlot(resolvedId);
  const fetchKey = getHeaderServiceFetchKey(service);
  if (!fetchKey || sideSlot.lastKey !== fetchKey) return;
  if (!Array.isArray(sideSlot.models) || !sideSlot.models.length) return;
  headerSlot.models = [...sideSlot.models];
  headerSlot.lastKey = fetchKey;
  headerSlot.lastFetchedAt = sideSlot.lastFetchedAt;
  headerSlot.error = "";
}

function getHeaderServices() {
  pruneHeaderModelFetchSlots();
  return Array.isArray(state.services) ? state.services.filter(Boolean) : [];
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
    const { ids } = await fetchModelsOnce(config);
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
    slot.error = error?.message || t("获取模型列表失败");
    slot.lastKey = fetchKey;
    slot.lastFetchedAt = Date.now();
  } finally {
    if (slot.requestToken === requestToken) {
      slot.inFlight = false;
    }
    if (isModelDropdownOpen("main")) {
      renderModelDropdown(
        "main",
        getModelDropdownQuery("main", elements.model?.value || "")
      );
    }
    if (isModelDropdownOpen("Title")) {
      renderModelDropdown(
        "Title",
        getModelDropdownQuery("Title", elements.titleGenerationModel?.value || "")
      );
    }
    if (isHeaderModelDropdownOpen()) {
      renderHeaderModelDropdown();
    }
  }

  return slot.models;
}

function prefetchAllServiceModels(options = {}) {
  const services = getHeaderServices().filter((service) => canFetchServiceModels(service));
  for (const service of services) {
    void fetchHeaderModelsForService(service, options);
  }
}

function getCurrentProfileServiceId() {
  const preferredId = state.serviceManagerSelectedId;
  return String(
    preferredId || state.services[0]?.id || ""
  ).trim();
}

function getCurrentBoundServiceId(side) {
  const inputEl = side === "Title" ? elements.titleGenerationModel : elements.model;
  const rawId = String(inputEl?.dataset?.serviceId || "").trim();
  if (rawId) return rawId;
  if (side === "Title" && !String(inputEl?.value || "").trim()) {
    return "";
  }
  return getCurrentProfileServiceId();
}

function getAggregatedModelOptions() {
  const options = [];
  for (const service of getHeaderServices()) {
    const serviceId = String(service?.id || "");
    const serviceName = _getServiceDisplayName(service);
    const slot = getHeaderModelFetchSlot(serviceId);
    for (const modelId of Array.isArray(slot.models) ? slot.models : []) {
      options.push({
        serviceId,
        serviceName,
        modelId,
        searchText: `${serviceName} ${modelId}`.toLowerCase(),
      });
    }
  }
  return options;
}

function getFilteredModelOptions(filterText = "") {
  const q = String(filterText || "").trim().toLowerCase();
  const all = getAggregatedModelOptions();
  if (!q) return all;
  return all.filter((option) => option.searchText.includes(q));
}

function hasAnyServiceModelFetchInFlight() {
  for (const service of getHeaderServices()) {
    if (getHeaderModelFetchSlot(service.id)?.inFlight) {
      return true;
    }
  }
  return false;
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
  if (slot?.inFlight) return t("加载中");
  if (slot?.error && !slot?.models?.length) return t("获取模型列表失败");
  if (!slot?.models?.length) return t("暂无模型");
  return t("{count} 个模型", { count: slot.models.length });
}

export function renderHeaderModelDropdown() {
  const dropdownEl = elements.headerModelDropdown;
  if (!dropdownEl) return;

  dropdownEl.innerHTML = "";
  const services = getHeaderServices();
  if (!services.length) {
    const empty = document.createElement("div");
    empty.className = "model-dropdown-empty";
    empty.textContent = t("暂无可用服务，请先在设置中添加服务");
    dropdownEl.appendChild(empty);
    return;
  }

  const runtimeConfig = _getRuntimeModelConfig();
  const activeModelId = String(runtimeConfig?.model || "").trim();
  const activeModelServiceId = activeModelId
    ? String(runtimeConfig?.modelServiceId || "").trim()
    : "";

  const hasAnyOptions = getAggregatedModelOptions().length > 0;
  if (!hasAnyOptions && !hasAnyServiceModelFetchInFlight()) {
    const empty = document.createElement("div");
    empty.className = "header-model-empty";
    empty.textContent = t("暂无可选模型，请先配置至少一个可拉取模型的连接");
    dropdownEl.appendChild(empty);
    return;
  }

  for (const service of services) {
    const slot = getHeaderModelFetchSlot(service.id);
    const group = document.createElement("div");
    group.className = "header-model-group";
    if (String(service.id || "") === activeModelServiceId) {
      group.classList.add("is-active-service");
    }

    const groupHead = document.createElement("div");
    groupHead.className = "header-model-summary";

    const groupTitle = document.createElement("span");
    groupTitle.className = "header-model-summary-title";
    groupTitle.textContent = _getServiceDisplayName(service);
    groupHead.appendChild(groupTitle);

    const groupMeta = document.createElement("span");
    groupMeta.className = "header-model-summary-meta";
    groupMeta.textContent = canFetchServiceModels(service)
      ? createHeaderGroupStatusText(slot)
      : t("未配置");
    groupHead.appendChild(groupMeta);
    group.appendChild(groupHead);

    if (!canFetchServiceModels(service)) {
      const empty = document.createElement("div");
      empty.className = "header-model-empty";
      empty.textContent = t("未配置 API Key 或 API 地址");
      group.appendChild(empty);
      dropdownEl.appendChild(group);
      continue;
    }

    if (!slot.models.length) {
      const empty = document.createElement("div");
      empty.className = "header-model-empty";
      empty.textContent = slot.inFlight
        ? t("正在获取模型列表…")
        : slot.error || t("当前连接还没有可选模型");
      group.appendChild(empty);
      dropdownEl.appendChild(group);
      continue;
    }

    const filteredModels = slot.models;
    if (!filteredModels.length) {
      const empty = document.createElement("div");
      empty.className = "header-model-empty";
      empty.textContent = t("当前连接还没有可选模型");
      group.appendChild(empty);
      dropdownEl.appendChild(group);
      continue;
    }

    for (const modelId of filteredModels) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "model-dropdown-item";
      if (modelId === activeModelId && String(service.id || "") === activeModelServiceId) {
        btn.classList.add("is-active");
        btn.setAttribute("aria-selected", "true");
      }
      btn.dataset.value = modelId;
      btn.dataset.serviceId = service.id;
      btn.textContent = modelId;
      btn.addEventListener(PRESS_START_EVENT, (e) => e.preventDefault());
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const applied = await _applyHeaderModelSelection(service.id, modelId);
        if (applied) {
          closeHeaderModelDropdown();
          return;
        }
        btn.disabled = false;
      });
      group.appendChild(btn);
    }

    dropdownEl.appendChild(group);
  }

  if (dropdownEl.classList.contains("is-floating-dropdown")) {
    positionFloatingDropdown(dropdownEl);
  }
}

export function openHeaderModelDropdown() {
  const dropdownEl = elements.headerModelDropdown;
  const triggerEl = elements.headerModelTrigger;
  if (!dropdownEl || !triggerEl) return;

  closeModelDropdown("main");
  closeModelDropdown("Title");
  closeAllConfigSelectPickers();
  prefetchAllServiceModels();
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

function renderTitleGroupedModelDropdown({
  dropdownEl,
  inputEl,
  currentValue,
  currentServiceId,
}) {
  dropdownEl.classList.add("header-model-dropdown");
  dropdownEl.innerHTML = "";

  const followBtn = document.createElement("button");
  followBtn.type = "button";
  followBtn.className = "model-dropdown-item";
  followBtn.textContent = t("跟随主模型");
  followBtn.dataset.value = "";
  if (!currentValue) {
    followBtn.classList.add("is-active");
    followBtn.setAttribute("aria-selected", "true");
  }
  followBtn.addEventListener(PRESS_START_EVENT, (e) => e.preventDefault());
  followBtn.addEventListener("click", () => {
    if (inputEl) {
      inputEl.value = "";
      delete inputEl.dataset.serviceId;
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
    closeModelDropdown("Title");
    void _autoSaveManagedServiceDraft();
  });
  dropdownEl.appendChild(followBtn);

  const services = getHeaderServices();
  const hasAnyOptions = getAggregatedModelOptions().length > 0;

  if (!services.length) {
    const empty = document.createElement("div");
    empty.className = "model-dropdown-empty";
    empty.textContent = t("暂无可用服务，请先在设置中添加服务");
    dropdownEl.appendChild(empty);
    return;
  }

  if (!hasAnyOptions && !hasAnyServiceModelFetchInFlight()) {
    const empty = document.createElement("div");
    empty.className = "header-model-empty";
    empty.textContent = t("暂无可选模型，请先配置至少一个可拉取模型的连接");
    dropdownEl.appendChild(empty);
    return;
  }

  for (const service of services) {
    const slot = getHeaderModelFetchSlot(service.id);
    const group = document.createElement("div");
    group.className = "header-model-group";

    const groupHead = document.createElement("div");
    groupHead.className = "header-model-summary";

    const groupTitle = document.createElement("span");
    groupTitle.className = "header-model-summary-title";
    groupTitle.textContent = _getServiceDisplayName(service);
    groupHead.appendChild(groupTitle);

    const groupMeta = document.createElement("span");
    groupMeta.className = "header-model-summary-meta";
    groupMeta.textContent = canFetchServiceModels(service)
      ? createHeaderGroupStatusText(slot)
      : t("未配置");
    groupHead.appendChild(groupMeta);
    group.appendChild(groupHead);

    if (!canFetchServiceModels(service)) {
      const empty = document.createElement("div");
      empty.className = "header-model-empty";
      empty.textContent = t("未配置 API Key 或 API 地址");
      group.appendChild(empty);
      dropdownEl.appendChild(group);
      continue;
    }

    if (!slot.models.length) {
      const empty = document.createElement("div");
      empty.className = "header-model-empty";
      empty.textContent = slot.inFlight
        ? t("正在获取模型列表…")
        : slot.error || t("当前连接还没有可选模型");
      group.appendChild(empty);
      dropdownEl.appendChild(group);
      continue;
    }

    const filteredModels = slot.models;
    if (!filteredModels.length) {
      const empty = document.createElement("div");
      empty.className = "header-model-empty";
      empty.textContent = t("当前连接还没有可选模型");
      group.appendChild(empty);
      dropdownEl.appendChild(group);
      continue;
    }

    for (const modelId of filteredModels) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "model-dropdown-item";
      if (modelId === currentValue && String(service.id || "") === currentServiceId) {
        btn.classList.add("is-active");
        btn.setAttribute("aria-selected", "true");
      }
      btn.dataset.value = modelId;
      btn.dataset.serviceId = service.id;
      btn.textContent = modelId;
      btn.addEventListener(PRESS_START_EVENT, (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        if (inputEl) {
          inputEl.value = modelId;
          if (service.id) {
            inputEl.dataset.serviceId = service.id;
          } else {
            delete inputEl.dataset.serviceId;
          }
          inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        }
        closeModelDropdown("Title");
        void _autoSaveManagedServiceDraft();
      });
      group.appendChild(btn);
    }

    dropdownEl.appendChild(group);
  }

  if (dropdownEl.classList.contains("is-floating-dropdown")) {
    positionFloatingDropdown(dropdownEl);
  }
}

export function renderModelDropdown(side, filterText = null) {
  const dropdownEl = side === "Title" ? elements.modelDropdownTitle : elements.modelDropdown;
  const inputEl =
    side === "Title" ? elements.titleGenerationModel : elements.model;
  if (!dropdownEl) return;

  const allOptions = getAggregatedModelOptions();
  const options = getFilteredModelOptions(filterText == null ? "" : filterText);
  const limit = getModelDropdownLimit(side);
  const currentValue = String(inputEl?.value || "").trim();
  const currentServiceId = getCurrentBoundServiceId(side);

  if (side === "Title") {
    renderTitleGroupedModelDropdown({
      dropdownEl,
      inputEl,
      currentValue,
      currentServiceId,
    });
    return;
  }

  dropdownEl.innerHTML = "";

  if (!options.length && !dropdownEl.childElementCount) {
    const empty = document.createElement("div");
    empty.className = "model-dropdown-empty";
    empty.textContent = allOptions.length
      ? t("无匹配模型，可继续输入")
      : hasAnyServiceModelFetchInFlight()
      ? t("正在获取模型列表…")
      : t("暂无模型列表，请先配置至少一个连接");
    dropdownEl.appendChild(empty);
    return;
  }

  const shown = options.slice(0, limit);
  for (const option of shown) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "model-dropdown-item";
    if (option.modelId === currentValue && option.serviceId === currentServiceId) {
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");
    }
    btn.textContent = `${option.serviceName} / ${option.modelId}`;
    btn.dataset.value = option.modelId;
    btn.dataset.serviceId = option.serviceId;
    btn.addEventListener(PRESS_START_EVENT, (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      if (inputEl) {
        inputEl.value = option.modelId;
        if (option.serviceId) {
          inputEl.dataset.serviceId = option.serviceId;
        } else {
          delete inputEl.dataset.serviceId;
        }
        inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (side !== "Title") _updateModelNames();
      closeModelDropdown(side);
      void _autoSaveManagedServiceDraft();
    });
    dropdownEl.appendChild(btn);
  }

  if (options.length > shown.length) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "model-dropdown-item";
    more.style.fontFamily = "inherit";
    more.textContent = t("加载更多（已显示 {shown}/{total}）", {
      shown: shown.length,
      total: options.length,
    });
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
  prefetchAllServiceModels();
  renderModelDropdown(side, null);
  const anchorEl = inputEl.closest?.(".model-picker-row") || inputEl;
  openFloatingDropdown(dropdownEl, anchorEl);
  setModelDropdownButtonState(side, true);

  dropdownEl.onscroll = () => {
    const remaining =
      dropdownEl.scrollHeight - dropdownEl.scrollTop - dropdownEl.clientHeight;
    if (remaining > 40) return;
    const activeQuery = getModelDropdownQuery(side, inputEl.value);
    const options = getFilteredModelOptions(activeQuery || "");
    if (getModelDropdownLimit(side) >= options.length) return;
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
  if (side === "Title") {
    syncTitleModelFollowPresentation();
    return;
  }

  if (!isModelDropdownOpen(side)) {
    if (side === "Title") {
      return;
    }
    const options = getAggregatedModelOptions();
    if (options.length) {
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
      model: config?.model || "",
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
      t("获取模型列表失败（{status}）：{detail}", {
        status: resp.status || 0,
        detail: detail || t("未知错误"),
      })
    );
  }

  const ids = Array.isArray(json?.models) ? json.models : [];
  if (!ids.length) throw new Error(t("获取到的模型列表为空"));
  return {
    ids,
    connectivityMode:
      typeof json?.connectivityMode === "string"
        ? json.connectivityMode
        : "models_list",
    message: typeof json?.message === "string" ? json.message : "",
  };
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
  const targetServiceId = getCurrentProfileServiceId();
  if (!apiKey || !apiUrl) {
    slot.models = [];
    closeModelDropdown(side);
    if (targetServiceId) {
      const headerSlot = getHeaderModelFetchSlot(targetServiceId);
      headerSlot.models = [];
      headerSlot.error = "";
      headerSlot.lastKey = "";
      headerSlot.lastFetchedAt = 0;
    }
    if (isHeaderModelDropdownOpen()) {
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
    const { ids, connectivityMode, message } = await fetchModelsOnce(config);
    if (slot.datalistFillToken !== requestToken) {
      return;
    }
    slot.models = ids;
    if (targetServiceId) {
      syncHeaderSlotFromSideModelCache(targetServiceId, side);
    }
    if (side !== "Title") {
      if (connectivityMode === "messages_probe") {
        setModelHint(
          side,
          message || t("模型列表接口不可用，已验证消息接口；可手动输入模型ID")
        );
      } else {
        setModelHint(
          side,
          t("已获取 {count} 个模型ID，可下拉选或手动输入", {
            count: ids.length,
          })
        );
      }
    }
    // 只在下拉框已经打开的情况下更新显示，不自动打开
    if (isModelDropdownOpen(side)) {
      const inputEl =
        side === "Title"
          ? elements.titleGenerationModel
          : elements.model;
      renderModelDropdown(side, getModelDropdownQuery(side, inputEl?.value || ""));
    }
    if (isHeaderModelDropdownOpen()) {
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
    if (targetServiceId) {
      const headerSlot = getHeaderModelFetchSlot(targetServiceId);
      headerSlot.models = [];
      headerSlot.error = e?.message || t("获取模型列表失败");
      headerSlot.lastKey = fetchKey;
      headerSlot.lastFetchedAt = Date.now();
    }
    if (isHeaderModelDropdownOpen()) {
      renderHeaderModelDropdown();
    }
    if (side !== "Title") {
      setModelHint(side, t("自动获取失败，请手动输入模型ID"));
    }
  } finally {
    if (slot.datalistFillToken === requestToken) {
      slot.inFlight = false;
    }
  }
}
