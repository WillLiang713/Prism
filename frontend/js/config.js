import {
  state,
  elements,
  STORAGE_KEYS,
  resolveProviderSelection,
  createId,
  formatTime,
} from './state.js';
import { showAlert, showConfirm, syncBodyScrollLock } from './dialog.js';
import {
  syncAllConfigSelectPickers,
  syncConfigSelectPicker,
  closeAllConfigSelectPickers,
} from './dropdown.js';
import {
  closeModelDropdown,
  resetModelFetchState,
  scheduleFetchModels,
  updateModelHint,
  fetchModelsOnce,
  isHeaderModelDropdownOpen,
  renderHeaderModelDropdown,
} from './models.js';
import { renderMarkdownToElement } from './markdown.js';
import {
  getCurrentWebSearchToolMode,
  getPreferredWebSearchToolMode,
  isWebSearchEnabled,
  normalizeExternalWebSearchProvider,
  normalizeWebSearchProvider,
  normalizeTavilySearchDepth,
  normalizeExaSearchType,
  resolvePreferredWebSearchState,
  setWebSearchEnabled,
  setWebSearchToolMode,
  updateConfigStatusStrip,
  updateWebSearchProviderUi,
} from './web-search.js';
import { syncDesktopPreferences } from './desktop.js';

const CONFIG_STORE_VERSION = 2;
const LEGACY_DEFAULT_SERVICE_NAME = "默认服务";
const UNNAMED_SERVICE_LABEL = "未命名服务";
const DEFAULT_REASONING_EFFORT = "medium";
const CONNECTIVITY_FEEDBACK_AUTO_HIDE_MS = 3000;
const DEFAULT_CLOSE_TO_TRAY_ON_CLOSE = true;

const serviceConnectivityHideTimers = new Map();
let transientConnectivityHideTimer = 0;

function cloneValue(value) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch (_error) {
      // Fall through to JSON cloning.
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createConnectivityState(status = "idle", message = "", testedAt = 0) {
  return {
    status,
    message: String(message || ""),
    testedAt: Number(testedAt) || 0,
  };
}

function isTerminalConnectivityStatus(status) {
  const normalized = String(status || "").toLowerCase();
  return normalized === "success" || normalized === "error";
}

function normalizeConnectivityState(raw) {
  const status = String(raw?.status || "").toLowerCase();
  const normalizedStatus =
    status === "testing" || status === "success" || status === "error"
      ? status
      : "idle";
  const message = String(raw?.message || "");
  const testedAt = Number(raw?.testedAt) || 0;
  const nextConnectivity = createConnectivityState(
    normalizedStatus,
    message,
    testedAt
  );
  if (
    isTerminalConnectivityStatus(nextConnectivity.status) &&
    nextConnectivity.testedAt > 0 &&
    Date.now() - nextConnectivity.testedAt >= CONNECTIVITY_FEEDBACK_AUTO_HIDE_MS
  ) {
    return createConnectivityState("idle", message, testedAt);
  }
  return nextConnectivity;
}

function clearServiceConnectivityHideTimer(serviceId) {
  const timerId = serviceConnectivityHideTimers.get(serviceId);
  if (!timerId) return;
  clearTimeout(timerId);
  serviceConnectivityHideTimers.delete(serviceId);
}

function clearTransientConnectivityHideTimer() {
  if (!transientConnectivityHideTimer) return;
  clearTimeout(transientConnectivityHideTimer);
  transientConnectivityHideTimer = 0;
}

function scheduleServiceConnectivityAutoHide(serviceId, connectivity) {
  clearServiceConnectivityHideTimer(serviceId);
  const nextConnectivity = normalizeConnectivityState(connectivity);
  if (!isTerminalConnectivityStatus(nextConnectivity.status)) return;

  const timerId = window.setTimeout(() => {
    serviceConnectivityHideTimers.delete(serviceId);
    updateServiceConnectivity(serviceId, { status: "idle" });
  }, CONNECTIVITY_FEEDBACK_AUTO_HIDE_MS);

  serviceConnectivityHideTimers.set(serviceId, timerId);
}

function scheduleTransientConnectivityAutoHide(serviceId, connectivity) {
  clearTransientConnectivityHideTimer();
  const nextConnectivity = normalizeConnectivityState(connectivity);
  if (!isTerminalConnectivityStatus(nextConnectivity.status)) return;

  transientConnectivityHideTimer = window.setTimeout(() => {
    transientConnectivityHideTimer = 0;
    renderServiceConnectivityState(
      createConnectivityState("idle", nextConnectivity.message, nextConnectivity.testedAt),
      true
    );
  }, CONNECTIVITY_FEEDBACK_AUTO_HIDE_MS);
}

function getRuntimeProviderDefaults() {
  return resolveProviderSelection();
}

function createServiceTemplate(name = "") {
  const providerDefaults = getRuntimeProviderDefaults();
  const now = Date.now();
  return {
    id: createId(),
    name: String(name || "").trim(),
    model: {
      provider: providerDefaults.provider,
      providerSelection: providerDefaults.selection,
      endpointMode: providerDefaults.endpointMode,
      apiKey: "",
      model: "",
      titleModel: "",
      apiUrl: "",
      systemPrompt: "",
    },
    reasoningEffort: DEFAULT_REASONING_EFFORT,
    connectivity: createConnectivityState(),
    createdAt: now,
    updatedAt: now,
  };
}

function createDraftService() {
  return createServiceTemplate("");
}

function ensureServicesWithDraft(
  services = [],
  activeServiceId = null,
  serviceManagerSelectedId = null
) {
  const list = Array.isArray(services) ? services.filter(Boolean) : [];
  if (!list.length) {
    const draftService = createDraftService();
    return {
      services: [draftService],
      activeServiceId: draftService.id,
      serviceManagerSelectedId: draftService.id,
      createdDraft: true,
    };
  }

  const hasActiveService = list.some((service) => service.id === activeServiceId);
  const resolvedActiveServiceId = hasActiveService ? activeServiceId : list[0].id;
  const hasSelectedService = list.some(
    (service) => service.id === serviceManagerSelectedId
  );

  return {
    services: list,
    activeServiceId: resolvedActiveServiceId,
    serviceManagerSelectedId: hasSelectedService
      ? serviceManagerSelectedId
      : resolvedActiveServiceId,
    createdDraft: false,
  };
}

function createConfigStoreShape(rawConfig = {}, overrides = {}) {
  return {
    version: CONFIG_STORE_VERSION,
    activeServiceId:
      overrides.activeServiceId === undefined ? null : overrides.activeServiceId,
    services: Array.isArray(overrides.services) ? overrides.services : [],
    webSearch:
      rawConfig.webSearch && typeof rawConfig.webSearch === "object"
        ? cloneValue(rawConfig.webSearch)
        : {},
    desktop:
      rawConfig.desktop && typeof rawConfig.desktop === "object"
        ? cloneValue(rawConfig.desktop)
        : {},
  };
}

function hasLegacyServiceConfig(rawConfig = {}) {
  const legacyModelConfig = rawConfig.model || rawConfig.A || {};
  const candidates = [
    legacyModelConfig.providerSelection,
    legacyModelConfig.provider,
    rawConfig.providerSelection,
    rawConfig.provider,
    legacyModelConfig.endpointMode,
    rawConfig.endpointMode,
    legacyModelConfig.apiKey,
    legacyModelConfig.model,
    legacyModelConfig.titleModel,
    rawConfig.titleModel,
    legacyModelConfig.apiUrl,
    legacyModelConfig.systemPrompt,
    legacyModelConfig.roleSetting,
    rawConfig.reasoningEffort,
  ];
  return candidates.some((value) => String(value || "").trim() !== "");
}

function normalizeReasoningEffortValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || DEFAULT_REASONING_EFFORT;
}

function normalizeService(service, index = 0) {
  const providerConfig = resolveProviderSelection(
    service?.model?.providerSelection || service?.model?.provider,
    service?.model?.endpointMode
  );
  const now = Date.now();
  return {
    id: String(service?.id || createId()),
    name: String(service?.name || "").trim(),
    model: {
      provider: providerConfig.provider,
      providerSelection: providerConfig.selection,
      endpointMode: providerConfig.endpointMode,
      apiKey: String(service?.model?.apiKey || ""),
      model: String(service?.model?.model || ""),
      titleModel: String(service?.model?.titleModel || ""),
      apiUrl: String(service?.model?.apiUrl || ""),
      systemPrompt: String(
        service?.model?.systemPrompt || service?.model?.roleSetting || ""
      ),
    },
    reasoningEffort: normalizeReasoningEffortValue(
      service?.reasoningEffort || DEFAULT_REASONING_EFFORT
    ),
    connectivity: normalizeConnectivityState(service?.connectivity),
    createdAt: Number(service?.createdAt) || now,
    updatedAt: Number(service?.updatedAt) || Number(service?.createdAt) || now,
  };
}

function migrateLegacyConfig(rawConfig = {}) {
  if (!hasLegacyServiceConfig(rawConfig)) {
    return createConfigStoreShape(rawConfig);
  }

  const legacyModelConfig = rawConfig.model || rawConfig.A || {};
  const providerConfig = resolveProviderSelection(
    legacyModelConfig.providerSelection ||
      legacyModelConfig.provider ||
      rawConfig.providerSelection ||
      rawConfig.provider,
    legacyModelConfig.endpointMode || rawConfig.endpointMode
  );
  const migratedService = normalizeService(
    {
      id: createId(),
      name: "",
      model: {
        provider: providerConfig.provider,
        providerSelection: providerConfig.selection,
        endpointMode: providerConfig.endpointMode,
        apiKey: legacyModelConfig.apiKey || "",
        model: legacyModelConfig.model || "",
        titleModel: legacyModelConfig.titleModel || rawConfig.titleModel || "",
        apiUrl: legacyModelConfig.apiUrl || "",
        systemPrompt:
          legacyModelConfig.systemPrompt || legacyModelConfig.roleSetting || "",
      },
      reasoningEffort:
        rawConfig.reasoningEffort || DEFAULT_REASONING_EFFORT,
      connectivity: createConnectivityState(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    0
  );
  return createConfigStoreShape(rawConfig, {
    activeServiceId: migratedService.id,
    services: [migratedService],
  });
}

function normalizeConfigStore(rawConfig = {}) {
  if (Array.isArray(rawConfig?.services)) {
    const services = rawConfig.services
      .map((service, index) => normalizeService(service, index))
      .filter((service) => !isEffectivelyEmptyService(service));
    const activeExists =
      rawConfig.activeServiceId &&
      services.some((service) => service.id === rawConfig.activeServiceId);
    return createConfigStoreShape(rawConfig, {
      activeServiceId: activeExists ? rawConfig.activeServiceId : services[0]?.id || null,
      services,
    });
  }
  return migrateLegacyConfig(rawConfig);
}

function readRawConfigStore() {
  const raw = localStorage.getItem(STORAGE_KEYS.config);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.error("解析本地配置失败:", error);
    return {};
  }
}

function readConfigStore() {
  const store = normalizeConfigStore(readRawConfigStore());
  localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(store));
  return store;
}

function writeConfigStore(store) {
  localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(store));
  return store;
}

function getUniqueServiceName(baseName, excludeId = "") {
  const normalizedBase = String(baseName || "").trim() || "新服务";
  const existingNames = new Set(
    state.services
      .filter((service) => service.id !== excludeId)
      .map((service) => String(service.name || "").trim())
      .filter(Boolean)
  );
  if (!existingNames.has(normalizedBase)) return normalizedBase;
  let suffix = 2;
  while (existingNames.has(`${normalizedBase} ${suffix}`)) {
    suffix += 1;
  }
  return `${normalizedBase} ${suffix}`;
}

export function getServiceDisplayName(serviceOrName) {
  const rawName =
    typeof serviceOrName === "string" ? serviceOrName : serviceOrName?.name;
  return String(rawName || "").trim() || UNNAMED_SERVICE_LABEL;
}

function getNormalizedManagedServiceName(existingService = null) {
  const fallbackName =
    existingService?.name || elements.serviceNameInput?.value || "";
  const rawName = String(elements.serviceNameInput?.value || fallbackName).trim();
  if (!rawName) {
    return "";
  }
  const normalizedName = getUniqueServiceName(rawName, existingService?.id || "");
  if (elements.serviceNameInput && elements.serviceNameInput.value !== normalizedName) {
    elements.serviceNameInput.value = normalizedName;
  }
  return normalizedName;
}

function getReasoningEffortValue() {
  return (
    elements.reasoningEffortDropdown
      ?.querySelector("button.active")
      ?.dataset.value || DEFAULT_REASONING_EFFORT
  );
}

function resolveCloseToTrayOnClose(value) {
  if (value === undefined || value === null) {
    return DEFAULT_CLOSE_TO_TRAY_ON_CLOSE;
  }
  return value === true;
}

function getCloseToTrayOnCloseValue(store = null) {
  if (elements.closeToTrayOnClose) {
    return !!elements.closeToTrayOnClose.checked;
  }
  return resolveCloseToTrayOnClose(store?.desktop?.closeToTrayOnClose);
}

function setReasoningEffortValue(value) {
  const normalizedValue = normalizeReasoningEffortValue(value);
  if (!elements.reasoningEffortDropdown || !elements.reasoningEffortValue) return;
  let activeBtn = null;
  elements.reasoningEffortDropdown.querySelectorAll("button").forEach((button) => {
    const active = button.dataset.value === normalizedValue;
    button.classList.toggle("active", active);
    if (active) activeBtn = button;
  });
  if (!activeBtn) {
    activeBtn =
      elements.reasoningEffortDropdown.querySelector(
        `button[data-value="${DEFAULT_REASONING_EFFORT}"]`
      ) || elements.reasoningEffortDropdown.querySelector("button");
    activeBtn?.classList.add("active");
  }
  if (activeBtn) {
    elements.reasoningEffortValue.textContent =
      activeBtn.dataset.label || "中";
  }
  elements.reasoningEffortSelector?.classList.toggle(
    "is-off",
    normalizedValue === "none"
  );
}

function getEffectiveProviderSelectionValue() {
  return resolveProviderSelection(elements.provider?.value).selection;
}

function getEffectiveProviderConfig() {
  return resolveProviderSelection(getEffectiveProviderSelectionValue());
}

function getEffectiveProviderValue() {
  return getEffectiveProviderConfig().provider;
}

function getEffectiveEndpointModeValue() {
  return getEffectiveProviderConfig().endpointMode;
}

export function normalizeApiUrlForProvider(rawUrl, provider = getEffectiveProviderValue()) {
  let value = String(rawUrl || "").trim();
  if (!value) return "";
  if (!value.includes("://")) {
    value = `https://${value}`;
  }

  let parsed = null;
  try {
    parsed = new URL(value);
  } catch {
    return value;
  }

  const providerMode = resolveProviderSelection(provider).provider;
  let path = (parsed.pathname || "").replace(/\/+$/, "");
  let pathLower = path.toLowerCase();

  if (providerMode === "gemini") {
    const modelsIndex = pathLower.indexOf("/models/");
    if (modelsIndex >= 0) {
      path = path.slice(0, modelsIndex);
      pathLower = path.toLowerCase();
    } else if (pathLower.endsWith("/models")) {
      path = path.slice(0, -"/models".length);
      pathLower = path.toLowerCase();
    }

    const colonIndex = path.indexOf(":");
    if (colonIndex >= 0) {
      path = path.slice(0, colonIndex);
      pathLower = path.toLowerCase();
    }

    if (pathLower.endsWith("/v1beta")) {
      path = path.slice(0, -"/v1beta".length);
    } else if (pathLower.endsWith("/v1")) {
      path = path.slice(0, -"/v1".length);
    }
  } else if (providerMode === "anthropic") {
    if (pathLower.endsWith("/messages")) {
      path = path.slice(0, -"/messages".length);
      pathLower = path.toLowerCase();
    }
    if (pathLower.endsWith("/v1")) {
      path = path.slice(0, -"/v1".length);
    }
  } else {
    for (const suffix of ["/chat/completions", "/responses", "/models"]) {
      if (pathLower.endsWith(suffix)) {
        path = path.slice(0, -suffix.length);
        pathLower = path.toLowerCase();
        break;
      }
    }
    if (pathLower.endsWith("/v1")) {
      path = path.slice(0, -"/v1".length);
    }
  }

  path = path.replace(/\/+$/, "");
  return `${parsed.origin}${path}`;
}

function getEffectiveApiUrlValue() {
  return normalizeApiUrlForProvider(
    elements.apiUrl?.value || "",
    getEffectiveProviderValue()
  );
}

function getEffectiveModelValue() {
  return String(elements.model?.value || "").trim();
}

function getServiceModelRequestConfig(service) {
  const providerConfig = resolveProviderSelection(
    service?.model?.providerSelection || service?.model?.provider,
    service?.model?.endpointMode
  );
  return {
    provider: providerConfig.provider,
    endpointMode: providerConfig.endpointMode,
    apiKey: service?.model?.apiKey || "",
    apiUrl: String(service?.model?.apiUrl || "").trim(),
  };
}

function getLiveServiceRequestConfigFromForm() {
  return {
    provider: getEffectiveProviderValue(),
    endpointMode: getEffectiveEndpointModeValue(),
    apiKey: elements.apiKey?.value || "",
    apiUrl: getEffectiveApiUrlValue(),
  };
}

function getActiveServiceModelRequestConfig() {
  const activeService = getActiveService();
  const activeServiceIsManaged =
    activeService &&
    activeService.id === state.serviceManagerSelectedId &&
    elements.configModal?.classList.contains("open");
  if (activeServiceIsManaged) {
    return getLiveServiceRequestConfigFromForm();
  }

  return getServiceModelRequestConfig(activeService);
}

function getManagedServiceModelRequestConfig() {
  const managedService = getManagedService();
  if (managedService && elements.configModal?.classList.contains("open")) {
    return getLiveServiceRequestConfigFromForm();
  }
  return getServiceModelRequestConfig(managedService);
}

function isEffectivelyEmptyService(service) {
  return (
    String(service?.name || "").trim() === LEGACY_DEFAULT_SERVICE_NAME &&
    String(service?.model?.apiKey || "").trim() === "" &&
    String(service?.model?.model || "").trim() === "" &&
    String(service?.model?.titleModel || "").trim() === "" &&
    String(service?.model?.apiUrl || "").trim() === "" &&
    String(service?.model?.systemPrompt || "").trim() === ""
  );
}

function hasEffectiveApiKeyValue() {
  return !!String(elements.apiKey?.value || "").trim();
}

function syncApiKeyPlaceholder() {
  if (!elements.apiKey) return;
  elements.apiKey.placeholder = "输入API密钥";
}

export function normalizeApiUrlInputValue() {
  if (!elements.apiUrl) return "";
  const normalized = normalizeApiUrlForProvider(
    elements.apiUrl.value,
    getEffectiveProviderValue()
  );
  if (normalized && normalized !== elements.apiUrl.value) {
    elements.apiUrl.value = normalized;
  }
  return normalized;
}

function getServiceById(serviceId) {
  return state.services.find((service) => service.id === serviceId) || null;
}

function getActiveService() {
  return getServiceById(state.activeServiceId) || state.services[0] || null;
}

function getManagedService() {
  return (
    getServiceById(state.serviceManagerSelectedId) ||
    getActiveService() ||
    state.services[0] ||
    null
  );
}

function isEditingActiveService() {
  return (
    elements.configModal?.classList.contains("open") &&
    !!state.activeServiceId &&
    state.serviceManagerSelectedId === state.activeServiceId
  );
}

function setServiceFormDisabled(disabled) {
  const controls = [
    elements.serviceNameInput,
    elements.provider,
    elements.providerPickerInput,
    elements.providerPickerBtn,
    elements.apiKey,
    elements.apiUrl,
    elements.model,
    elements.modelDropdownBtn,
    elements.titleGenerationModel,
    elements.modelDropdownBtnTitle,
    elements.roleSetting,
  ];
  controls.forEach((control) => {
    if (!control) return;
    control.disabled = !!disabled;
  });
}

function getManagedServiceConnectionFormSnapshot() {
  return {
    providerSelection: getEffectiveProviderSelectionValue(),
    endpointMode: getEffectiveEndpointModeValue(),
    apiKey: String(elements.apiKey?.value || ""),
    apiUrl: normalizeApiUrlForProvider(
      elements.apiUrl?.value || "",
      getEffectiveProviderValue()
    ),
  };
}

function getServiceConnectionStoreSnapshot(service) {
  if (!service) return null;
  return {
    providerSelection: String(service.model?.providerSelection || ""),
    endpointMode: String(service.model?.endpointMode || ""),
    apiKey: String(service.model?.apiKey || ""),
    apiUrl: String(service.model?.apiUrl || ""),
  };
}

function hasUnsavedManagedServiceConnectionChanges() {
  const managedService = getManagedService();
  if (!managedService) return false;
  return (
    JSON.stringify(getManagedServiceConnectionFormSnapshot()) !==
    JSON.stringify(getServiceConnectionStoreSnapshot(managedService))
  );
}

function getManagedServiceFormSnapshot() {
  return {
    name: String(elements.serviceNameInput?.value || "").trim(),
    providerSelection: getEffectiveProviderSelectionValue(),
    endpointMode: getEffectiveEndpointModeValue(),
    apiKey: String(elements.apiKey?.value || ""),
    apiUrl: normalizeApiUrlForProvider(
      elements.apiUrl?.value || "",
      getEffectiveProviderValue()
    ),
    model: getActiveServiceModelFormValue(),
    titleModel: getActiveServiceTitleModelFormValue(),
    systemPrompt: getActiveRoleSettingFormValue(),
  };
}

function getServiceFormStoreSnapshot(service) {
  if (!service) return null;
  return {
    name: String(service.name || "").trim(),
    providerSelection: String(service.model?.providerSelection || ""),
    endpointMode: String(service.model?.endpointMode || ""),
    apiKey: String(service.model?.apiKey || ""),
    apiUrl: String(service.model?.apiUrl || ""),
    model: String(service.model?.model || ""),
    titleModel: String(service.model?.titleModel || ""),
    systemPrompt: String(service.model?.systemPrompt || ""),
  };
}

function getActiveServiceModelFormValue() {
  return String(elements.model?.value || "");
}

function getActiveServiceModelStoreValue(service) {
  return String(service?.model?.model || "");
}

function getActiveServiceTitleModelFormValue() {
  return String(elements.titleGenerationModel?.value || "");
}

function getActiveServiceTitleModelStoreValue(service) {
  return String(service?.model?.titleModel || "");
}

function getActiveRoleSettingFormValue() {
  return String(elements.roleSetting?.value || "");
}

function getServiceRoleSettingStoreValue(service) {
  return String(service?.model?.systemPrompt || "");
}

function hasUnsavedManagedServiceChanges() {
  const managedService = getManagedService();
  if (!managedService) return false;
  return (
    JSON.stringify(getManagedServiceFormSnapshot()) !==
    JSON.stringify(getServiceFormStoreSnapshot(managedService))
  );
}

function hasUnsavedConfigChanges() {
  return hasUnsavedManagedServiceChanges();
}

function applyManagedServiceConnectionToForm(service) {
  if (!service) return;
  const providerConfig = resolveProviderSelection(
    service.model?.providerSelection || service.model?.provider,
    service.model?.endpointMode
  );
  if (elements.provider) {
    elements.provider.value = providerConfig.selection;
  }
  if (elements.apiKey) {
    elements.apiKey.value = service.model?.apiKey || "";
  }
  if (elements.apiUrl) {
    elements.apiUrl.value = service.model?.apiUrl || "";
  }
  syncConfigSelectPicker("provider");
  updateProviderUi();
}

function applyActiveRoleSettingToForm(service) {
  if (!service) return;
  if (elements.model) {
    elements.model.value = service.model?.model || "";
  }
  if (elements.titleGenerationModel) {
    elements.titleGenerationModel.value = service.model?.titleModel || "";
  }
  if (elements.roleSetting) {
    elements.roleSetting.value = service.model?.systemPrompt || "";
  }
  syncRoleSettingPreview(true);
  updateModelHint("main");
  updateModelHint("Title");
}

function applyEmptyServiceStateToForm() {
  const providerDefaults = getRuntimeProviderDefaults();

  resetModelFetchState("main");
  resetModelFetchState("Title");

  if (elements.serviceNameInput) {
    elements.serviceNameInput.value = "";
  }
  if (elements.provider) {
    elements.provider.value = providerDefaults.selection;
  }
  if (elements.apiKey) {
    elements.apiKey.value = "";
  }
  if (elements.apiUrl) {
    elements.apiUrl.value = "";
  }
  if (elements.model) {
    elements.model.value = "";
  }
  if (elements.titleGenerationModel) {
    elements.titleGenerationModel.value = "";
  }
  if (elements.roleSetting) {
    elements.roleSetting.value = "";
  }

  syncConfigSelectPicker("provider");
  syncRoleSettingPreview(false);
  updateProviderUi();
  updateModelHint("main");
  updateModelHint("Title");
}

function readManagedServiceConnectionFromForm(existingService = null) {
  const base = existingService ? cloneValue(existingService) : createServiceTemplate();
  const providerConfig = getEffectiveProviderConfig();
  const updatedAt = Date.now();
  return normalizeService(
    {
      ...base,
      name: getNormalizedManagedServiceName(base),
      updatedAt,
      model: {
        provider: providerConfig.provider,
        providerSelection: providerConfig.selection,
        endpointMode: providerConfig.endpointMode,
        apiKey: String(elements.apiKey?.value || ""),
        model: getActiveServiceModelFormValue(),
        titleModel: getActiveServiceTitleModelFormValue(),
        apiUrl: normalizeApiUrlForProvider(
          elements.apiUrl?.value || "",
          providerConfig.provider
        ),
        systemPrompt: getActiveRoleSettingFormValue(),
      },
      reasoningEffort: base.reasoningEffort,
      connectivity: base.connectivity || createConnectivityState(),
      createdAt: base.createdAt || updatedAt,
    }
  );
}

export async function autoSaveManagedServiceDraft() {
  return persistCurrentServiceForm({
    showFeedback: false,
    closeAfterSave: false,
  });
}

function getConfigStoreForWrite(overrides = {}) {
  const persisted = normalizeConfigStore(readRawConfigStore());
  return {
    ...persisted,
    version: CONFIG_STORE_VERSION,
    activeServiceId:
      overrides.activeServiceId ??
      state.activeServiceId ??
      persisted.activeServiceId,
    services: cloneValue(overrides.services ?? state.services ?? persisted.services),
    webSearch: cloneValue(overrides.webSearch ?? persisted.webSearch ?? {}),
    desktop: cloneValue(overrides.desktop ?? persisted.desktop ?? {}),
  };
}

function persistState(overrides = {}) {
  const store = getConfigStoreForWrite(overrides);
  writeConfigStore(store);
  state.services = cloneValue(store.services);
  state.activeServiceId = store.activeServiceId;
  if (!getServiceById(state.serviceManagerSelectedId)) {
    state.serviceManagerSelectedId = state.activeServiceId;
  }
  return store;
}

function getConnectivityLabel(status) {
  const normalized = String(status || "idle").toLowerCase();
  if (normalized === "testing") return "连接中";
  if (normalized === "success") return "连接成功";
  if (normalized === "error") return "连接失败";
  return "未测试";
}

function renderServiceSummary(service) {
  if (!elements.serviceSummary) return;
  if (!service) {
    elements.serviceSummary.innerHTML = "";
    return;
  }
  const providerConfig = resolveProviderSelection(
    service.model?.providerSelection || service.model?.provider,
    service.model?.endpointMode
  );
  const apiKeyHint = (service.model?.apiKey || "").trim()
    ? "已配置密钥"
    : "未配置密钥";
  const rows = [
    ["接口类型", providerConfig.label],
    ["默认模型", service.model?.model || "未填写"],
    ["API 地址", service.model?.apiUrl || "未填写"],
    ["密钥状态", apiKeyHint],
    ["更新时间", formatTime(service.updatedAt)],
  ];
  elements.serviceSummary.innerHTML = rows
    .map(
      ([label, value]) => `
        <div class="service-summary-row">
          <span class="service-summary-label">${escapeHtml(label)}</span>
          <span class="service-summary-value">${escapeHtml(value)}</span>
        </div>
      `
    )
    .join("");
}

function renderServiceConnectivityState(connectivity, hasService = true) {
  const nextConnectivity = hasService
    ? connectivity || createConnectivityState()
    : createConnectivityState();
  const normalizedStatus = String(nextConnectivity.status || "idle").toLowerCase();
  const buttonLabel =
    normalizedStatus === "idle"
      ? "测试连接"
      : getConnectivityLabel(nextConnectivity.status);

  if (elements.testServiceConnectionBtn) {
    elements.testServiceConnectionBtn.textContent = buttonLabel;
    elements.testServiceConnectionBtn.dataset.status =
      nextConnectivity.status || "idle";
    elements.testServiceConnectionBtn.disabled =
      !hasService || normalizedStatus === "testing";
  }
}

function syncServiceDetailPanel(options = {}) {
  const { preserveConnectionForm = false } = options;
  const service = getManagedService();
  setServiceFormDisabled(!service);
  if (elements.serviceNameInput) {
    elements.serviceNameInput.value = service?.name || "";
  }
  if (service && !preserveConnectionForm) {
    resetModelFetchState("main");
    resetModelFetchState("Title");
    applyManagedServiceConnectionToForm(service);
    applyActiveRoleSettingToForm(service);
    scheduleFetchModels("main", 0);
    scheduleFetchModels("Title", 0);
  } else if (!service && !preserveConnectionForm) {
    applyEmptyServiceStateToForm();
  }
  renderServiceSummary(service);
  renderServiceConnectivityState(service?.connectivity, !!service);
  if (elements.duplicateServiceBtn) {
    elements.duplicateServiceBtn.disabled = !service;
  }
  if (elements.deleteServiceBtn) {
    elements.deleteServiceBtn.disabled = !service;
  }
}

function renderServiceList() {
  if (!elements.serviceList) return;
  elements.serviceList.innerHTML = "";
  if (!state.services.length) {
    const empty = document.createElement("div");
    empty.className = "model-dropdown-empty";
    empty.textContent = "暂无服务，点击上方“新建”开始配置。";
    elements.serviceList.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  state.services.forEach((service) => {
    const isSelected = service.id === state.serviceManagerSelectedId;
    const isActive = service.id === state.activeServiceId;
    const card = document.createElement("div");
    card.className = `service-list-card${isSelected ? " is-selected" : ""}${
      isActive ? " is-active-service" : ""
    }`;
    card.dataset.serviceId = service.id;
    card.dataset.provider = service.model?.provider || "";

    const item = document.createElement("button");
    item.type = "button";
    item.className = "service-list-item";
    item.addEventListener("click", () => {
      if (state.serviceManagerSelectedId === service.id) {
        return;
      }
      void handleManagedServiceSelectionChange(service.id);
    });

    const head = document.createElement("div");
    head.className = "service-list-head";

    const title = document.createElement("div");
    title.className = "service-list-title";
    title.textContent = getServiceDisplayName(service);
    head.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "service-list-meta";
    meta.textContent =
      resolveProviderSelection(
        service.model?.providerSelection || service.model?.provider,
        service.model?.endpointMode
      ).label || "未配置";

    const subMeta = document.createElement("div");
    subMeta.className = "service-list-submeta";
    subMeta.textContent = String(service.model?.apiUrl || "").trim();

    item.appendChild(head);
    item.appendChild(meta);
    if (subMeta.textContent) {
      item.appendChild(subMeta);
    }
    card.appendChild(item);

    if (isActive || isSelected) {
      const cornerBadge = document.createElement("button");
      cornerBadge.type = "button";
      cornerBadge.className = `service-current-corner${
        isActive ? " is-active" : " is-action"
      }`;
      cornerBadge.setAttribute(
        "aria-label",
        isActive ? "当前使用" : `将 ${getServiceDisplayName(service)} 设为当前服务`
      );
      if (isActive) {
        cornerBadge.tabIndex = -1;
        cornerBadge.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
      } else {
        cornerBadge.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          void handleCurrentServiceChange(service.id, {
            syncManagerSelection: false,
          });
        });
      }

      const cornerLabel = document.createElement("span");
      cornerLabel.className = "service-current-corner-label";
      cornerLabel.textContent = isActive ? "当前使用" : "设为当前";
      cornerBadge.appendChild(cornerLabel);
      card.appendChild(cornerBadge);
    }

    fragment.appendChild(card);
  });
  elements.serviceList.appendChild(fragment);
}

export function renderServiceManagementUi(options = {}) {
  renderServiceList();
  syncServiceDetailPanel(options);
  if (!options.preserveConnectionForm) {
    syncConfigSelectPicker("provider");
  }
}

function focusServiceNameInput() {
  requestAnimationFrame(() => {
    elements.serviceNameInput?.focus();
    elements.serviceNameInput?.select();
  });
}

function setManagedServiceLocally(serviceId, options = {}) {
  const { refreshModelList = true } = options;
  const targetService = getServiceById(serviceId);
  if (!targetService) return false;
  state.serviceManagerSelectedId = targetService.id;
  renderServiceManagementUi();
  syncAllConfigSelectPickers();
  updateConfigStatusStrip();
  if (refreshModelList) {
    scheduleFetchModels("main", 0);
    scheduleFetchModels("Title", 0);
  }
  return true;
}

async function handleManagedServiceSelectionChange(nextServiceId) {
  const nextId = String(nextServiceId || "");
  if (!nextId || nextId === state.serviceManagerSelectedId) {
    return false;
  }

  if (!hasUnsavedManagedServiceChanges()) {
    return setManagedServiceLocally(nextId);
  }

  const shouldSave = await showConfirm("当前编辑服务有未保存修改，是否先保存？", {
    title: "未保存修改",
    okText: "保存并切换",
    cancelText: "继续切换",
    hint: "继续切换会进入下一步确认。",
  });
  if (shouldSave) {
    const saved = await persistCurrentServiceForm({
      showFeedback: false,
      closeAfterSave: false,
    });
    if (!saved) {
      return false;
    }
    return setManagedServiceLocally(nextId);
  }

  const shouldDiscard = await showConfirm("切换后将丢失当前编辑中的未保存修改，是否继续？", {
    title: "放弃修改",
    okText: "继续切换",
    cancelText: "取消",
    danger: true,
  });
  if (!shouldDiscard) {
    return false;
  }

  return setManagedServiceLocally(nextId);
}

function replaceService(updatedService) {
  state.services = state.services.map((service) =>
    service.id === updatedService.id ? normalizeService(updatedService) : service
  );
}

async function persistCurrentServiceForm(options = {}) {
  const { showFeedback = false, closeAfterSave = false } = options;
  const managedService = getManagedService();
  if (managedService) {
    state.services = state.services.map((service) => {
      if (service.id !== managedService.id) {
        return service;
      }
      return readManagedServiceConnectionFromForm(service);
    });
  }

  persistState({
    activeServiceId: state.activeServiceId,
    services: state.services,
    webSearch: {
      enabled: isWebSearchEnabled(),
      toolMode: getWebSearchConfig().toolMode,
      provider: normalizeExternalWebSearchProvider(
        elements.webSearchProvider?.value
      ),
      tavilyApiKey: elements.tavilyApiKey?.value || "",
      exaApiKey: elements.exaApiKey?.value || "",
      exaSearchType: normalizeExaSearchType(elements.exaSearchType?.value),
      maxResults: parseInt(elements.tavilyMaxResults?.value) || 5,
      searchDepth: normalizeTavilySearchDepth(elements.tavilySearchDepth?.value),
    },
    desktop: getDesktopConfig(),
  });
  renderServiceManagementUi({
    preserveConnectionForm: true,
  });
  if (managedService) {
    applyActiveRoleSettingToForm(getManagedService());
  } else {
    applyEmptyServiceStateToForm();
  }
  updateModelNames();
  updateConfigStatusStrip();
  await syncDesktopPreferences({
    closeToTray: getCloseToTrayOnCloseValue(),
  });
  if (showFeedback) {
    await showAlert("配置已保存", {
      title: "保存成功",
    });
  }
  if (closeAfterSave) {
    closeConfigModal();
  }
  return true;
}

function setActiveServiceLocally(serviceId, options = {}) {
  const {
    persist = true,
    syncManagerSelection = true,
    refreshModelList = true,
  } = options;
  const targetService = getServiceById(serviceId);
  if (!targetService) return false;
  state.activeServiceId = targetService.id;
  if (syncManagerSelection) {
    state.serviceManagerSelectedId = targetService.id;
  }
  if (persist) {
    persistState({
      activeServiceId: targetService.id,
      services: state.services,
    });
  }
  const preferredWebSearchState = resolvePreferredWebSearchState(
    targetService.model,
    {
      currentMode: state.webSearch?.toolMode,
      currentEnabled: state.webSearch?.enabled === true,
    }
  );
  renderServiceManagementUi();
  syncAllConfigSelectPickers();
  updateModelNames();
  setWebSearchToolMode(preferredWebSearchState.toolMode, {
    persist,
  });
  setWebSearchEnabled(preferredWebSearchState.enabled, {
    persist,
  });
  updateConfigStatusStrip();
  if (refreshModelList) {
    scheduleFetchModels("main", 0);
  }
  return true;
}

export async function applyHeaderModelSelection(serviceId, modelId) {
  const targetServiceId = String(serviceId || "").trim();
  const nextModelId = String(modelId || "").trim();
  if (!targetServiceId || !nextModelId) return false;

  if (hasUnsavedConfigChanges()) {
    const saved = await persistCurrentServiceForm({
      showFeedback: false,
      closeAfterSave: false,
    });
    if (!saved) {
      return false;
    }
  }

  const targetService = getServiceById(targetServiceId);
  if (!targetService) return false;

  replaceService({
    ...cloneValue(targetService),
    updatedAt: Date.now(),
    model: {
      ...cloneValue(targetService.model || {}),
      model: nextModelId,
    },
  });

  return setActiveServiceLocally(targetServiceId, {
    persist: true,
    syncManagerSelection: true,
    refreshModelList: true,
  });
}

export function getConfigFromForm(side) {
  const managedServiceRequestConfig = getManagedServiceModelRequestConfig();
  if (side === "Title") {
    return {
      provider: managedServiceRequestConfig.provider,
      endpointMode: managedServiceRequestConfig.endpointMode,
      apiKey: managedServiceRequestConfig.apiKey,
      apiUrl: managedServiceRequestConfig.apiUrl,
    };
  }

  return {
    provider: managedServiceRequestConfig.provider,
    endpointMode: managedServiceRequestConfig.endpointMode,
    apiKey: managedServiceRequestConfig.apiKey,
    apiUrl: managedServiceRequestConfig.apiUrl,
  };
}

export function setActiveConfigTab(tabName = "services") {
  const tabs = document.querySelectorAll(".config-tab[data-tab]");
  const panels = document.querySelectorAll(".config-tab-panel[data-panel]");
  if (!tabs.length || !panels.length) return;

  const target = typeof tabName === "string" ? tabName : "services";
  const hasTarget = Array.from(tabs).some((tab) => tab.dataset.tab === target);
  const finalTab = hasTarget ? target : "services";

  tabs.forEach((tab) => {
    const active = tab.dataset.tab === finalTab;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });

  panels.forEach((panel) => {
    const active = panel.dataset.panel === finalTab;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
  closeModelDropdown("main");
  closeModelDropdown("Title");
  closeAllConfigSelectPickers();

  if (elements.configContent) {
    elements.configContent.scrollTop = 0;
  }
}

export function openConfigModal(tabName = "services") {
  if (!elements.configModal) return;
  setActiveConfigTab(typeof tabName === "string" ? tabName : "services");
  renderServiceManagementUi();
  syncAllConfigSelectPickers();
  elements.configModal.classList.add("open");
  elements.configModal.setAttribute("aria-hidden", "false");
  syncBodyScrollLock();
  updateModelHint();
  updateModelHint("Title");
  syncRoleSettingPreview(true);
  updateConfigStatusStrip();
  scheduleFetchModels("main", 0);
  scheduleFetchModels("Title", 0);
}

export function closeConfigModal() {
  if (!elements.configModal) return;
  if (hasUnsavedConfigChanges()) {
    void persistCurrentServiceForm({
      showFeedback: false,
      closeAfterSave: false,
    });
  }
  elements.configModal.classList.remove("open");
  elements.configModal.setAttribute("aria-hidden", "true");
  syncBodyScrollLock();
  closeModelDropdown("main");
  closeAllConfigSelectPickers();
}

export function showRoleSettingEditor(focus = false) {
  if (!elements.roleSetting || !elements.roleSettingPreview) return;
  elements.roleSetting.hidden = false;
  elements.roleSettingPreview.hidden = true;
  if (!focus) return;
  requestAnimationFrame(() => {
    elements.roleSetting?.focus();
    const len = elements.roleSetting?.value?.length || 0;
    elements.roleSetting?.setSelectionRange(len, len);
  });
}

export function showRoleSettingPreview() {
  if (!elements.roleSetting || !elements.roleSettingPreview) return;
  const text = (elements.roleSetting.value || "").trim();
  if (!text) {
    showRoleSettingEditor(false);
    return;
  }
  renderMarkdownToElement(elements.roleSettingPreview, text);
  elements.roleSetting.hidden = true;
  elements.roleSettingPreview.hidden = false;
}

export function syncRoleSettingPreview(preferPreview = true) {
  const text = (elements.roleSetting?.value || "").trim();
  if (preferPreview && text) {
    showRoleSettingPreview();
    return;
  }
  showRoleSettingEditor(false);
}

export function updateProviderUi() {
  const { selection, provider } = getEffectiveProviderConfig();
  const endpointHintEl = elements.endpointModeHint;

  if (endpointHintEl) {
    endpointHintEl.classList.toggle(
      "is-warning",
      provider !== "openai" && provider !== "gemini"
    );
    if (selection === "openai_responses") {
      endpointHintEl.textContent =
        "使用 OpenAI /v1/responses。API 地址建议只填根地址，版本和接口路径会自动补全。";
    } else if (selection === "gemini") {
      endpointHintEl.textContent =
        "使用 Gemini 原生接口。API 地址建议只填根地址，v1beta 等版本路径会自动处理。";
    } else if (selection === "anthropic") {
      endpointHintEl.textContent =
        "使用 Anthropic /v1/messages。API 地址建议只填根地址，接口路径会自动补全。";
    } else {
      endpointHintEl.textContent =
        "使用 OpenAI /v1/chat/completions。API 地址建议只填根地址，版本和接口路径会自动补全。";
    }
  }

  updateApiUrlPlaceholder();
  syncApiKeyPlaceholder();
  updateModelHint();
  updateWebSearchProviderUi();
}

export function updateApiUrlPlaceholder() {
  const urlInput = elements.apiUrl;
  if (!urlInput) return;
  const providerConfig = getEffectiveProviderConfig();
  if (providerConfig.provider === "gemini") {
    urlInput.placeholder =
      "填写根地址，如 https://generativelanguage.googleapis.com";
    return;
  }
  if (providerConfig.provider === "anthropic") {
    urlInput.placeholder = "填写根地址，如 https://api.anthropic.com";
    return;
  }
  urlInput.placeholder = "填写根地址，如 https://api.openai.com";
}

export function resolveModelDisplayName(modelId) {
  return (modelId || "").trim();
}

export function updateModelNames() {
  const activeService = getActiveService();
  const liveModelValue = isEditingActiveService()
    ? getEffectiveModelValue()
    : String(activeService?.model?.model || "").trim();
  const modelId = liveModelValue;
  const displayName = resolveModelDisplayName(modelId);
  const serviceName = activeService
    ? getServiceDisplayName(activeService)
    : "当前服务";
  elements.modelName.textContent = displayName || "选择模型";
  elements.modelName.classList.toggle("is-placeholder", !displayName);

  if (elements.serviceNameLabel) {
    if (activeService) {
      elements.serviceNameLabel.textContent = serviceName;
      elements.serviceNameLabel.style.display = "";
      if (elements.serviceModelDivider) {
        elements.serviceModelDivider.style.display = "";
      }
    } else {
      elements.serviceNameLabel.style.display = "none";
      if (elements.serviceModelDivider) {
        elements.serviceModelDivider.style.display = "none";
      }
    }
  }
  const modelLine = elements.modelName.closest(".brand-model");
  if (modelLine) {
    modelLine.style.display = "";
  }
  if (isHeaderModelDropdownOpen()) {
    renderHeaderModelDropdown();
  }
}

export function getConfig(side) {
  const activeService = getActiveService();
  const activeServiceRequestConfig = getActiveServiceModelRequestConfig();
  const usingLiveActiveServiceForm = isEditingActiveService();
  const liveModelValue =
    usingLiveActiveServiceForm
      ? getEffectiveModelValue()
      : String(activeService?.model?.model || "").trim();
  const liveRoleSetting =
    usingLiveActiveServiceForm
      ? String(elements.roleSetting?.value || activeService?.model?.systemPrompt || "")
      : String(activeService?.model?.systemPrompt || "");
  const liveTitleModelValue =
    usingLiveActiveServiceForm
      ? String(
          elements.titleGenerationModel
            ? elements.titleGenerationModel.value
            : activeService?.model?.titleModel || ""
        )
      : String(activeService?.model?.titleModel || "");

  if (side === "Title") {
    return {
      provider: activeServiceRequestConfig.provider,
      endpointMode: activeServiceRequestConfig.endpointMode,
      apiKey: activeServiceRequestConfig.apiKey || "",
      model: liveTitleModelValue,
      serviceName: activeService ? getServiceDisplayName(activeService) : "当前服务",
      apiUrl: String(activeServiceRequestConfig.apiUrl || "").trim(),
      systemPrompt: "",
      reasoningEffort: "none",
    };
  }

  return {
    provider: activeServiceRequestConfig.provider,
    endpointMode: activeServiceRequestConfig.endpointMode,
    apiKey: activeServiceRequestConfig.apiKey || "",
    model: liveModelValue,
    serviceName: activeService ? getServiceDisplayName(activeService) : "当前服务",
    apiUrl: String(activeServiceRequestConfig.apiUrl || "").trim(),
    systemPrompt: liveRoleSetting,
    reasoningEffort: getReasoningEffortValue(),
  };
}

export function getWebSearchConfig() {
  const toolMode = getCurrentWebSearchToolMode();
  const maxResults = parseInt(elements.tavilyMaxResults?.value, 10);
  return {
    endpointMode: getEffectiveEndpointModeValue(),
    toolMode,
    enabled: isWebSearchEnabled(),
    provider:
      toolMode === "builtin"
        ? normalizeExternalWebSearchProvider(elements.webSearchProvider?.value)
        : toolMode,
    tavilyApiKey: (elements.tavilyApiKey?.value || "").trim(),
    exaApiKey: (elements.exaApiKey?.value || "").trim(),
    exaSearchType: normalizeExaSearchType(elements.exaSearchType?.value),
    maxResults: maxResults >= 1 && maxResults <= 20 ? maxResults : 5,
    searchDepth: normalizeTavilySearchDepth(elements.tavilySearchDepth?.value),
  };
}

function getDesktopConfig() {
  return {
    closeToTrayOnClose: getCloseToTrayOnCloseValue(),
  };
}

export function loadConfig() {
  const store = readConfigStore();
  let pendingWebSearchToolMode = null;

  try {
    const ensuredServices = ensureServicesWithDraft(
      cloneValue(store.services),
      store.activeServiceId,
      store.activeServiceId
    );
    state.services = ensuredServices.services;
    state.activeServiceId = ensuredServices.activeServiceId;
    state.serviceManagerSelectedId = ensuredServices.serviceManagerSelectedId;

    if (ensuredServices.createdDraft) {
      persistState({
        services: state.services,
        activeServiceId: state.activeServiceId,
        webSearch: store.webSearch,
        desktop: store.desktop,
      });
    }

    const pendingWebSearchEnabled = store.webSearch?.enabled === true;
    if (store.webSearch) {
      const normalizedProvider = normalizeExternalWebSearchProvider(
        store.webSearch.provider
      );
      if (elements.webSearchProvider) {
        elements.webSearchProvider.value = normalizedProvider;
      }
      pendingWebSearchToolMode =
        store.webSearch.toolMode || normalizedProvider;
      if (elements.tavilyApiKey) {
        elements.tavilyApiKey.value = store.webSearch.tavilyApiKey || "";
      }
      if (elements.exaApiKey) {
        elements.exaApiKey.value = store.webSearch.exaApiKey || "";
      }
      if (elements.exaSearchType) {
        elements.exaSearchType.value = normalizeExaSearchType(
          store.webSearch.exaSearchType
        );
      }
      if (elements.tavilyMaxResults) {
        elements.tavilyMaxResults.value = store.webSearch.maxResults || 5;
      }
      if (elements.tavilySearchDepth) {
        elements.tavilySearchDepth.value = normalizeTavilySearchDepth(
          store.webSearch.searchDepth
        );
      }
    } else if (elements.webSearchProvider) {
      elements.webSearchProvider.value = "tavily";
      if (elements.exaSearchType) elements.exaSearchType.value = "auto";
      pendingWebSearchToolMode = "tavily";
      if (elements.exaSearchType) {
        elements.exaSearchType.value = "auto";
      }
    }

    const closeToTrayOnClose = getCloseToTrayOnCloseValue(store);
    if (elements.closeToTrayOnClose) {
      elements.closeToTrayOnClose.checked = closeToTrayOnClose;
    }

    if (getManagedService()) {
      applyManagedServiceConnectionToForm(getManagedService());
      applyActiveRoleSettingToForm(getManagedService());
    } else {
      applyEmptyServiceStateToForm();
    }
    const activeService = getActiveService();
    const preferredWebSearchState = resolvePreferredWebSearchState(
      activeService?.model || {},
      {
        currentMode: pendingWebSearchToolMode,
        currentEnabled: pendingWebSearchEnabled,
      }
    );

    setWebSearchToolMode(
      preferredWebSearchState.toolMode ||
        getPreferredWebSearchToolMode(activeService?.model || {}) ||
        pendingWebSearchToolMode ||
        "tavily",
      {
      persist: false,
      }
    );
    setWebSearchEnabled(preferredWebSearchState.enabled, { persist: false });
  } catch (error) {
    console.error("加载配置失败:", error);
  }

  renderServiceManagementUi();
  syncAllConfigSelectPickers();
  updateProviderUi();
  void syncDesktopPreferences({
    closeToTray: getCloseToTrayOnCloseValue(store),
  });
  updateWebSearchProviderUi();
  updateConfigStatusStrip();
}

export async function clearConfig() {
  const confirmed = await showConfirm("确定要清除所有配置吗？", {
    title: "清除配置",
    okText: "清除",
    danger: true,
    hint: "此操作会重置当前页面所有本地配置",
  });
  if (!confirmed) return;

  const ensuredServices = ensureServicesWithDraft([]);
  state.services = ensuredServices.services;
  state.activeServiceId = ensuredServices.activeServiceId;
  state.serviceManagerSelectedId = ensuredServices.serviceManagerSelectedId;

  setWebSearchEnabled(false, { persist: false });
  if (elements.webSearchProvider) elements.webSearchProvider.value = "tavily";
  setWebSearchToolMode("tavily", { persist: false });
  if (elements.tavilyApiKey) elements.tavilyApiKey.value = "";
  if (elements.exaApiKey) elements.exaApiKey.value = "";
  if (elements.exaSearchType) elements.exaSearchType.value = "auto";
  if (elements.tavilyMaxResults) elements.tavilyMaxResults.value = 5;
  if (elements.tavilySearchDepth) elements.tavilySearchDepth.value = "basic";
  if (elements.closeToTrayOnClose) {
    elements.closeToTrayOnClose.checked = DEFAULT_CLOSE_TO_TRAY_ON_CLOSE;
  }

  persistState({
    services: state.services,
    activeServiceId: state.activeServiceId,
    webSearch: {
      enabled: false,
      toolMode: "tavily",
      provider: "tavily",
      tavilyApiKey: "",
      exaApiKey: "",
      exaSearchType: "auto",
      maxResults: 5,
      searchDepth: "basic",
    },
    desktop: { closeToTrayOnClose: DEFAULT_CLOSE_TO_TRAY_ON_CLOSE },
  });

  syncRoleSettingPreview(false);
  renderServiceManagementUi();
  syncAllConfigSelectPickers();
  updateProviderUi();
  updateWebSearchProviderUi();
  updateModelNames();
  updateConfigStatusStrip();
  await syncDesktopPreferences({
    closeToTray: DEFAULT_CLOSE_TO_TRAY_ON_CLOSE,
  });
  await showAlert("配置已清除", {
    title: "操作完成",
  });
  closeConfigModal();
}

export async function handleCurrentServiceChange(nextServiceId, options = {}) {
  const nextId = String(nextServiceId || "");
  const syncManagerSelection = options.syncManagerSelection !== false;
  if (!nextId || nextId === state.activeServiceId) {
    return false;
  }

  if (!hasUnsavedManagedServiceChanges()) {
    return setActiveServiceLocally(nextId, {
      syncManagerSelection,
      refreshModelList: false,
    });
  }

  const shouldSave = await showConfirm("当前编辑服务有未保存修改，是否先保存？", {
    title: "未保存修改",
    okText: "保存并切换",
    cancelText: "继续切换",
    hint: "继续切换会进入下一步确认。",
  });
  if (shouldSave) {
    const saved = await persistCurrentServiceForm({
      showFeedback: false,
      closeAfterSave: false,
    });
    if (!saved) {
      return false;
    }
    return setActiveServiceLocally(nextId, {
      syncManagerSelection,
      refreshModelList: false,
    });
  }

  const shouldDiscard = await showConfirm("切换后将丢失当前编辑中的未保存修改，是否继续？", {
    title: "放弃修改",
    okText: "继续切换",
    cancelText: "取消",
    danger: true,
  });
  if (!shouldDiscard) {
    return false;
  }

  return setActiveServiceLocally(nextId, {
    syncManagerSelection,
    refreshModelList: false,
  });
}

export async function createService() {
  const service = createDraftService();
  state.services = [service, ...state.services];
  state.serviceManagerSelectedId = service.id;
  persistState({
    services: state.services,
    activeServiceId: state.activeServiceId || service.id,
  });
  renderServiceManagementUi();
  focusServiceNameInput();
}

export async function duplicateService() {
  const service = getManagedService();
  if (!service) return;
  const duplicated = normalizeService({
    ...cloneValue(service),
    id: createId(),
    name: getUniqueServiceName(`${getServiceDisplayName(service)} 副本`),
    connectivity: createConnectivityState(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  state.services = [duplicated, ...state.services];
  state.serviceManagerSelectedId = duplicated.id;
  persistState({
    services: state.services,
    activeServiceId: state.activeServiceId,
  });
  renderServiceManagementUi();
  focusServiceNameInput();
}

export async function deleteService() {
  const service = getManagedService();
  if (!service) return;
  const confirmed = await showConfirm(`确定要删除服务「${getServiceDisplayName(service)}」吗？`, {
    title: "删除服务",
    okText: "删除",
    danger: true,
  });
  if (!confirmed) return;

  if (service.id === state.serviceManagerSelectedId && hasUnsavedManagedServiceChanges()) {
    const shouldDiscard = await showConfirm(
      "该服务有未保存修改，删除后这些修改将丢失，是否继续？",
      {
        title: "放弃未保存修改",
        okText: "继续删除",
        cancelText: "取消",
        danger: true,
      }
    );
    if (!shouldDiscard) return;
  }

  state.services = state.services.filter((item) => item.id !== service.id);
  const ensuredServices = ensureServicesWithDraft(
    state.services,
    state.activeServiceId === service.id ? null : state.activeServiceId,
    state.serviceManagerSelectedId === service.id
      ? null
      : state.serviceManagerSelectedId
  );
  state.services = ensuredServices.services;
  state.activeServiceId = ensuredServices.activeServiceId;
  state.serviceManagerSelectedId = ensuredServices.serviceManagerSelectedId;
  persistState({
    services: state.services,
    activeServiceId: state.activeServiceId,
  });
  renderServiceManagementUi();
  scheduleFetchModels("main", 0);
  scheduleFetchModels("Title", 0);
  updateModelNames();
  updateConfigStatusStrip();
}

function updateServiceConnectivity(serviceId, payload) {
  const current = getServiceById(serviceId);
  if (!current) return;
  const nextConnectivity = {
    ...createConnectivityState(),
    ...(current.connectivity || {}),
    ...payload,
  };
  replaceService({
    ...current,
    connectivity: nextConnectivity,
  });
  persistState({
    services: state.services,
    activeServiceId: state.activeServiceId,
  });
  renderServiceManagementUi();
  scheduleServiceConnectivityAutoHide(serviceId, nextConnectivity);
}

export async function testSelectedServiceConnection() {
  const service = getManagedService();
  if (!service) {
    clearTransientConnectivityHideTimer();
    renderServiceConnectivityState(
      createConnectivityState("idle", "请先选择或新建一个服务，再测试连接。", 0),
      true
    );
    return;
  }
  const hasDraftChanges = hasUnsavedManagedServiceConnectionChanges();
  const draftService = hasDraftChanges
    ? readManagedServiceConnectionFromForm(service)
    : service;

  if (hasDraftChanges) {
    const transientTestingState = createConnectivityState(
      "testing",
      "正在尝试拉取模型列表…",
      0
    );
    clearTransientConnectivityHideTimer();
    renderServiceConnectivityState(transientTestingState, true);
  } else {
    updateServiceConnectivity(service.id, {
      status: "testing",
      message: "正在尝试拉取模型列表…",
    });
  }

  try {
    const { ids, connectivityMode, message } = await fetchModelsOnce(
      draftService.model
    );
    const successMessage =
      connectivityMode === "messages_probe"
        ? message || "模型列表接口不可用，但已通过 Messages 接口验证连接。"
        : `成功拉取 ${ids.length} 个模型。`;
    if (hasDraftChanges) {
      const transientSuccessState = createConnectivityState(
        "success",
        successMessage,
        Date.now()
      );
      renderServiceConnectivityState(transientSuccessState, true);
      scheduleTransientConnectivityAutoHide(service.id, transientSuccessState);
    } else {
      updateServiceConnectivity(service.id, {
        status: "success",
        message: successMessage,
        testedAt: Date.now(),
      });
    }
  } catch (error) {
    if (hasDraftChanges) {
      const transientErrorState = createConnectivityState(
        "error",
        error?.message || "测试失败",
        Date.now()
      );
      renderServiceConnectivityState(transientErrorState, true);
      scheduleTransientConnectivityAutoHide(service.id, transientErrorState);
    } else {
      updateServiceConnectivity(service.id, {
        status: "error",
        message: error?.message || "测试失败",
        testedAt: Date.now(),
      });
    }
  }
}
