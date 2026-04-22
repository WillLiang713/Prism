import {
  state,
  elements,
  STORAGE_KEYS,
  resolveProviderSelection,
  createId,
  formatTime,
  isDesktopRuntime,
} from './state.js';
import { t } from './i18n.js';
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
  syncTitleModelFollowPresentation,
} from './models.js';
import { renderMarkdownToElement } from './markdown.js';
import {
  getCurrentWebSearchToolMode,
  isWebSearchEnabled,
  normalizeExternalWebSearchProvider,
  normalizeTavilySearchDepth,
  normalizeExaSearchType,
  setWebSearchEnabled,
  setWebSearchToolMode,
  updateConfigStatusStrip,
  updateWebSearchProviderUi,
} from './web-search.js';
import { syncDesktopPreferences } from './desktop.js';
import { updateTheme } from './ui.js';
import { updateLayoutUi } from './layout.js';

const CONFIG_STORE_VERSION = 2;
const CONFIG_BACKUP_SCHEMA = "prism-config-backup";
const CONFIG_BACKUP_VERSION = 1;
const LEGACY_DEFAULT_SERVICE_NAME = "默认服务";
const UNNAMED_SERVICE_LABEL = "新服务";
const DEFAULT_REASONING_EFFORT = "high";
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

function formatLocalDateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function triggerTextDownload(text, fileName, mimeType = "application/json;charset=utf-8") {
  const blob = new Blob([text], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1000);
}

function getDesktopDialogSave() {
  if (!isDesktopRuntime()) return null;
  return window.__TAURI__?.dialog?.save || null;
}

function getDesktopFsWriteFile() {
  if (!isDesktopRuntime()) return null;
  return window.__TAURI__?.fs?.writeFile || null;
}

async function saveTextWithDesktopApi(text, fileName) {
  const save = getDesktopDialogSave();
  const writeFile = getDesktopFsWriteFile();
  if (typeof save !== "function" || typeof writeFile !== "function") {
    throw new Error(t("导出配置失败"));
  }

  const savePath = await save({
    defaultPath: fileName,
    filters: [
      {
        name: "JSON",
        extensions: ["json"],
      },
    ],
  });
  if (!savePath) {
    return false;
  }

  const bytes = new TextEncoder().encode(text);
  await writeFile(savePath, bytes);
  return true;
}

function resetImportConfigInput() {
  if (elements.importConfigInput) {
    elements.importConfigInput.value = "";
  }
}

function readImportConfigFile() {
  const input = elements.importConfigInput;
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(t("导入配置失败"));
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      input.removeEventListener("change", handleChange);
      input.removeEventListener("cancel", handleCancel);
    };

    const handleChange = async () => {
      cleanup();
      const [file] = Array.from(input.files || []);
      resetImportConfigInput();
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const text = await file.text();
        resolve(text);
      } catch (error) {
        reject(error);
      }
    };

    const handleCancel = () => {
      cleanup();
      resetImportConfigInput();
      resolve(null);
    };

    input.addEventListener("change", handleChange, { once: true });
    input.addEventListener("cancel", handleCancel, { once: true });
    input.click();
  });
}

function getCurrentThemeValue() {
  const storedTheme = localStorage.getItem(STORAGE_KEYS.theme);
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }
  return state.theme === "dark" ? "dark" : "light";
}

function getCurrentSidebarCollapsedValue() {
  const storedValue = localStorage.getItem(STORAGE_KEYS.isSidebarCollapsed);
  if (storedValue === "true") return true;
  if (storedValue === "false") return false;
  return state.isSidebarCollapsed === true;
}

function buildConfigBackupPayload() {
  const store = readConfigStore();
  return {
    schema: CONFIG_BACKUP_SCHEMA,
    version: CONFIG_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    payload: {
      config: cloneValue(store),
      theme: getCurrentThemeValue(),
      isSidebarCollapsed: getCurrentSidebarCollapsedValue(),
    },
  };
}

function parseConfigBackupPayload(rawText) {
  let parsed = null;
  try {
    parsed = JSON.parse(rawText);
  } catch (_error) {
    throw new Error(t("配置文件解析失败"));
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(t("配置文件格式不正确"));
  }

  const payload =
    parsed.schema === CONFIG_BACKUP_SCHEMA
      ? parsed.payload
      : parsed;

  if (!payload || typeof payload !== "object") {
    throw new Error(t("配置文件格式不正确"));
  }

  const configSource =
    payload.config !== undefined ? payload.config : payload;

  return {
    config: normalizeConfigStore(configSource),
    theme:
      payload.theme === "light" || payload.theme === "dark"
        ? payload.theme
        : null,
    isSidebarCollapsed:
      typeof payload.isSidebarCollapsed === "boolean"
        ? payload.isSidebarCollapsed
        : null,
  };
}

async function applyImportedConfigBackup(backup) {
  writeConfigStore(backup.config);

  if (backup.theme === "light" || backup.theme === "dark") {
    updateTheme(backup.theme);
  }

  if (typeof backup.isSidebarCollapsed === "boolean") {
    state.isSidebarCollapsed = backup.isSidebarCollapsed;
    localStorage.setItem(
      STORAGE_KEYS.isSidebarCollapsed,
      String(backup.isSidebarCollapsed)
    );
    updateLayoutUi();
  }

  loadConfig();
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

function createDefaultRuntimeModelConfig() {
  return {
    model: "",
    modelServiceId: "",
    titleModel: "",
    titleModelServiceId: "",
    systemPrompt: "",
    reasoningEffort: DEFAULT_REASONING_EFFORT,
  };
}

function normalizeRuntimeModelConfig(rawConfig = {}, fallbackServiceId = "") {
  const base = createDefaultRuntimeModelConfig();
  const runtime = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const resolvedFallbackServiceId = String(fallbackServiceId || "").trim();
  const model = String(runtime.model || "").trim();
  const titleModel = String(runtime.titleModel || "").trim();
  const modelServiceId = String(runtime.modelServiceId || "").trim();
  const titleModelServiceId = String(runtime.titleModelServiceId || "").trim();
  return {
    model,
    modelServiceId: model ? modelServiceId || resolvedFallbackServiceId : "",
    titleModel,
    titleModelServiceId: titleModel
      ? titleModelServiceId || resolvedFallbackServiceId
      : "",
    systemPrompt: String(runtime.systemPrompt || runtime.roleSetting || "").trim(),
    reasoningEffort: normalizeReasoningEffortValue(runtime.reasoningEffort || base.reasoningEffort),
  };
}

function reconcileRuntimeModelConfig(runtimeConfig, services = []) {
  const validServiceIds = new Set(
    (Array.isArray(services) ? services : [])
      .map((service) => String(service?.id || "").trim())
      .filter(Boolean)
  );
  const normalized = normalizeRuntimeModelConfig(runtimeConfig);
  const hasModelSource =
    !normalized.modelServiceId || validServiceIds.has(normalized.modelServiceId);
  const hasTitleSource =
    !normalized.titleModelServiceId || validServiceIds.has(normalized.titleModelServiceId);
  return {
    ...normalized,
    model: hasModelSource ? normalized.model : "",
    modelServiceId: hasModelSource ? normalized.modelServiceId : "",
    titleModel: hasTitleSource ? normalized.titleModel : "",
    titleModelServiceId: hasTitleSource ? normalized.titleModelServiceId : "",
  };
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
      preferBuiltinWebSearch: false,
      apiKey: "",
      model: "",
      modelServiceId: "",
      titleModel: "",
      titleModelServiceId: "",
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
  serviceManagerSelectedId = null,
  legacyActiveServiceId = null
) {
  const list = Array.isArray(services) ? services.filter(Boolean) : [];
  if (!list.length) {
    const draftService = createDraftService();
    return {
      services: [draftService],
      serviceManagerSelectedId: draftService.id,
      createdDraft: true,
    };
  }

  const preferredId = String(serviceManagerSelectedId || legacyActiveServiceId || "").trim();
  const hasSelectedService = list.some((service) => service.id === preferredId);

  return {
    services: list,
    serviceManagerSelectedId: hasSelectedService ? preferredId : list[0].id,
    createdDraft: false,
  };
}

function createConfigStoreShape(rawConfig = {}, overrides = {}) {
  const nextServices = Array.isArray(overrides.services) ? overrides.services : [];
  const preferredServiceId =
    overrides.serviceManagerSelectedId === undefined
      ? rawConfig.serviceManagerSelectedId || rawConfig.activeServiceId || null
      : overrides.serviceManagerSelectedId;
  const runtimeSource =
    overrides.runtime && typeof overrides.runtime === "object"
      ? overrides.runtime
      : rawConfig.runtime && typeof rawConfig.runtime === "object"
      ? rawConfig.runtime
      : {};
  return {
    version: CONFIG_STORE_VERSION,
    serviceManagerSelectedId:
      preferredServiceId === undefined ? null : preferredServiceId,
    services: nextServices,
    runtime: reconcileRuntimeModelConfig(runtimeSource, nextServices),
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
      preferBuiltinWebSearch:
        service?.model?.preferBuiltinWebSearch === true,
      apiKey: String(service?.model?.apiKey || ""),
      model: String(service?.model?.model || ""),
      modelServiceId: String(service?.model?.modelServiceId || ""),
      titleModel: String(service?.model?.titleModel || ""),
      titleModelServiceId: String(service?.model?.titleModelServiceId || ""),
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
        preferBuiltinWebSearch: false,
        apiKey: legacyModelConfig.apiKey || "",
        model: legacyModelConfig.model || "",
        modelServiceId: "",
        titleModel: legacyModelConfig.titleModel || rawConfig.titleModel || "",
        titleModelServiceId: "",
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
    serviceManagerSelectedId: migratedService.id,
    services: [migratedService],
    runtime: {
      model: legacyModelConfig.model || "",
      modelServiceId: legacyModelConfig.model ? migratedService.id : "",
      titleModel: legacyModelConfig.titleModel || rawConfig.titleModel || "",
      titleModelServiceId:
        legacyModelConfig.titleModel || rawConfig.titleModel ? migratedService.id : "",
      systemPrompt:
        legacyModelConfig.systemPrompt || legacyModelConfig.roleSetting || "",
      reasoningEffort: rawConfig.reasoningEffort || DEFAULT_REASONING_EFFORT,
    },
  });
}

function normalizeConfigStore(rawConfig = {}) {
  if (Array.isArray(rawConfig?.services)) {
    const services = rawConfig.services
      .map((service, index) => normalizeService(service, index))
      .filter((service) => !isEffectivelyEmptyService(service));
    const preferredServiceId =
      rawConfig.serviceManagerSelectedId || rawConfig.activeServiceId || null;
    const selectedExists =
      preferredServiceId &&
      services.some((service) => service.id === preferredServiceId);
    const fallbackServiceId =
      (selectedExists ? preferredServiceId : services[0]?.id) || null;
    return createConfigStoreShape(rawConfig, {
      serviceManagerSelectedId:
        selectedExists ? preferredServiceId : services[0]?.id || null,
      services,
      runtime: normalizeRuntimeModelConfig(
        rawConfig.runtime,
        fallbackServiceId
      ),
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
  const normalizedBase = String(baseName || "").trim() || t("新服务");
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
  return String(rawName || "").trim() || t(UNNAMED_SERVICE_LABEL);
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
      activeBtn.dataset.label || "";
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
    String(service?.model?.modelServiceId || "").trim() === "" &&
    String(service?.model?.titleModel || "").trim() === "" &&
    String(service?.model?.titleModelServiceId || "").trim() === "" &&
    String(service?.model?.apiUrl || "").trim() === "" &&
    String(service?.model?.systemPrompt || "").trim() === ""
  );
}

function hasEffectiveApiKeyValue() {
  return !!String(elements.apiKey?.value || "").trim();
}

function syncApiKeyPlaceholder() {
  if (!elements.apiKey) return;
  elements.apiKey.placeholder = t("输入API密钥");
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

function getEditingService() {
  return getServiceById(state.serviceManagerSelectedId) || state.services[0] || null;
}

function getManagedService() {
  return getEditingService();
}

function isConfigModalOpen() {
  return elements.configModal?.classList.contains("open") === true;
}

function isLiveEditingService(serviceId = "") {
  const normalizedServiceId = String(serviceId || "").trim();
  if (!normalizedServiceId || !isConfigModalOpen()) return false;
  return String(getEditingService()?.id || "") === normalizedServiceId;
}

function setServiceFormDisabled(disabled) {
  const controls = [
    elements.serviceNameInput,
    elements.provider,
    elements.providerPickerInput,
    elements.providerPickerBtn,
    elements.builtinWebSearch,
    elements.builtinWebSearchPickerInput,
    elements.builtinWebSearchPickerBtn,
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
    preferBuiltinWebSearch: elements.builtinWebSearch?.value === "true",
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
    preferBuiltinWebSearch: service.model?.preferBuiltinWebSearch === true,
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
    preferBuiltinWebSearch: elements.builtinWebSearch?.value === "true",
    apiKey: String(elements.apiKey?.value || ""),
    apiUrl: normalizeApiUrlForProvider(
      elements.apiUrl?.value || "",
      getEffectiveProviderValue()
    ),
  };
}

function getServiceFormStoreSnapshot(service) {
  if (!service) return null;
  return {
    name: String(service.name || "").trim(),
    providerSelection: String(service.model?.providerSelection || ""),
    endpointMode: String(service.model?.endpointMode || ""),
    preferBuiltinWebSearch: service.model?.preferBuiltinWebSearch === true,
    apiKey: String(service.model?.apiKey || ""),
    apiUrl: String(service.model?.apiUrl || ""),
  };
}

function getActiveServiceModelFormValue() {
  return String(elements.model?.value || "");
}

function getActiveServiceModelSourceIdFormValue() {
  return String(elements.model?.dataset?.serviceId || "").trim();
}

function getActiveServiceTitleModelFormValue() {
  return String(elements.titleGenerationModel?.value || "");
}

function getActiveServiceTitleModelSourceIdFormValue() {
  return String(elements.titleGenerationModel?.dataset?.serviceId || "").trim();
}

function getActiveRoleSettingFormValue() {
  return String(elements.roleSetting?.value || "");
}

function getRuntimeModelConfigFromForm() {
  return reconcileRuntimeModelConfig({
    model: getActiveServiceModelFormValue(),
    modelServiceId:
      getActiveServiceModelSourceIdFormValue() ||
      String(state.serviceManagerSelectedId || "").trim(),
    titleModel: getActiveServiceTitleModelFormValue(),
    titleModelServiceId:
      getActiveServiceTitleModelSourceIdFormValue() ||
      String(state.serviceManagerSelectedId || "").trim(),
    systemPrompt: getActiveRoleSettingFormValue(),
    reasoningEffort: getReasoningEffortValue(),
  }, state.services);
}

function getRuntimeModelConfigFromState() {
  return reconcileRuntimeModelConfig(state.runtimeModelConfig, state.services);
}

export function getRuntimeModelConfig(preferLiveForm = true) {
  if (preferLiveForm && isConfigModalOpen()) {
    return getRuntimeModelConfigFromForm();
  }
  return getRuntimeModelConfigFromState();
}

function getRuntimeModelStoreSnapshot() {
  const runtimeConfig = getRuntimeModelConfigFromState();
  return {
    model: runtimeConfig.model,
    modelServiceId: runtimeConfig.modelServiceId,
    titleModel: runtimeConfig.titleModel,
    titleModelServiceId: runtimeConfig.titleModelServiceId,
    systemPrompt: runtimeConfig.systemPrompt,
    reasoningEffort: runtimeConfig.reasoningEffort,
  };
}

function hasUnsavedManagedServiceChanges() {
  const managedService = getManagedService();
  const hasServiceChanges = managedService
    ? (
    JSON.stringify(getManagedServiceFormSnapshot()) !==
      JSON.stringify(getServiceFormStoreSnapshot(managedService))
    )
    : false;
  const hasRuntimeChanges =
    JSON.stringify(getRuntimeModelConfigFromForm()) !==
    JSON.stringify(getRuntimeModelStoreSnapshot());
  return hasServiceChanges || hasRuntimeChanges;
}

function hasUnsavedConfigChanges() {
  return hasUnsavedManagedServiceChanges();
}

function setModelSourceInputServiceId(inputEl, serviceId) {
  if (!(inputEl instanceof HTMLElement)) return;
  const nextId = String(serviceId || "").trim();
  if (nextId) {
    inputEl.dataset.serviceId = nextId;
  } else {
    delete inputEl.dataset.serviceId;
  }
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
  if (elements.builtinWebSearch) {
    elements.builtinWebSearch.value = service.model?.preferBuiltinWebSearch === true
      ? "true"
      : "false";
  }
  syncConfigSelectPicker("provider");
  syncConfigSelectPicker("builtinWebSearch");
  updateProviderUi();
}

function applyRuntimeModelConfigToForm(runtimeConfig = null) {
  const resolvedRuntimeConfig = reconcileRuntimeModelConfig(
    runtimeConfig || state.runtimeModelConfig,
    state.services
  );
  if (elements.model) {
    elements.model.value = resolvedRuntimeConfig.model || "";
    setModelSourceInputServiceId(
      elements.model,
      resolvedRuntimeConfig.modelServiceId || ""
    );
  }
  if (elements.titleGenerationModel) {
    elements.titleGenerationModel.value = resolvedRuntimeConfig.titleModel || "";
    setModelSourceInputServiceId(
      elements.titleGenerationModel,
      resolvedRuntimeConfig.titleModelServiceId || ""
    );
  }
  if (elements.roleSetting) {
    elements.roleSetting.value = resolvedRuntimeConfig.systemPrompt || "";
  }
  setReasoningEffortValue(resolvedRuntimeConfig.reasoningEffort);
  syncRoleSettingPreview(true);
  updateModelHint("main");
  updateModelHint("Title");
  syncTitleModelFollowPresentation();
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
  if (elements.builtinWebSearch) {
    elements.builtinWebSearch.value = "false";
  }
  if (elements.model) {
    elements.model.value = "";
    setModelSourceInputServiceId(elements.model, "");
  }
  if (elements.titleGenerationModel) {
    elements.titleGenerationModel.value = "";
    setModelSourceInputServiceId(elements.titleGenerationModel, "");
  }
  if (elements.roleSetting) {
    elements.roleSetting.value = "";
  }
  setReasoningEffortValue(DEFAULT_REASONING_EFFORT);

  syncConfigSelectPicker("provider");
  syncConfigSelectPicker("builtinWebSearch");
  syncRoleSettingPreview(false);
  updateProviderUi();
  updateModelHint("main");
  updateModelHint("Title");
  syncTitleModelFollowPresentation();
}

function readManagedServiceConnectionFromForm(existingService = null) {
  const base = existingService ? cloneValue(existingService) : createServiceTemplate();
  const providerConfig = getEffectiveProviderConfig();
  const updatedAt = Date.now();
  const baseModelConfig = cloneValue(base.model || {});
  return normalizeService(
    {
      ...base,
      name: getNormalizedManagedServiceName(base),
      updatedAt,
      model: {
        ...baseModelConfig,
        provider: providerConfig.provider,
        providerSelection: providerConfig.selection,
        endpointMode: providerConfig.endpointMode,
        preferBuiltinWebSearch: elements.builtinWebSearch?.value === "true",
        apiKey: String(elements.apiKey?.value || ""),
        apiUrl: normalizeApiUrlForProvider(
          elements.apiUrl?.value || "",
          providerConfig.provider
        ),
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
  const nextServices = cloneValue(overrides.services ?? state.services ?? persisted.services);
  return {
    ...persisted,
    version: CONFIG_STORE_VERSION,
    serviceManagerSelectedId:
      overrides.serviceManagerSelectedId ??
      state.serviceManagerSelectedId ??
      persisted.serviceManagerSelectedId ??
      persisted.activeServiceId ??
      null,
    services: nextServices,
    runtime: reconcileRuntimeModelConfig(
      cloneValue(overrides.runtime ?? state.runtimeModelConfig ?? persisted.runtime ?? {}),
      nextServices
    ),
    webSearch: cloneValue(overrides.webSearch ?? persisted.webSearch ?? {}),
    desktop: cloneValue(overrides.desktop ?? persisted.desktop ?? {}),
  };
}

function persistState(overrides = {}) {
  const store = getConfigStoreForWrite(overrides);
  writeConfigStore(store);
  state.services = cloneValue(store.services);
  state.serviceManagerSelectedId = store.serviceManagerSelectedId;
  state.runtimeModelConfig = reconcileRuntimeModelConfig(store.runtime, state.services);
  if (!getServiceById(state.serviceManagerSelectedId)) {
    state.serviceManagerSelectedId = state.services[0]?.id || null;
  }
  return store;
}

function getConnectivityLabel(status) {
  const normalized = String(status || "idle").toLowerCase();
  if (normalized === "testing") return t("连接中");
  if (normalized === "success") return t("连接成功");
  if (normalized === "error") return t("连接失败");
  return t("未测试");
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
    ? t("已配置密钥")
    : t("未配置密钥");
  const rows = [
    [t("接口类型"), providerConfig.label],
    [t("默认模型"), service.model?.model || t("未填写")],
    [t("API 地址"), service.model?.apiUrl || t("未填写")],
    [t("密钥状态"), apiKeyHint],
    [t("更新时间"), formatTime(service.updatedAt)],
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
      ? t("测试连接")
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
    applyRuntimeModelConfigToForm();
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
    empty.textContent = t("暂无服务，点击上方“新建”开始配置。");
    elements.serviceList.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  state.services.forEach((service) => {
    const isCurrent = service.id === state.serviceManagerSelectedId;
    const card = document.createElement("div");
    card.className = `service-list-card${isCurrent ? " is-current" : ""}`;
    card.dataset.serviceId = service.id;
    card.dataset.provider = service.model?.provider || "";

    const item = document.createElement("div");
    item.className = "service-list-item";
    item.role = "button";
    item.tabIndex = 0;
    item.addEventListener("click", (event) => {
      if (state.serviceManagerSelectedId === service.id) {
        return;
      }
      void handleManagedServiceSelectionChange(service.id);
    });

    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        item.click();
      }
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
      ).label || t("未配置");

    const subMeta = document.createElement("div");
    subMeta.className = "service-list-submeta";
    subMeta.textContent = String(service.model?.apiUrl || "").trim();

    item.appendChild(head);
    item.appendChild(meta);
    if (subMeta.textContent) {
      item.appendChild(subMeta);
    }
    card.appendChild(item);

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

function syncWebSearchStateWithRuntime(options = {}) {
  const currentToolMode = state.webSearch?.toolMode || getCurrentWebSearchToolMode();
  const currentEnabled = isWebSearchEnabled();

  setWebSearchToolMode(currentToolMode, {
    persist: options.persist !== false,
  });
  setWebSearchEnabled(currentEnabled, {
    persist: options.persist !== false,
  });
}

function setManagedServiceLocally(serviceId, options = {}) {
  const { refreshModelList = true } = options;
  const targetService = getServiceById(serviceId);
  if (!targetService) return false;
  state.serviceManagerSelectedId = targetService.id;
  persistState({
    services: state.services,
    serviceManagerSelectedId: targetService.id,
  });
  renderServiceManagementUi();
  syncAllConfigSelectPickers();
  syncWebSearchStateWithRuntime();
  updateModelNames();
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

  const shouldSave = await showConfirm(t("当前编辑服务有未保存修改，是否先保存？"), {
    title: t("未保存修改"),
    okText: t("保存并切换"),
    cancelText: t("继续切换"),
    hint: t("继续切换会进入下一步确认。"),
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

  const shouldDiscard = await showConfirm(t("切换后将丢失当前编辑中的未保存修改，是否继续？"), {
    title: t("放弃修改"),
    okText: t("继续切换"),
    cancelText: t("取消"),
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
  state.runtimeModelConfig = getRuntimeModelConfigFromForm();

  persistState({
    services: state.services,
    runtime: state.runtimeModelConfig,
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
  applyRuntimeModelConfigToForm();
  updateModelNames();
  updateConfigStatusStrip();
  await syncDesktopPreferences({
    closeToTray: getCloseToTrayOnCloseValue(),
  });
  if (showFeedback) {
    await showAlert(t("配置已保存"), {
      title: t("保存成功"),
    });
  }
  if (closeAfterSave) {
    closeConfigModal();
  }
  return true;
}

export async function applyHeaderModelSelection(serviceId, modelId) {
  const sourceServiceId = String(serviceId || "").trim();
  const nextModelId = String(modelId || "").trim();
  if (!sourceServiceId || !nextModelId) return false;

  if (hasUnsavedConfigChanges()) {
    const saved = await persistCurrentServiceForm({
      showFeedback: false,
      closeAfterSave: false,
    });
    if (!saved) {
      return false;
    }
  }

  const runtimeConfig = getRuntimeModelConfigFromState();
  state.runtimeModelConfig = reconcileRuntimeModelConfig(
    {
      ...runtimeConfig,
      model: nextModelId,
      modelServiceId: sourceServiceId,
    },
    state.services
  );

  persistState({
    serviceManagerSelectedId: state.serviceManagerSelectedId,
    services: state.services,
    runtime: state.runtimeModelConfig,
  });

  applyRuntimeModelConfigToForm();
  syncWebSearchStateWithRuntime({ preferLiveForm: false });
  updateModelNames();
  updateConfigStatusStrip();
  return true;
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
  closeModelDropdown("Title");
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
        t("使用 OpenAI /v1/responses。API 地址建议只填根地址，版本和接口路径会自动补全。");
    } else if (selection === "gemini") {
      endpointHintEl.textContent =
        t("使用 Gemini 原生接口。API 地址建议只填根地址，v1beta 等版本路径会自动处理。");
    } else if (selection === "anthropic") {
      endpointHintEl.textContent =
        t("使用 Anthropic /v1/messages。API 地址建议只填根地址，接口路径会自动补全。");
    } else {
      endpointHintEl.textContent =
        t("使用 OpenAI /v1/chat/completions。API 地址建议只填根地址，版本和接口路径会自动补全。");
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
    urlInput.placeholder = t("填写根地址，如 https://generativelanguage.googleapis.com");
    return;
  }
  if (providerConfig.provider === "anthropic") {
    urlInput.placeholder = t("填写根地址，如 https://api.anthropic.com");
    return;
  }
  urlInput.placeholder = t("填写根地址，如 https://api.openai.com");
}

export function resolveModelDisplayName(modelId) {
  return (modelId || "").trim();
}

function formatCompactModelToken(token) {
  const normalized = String(token || "").trim().toLowerCase();
  if (!normalized) return "";

  const tokenLabels = {
    air: "Air",
    coder: "Coder",
    exp: "Exp",
    flash: "Flash",
    haiku: "Haiku",
    instant: "Instant",
    k2: "K2",
    latest: "Latest",
    lite: "Lite",
    max: "Max",
    mini: "Mini",
    nano: "Nano",
    opus: "Opus",
    plus: "Plus",
    preview: "Preview",
    pro: "Pro",
    r1: "R1",
    sonnet: "Sonnet",
    turbo: "Turbo",
    v3: "V3",
  };

  if (tokenLabels[normalized]) return tokenLabels[normalized];
  if (/^\d+(?:\.\d+)?o$/i.test(normalized)) {
    return `${normalized.slice(0, -1)}o`;
  }
  if (/^\d+(?:\.\d+)?[a-z]?$/i.test(normalized)) return normalized.toUpperCase();
  if (/^[a-z]+\d+$/i.test(normalized)) return normalized.toUpperCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatModelTokenSequence(tokens = []) {
  return tokens.map((token) => formatCompactModelToken(token)).filter(Boolean);
}

function resolveHeaderModelDisplayName(modelId) {
  const rawModelId = String(modelId || "").trim();
  if (!rawModelId) return "";
  if (isDesktopRuntime()) return rawModelId;

  const tailSegment =
    rawModelId.split("/").filter(Boolean).pop()?.split(":", 1)[0] || rawModelId;
  const normalized = tailSegment
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .trim();
  const tokens = normalized.split("-").filter(Boolean);
  if (!tokens.length) return rawModelId;

  if (tokens[0] === "gemini") {
    return ["Gemini", ...formatModelTokenSequence(tokens.slice(1))].join(" ");
  }

  if (tokens[0] === "gpt") {
    return [
      tokens[1] ? `GPT-${tokens[1].toUpperCase()}` : "GPT",
      ...formatModelTokenSequence(tokens.slice(2)),
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (tokens[0] === "claude") {
    let nextIndex = 1;
    let version = "";
    if (tokens[1] && tokens[2] && /^\d+$/.test(tokens[1]) && /^\d+$/.test(tokens[2])) {
      version = `${tokens[1]}.${tokens[2]}`;
      nextIndex = 3;
    } else if (tokens[1] && /^\d+(?:\.\d+)?$/.test(tokens[1])) {
      version = tokens[1];
      nextIndex = 2;
    }
    return ["Claude", version, ...formatModelTokenSequence(tokens.slice(nextIndex))]
      .filter(Boolean)
      .join(" ");
  }

  if (tokens[0] === "deepseek") {
    return ["DeepSeek", ...formatModelTokenSequence(tokens.slice(1))]
      .filter(Boolean)
      .join(" ");
  }

  if (tokens[0] === "qwen") {
    return ["Qwen", ...formatModelTokenSequence(tokens.slice(1))]
      .filter(Boolean)
      .join(" ");
  }

  if (tokens[0] === "kimi") {
    return ["Kimi", ...formatModelTokenSequence(tokens.slice(1))]
      .filter(Boolean)
      .join(" ");
  }

  if (tokens[0] === "glm") {
    return [
      tokens[1] ? `GLM-${tokens[1].toUpperCase()}` : "GLM",
      ...formatModelTokenSequence(tokens.slice(2)),
    ]
      .filter(Boolean)
      .join(" ");
  }

  return rawModelId;
}

function resolveHeaderModelPlaceholder() {
  const shouldUseCompactLabel =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 520px)").matches;

  return shouldUseCompactLabel ? t("模型") : t("选择模型");
}

export function updateModelNames() {
  const runtimeConfig = getRuntimeModelConfig();
  const modelId = String(runtimeConfig.model || "").trim();
  const displayName = resolveHeaderModelDisplayName(modelId);
  elements.modelName.textContent = displayName || resolveHeaderModelPlaceholder();
  elements.modelName.classList.toggle("is-placeholder", !displayName);
  if (elements.headerModelTrigger) {
    elements.headerModelTrigger.removeAttribute("title");
  }

  if (elements.serviceNameLabel) {
    elements.serviceNameLabel.style.display = "none";
    if (elements.serviceModelDivider) {
      elements.serviceModelDivider.style.display = "none";
    }
  }
  const modelLine = elements.modelName.closest(".brand-model");
  if (modelLine) {
    modelLine.style.display = "";
  }
  if (isHeaderModelDropdownOpen()) {
    renderHeaderModelDropdown();
  }
  syncTitleModelFollowPresentation();
}

function getRuntimeSourceService(sourceServiceId) {
  const normalizedSourceId = String(sourceServiceId || "").trim();
  return normalizedSourceId ? getServiceById(normalizedSourceId) : null;
}

function getRuntimeSourceRequestConfig(sourceServiceId) {
  const sourceService = getRuntimeSourceService(sourceServiceId);
  if (!sourceService) {
    return getServiceModelRequestConfig(null);
  }
  if (isLiveEditingService(sourceService.id)) {
    return getLiveServiceRequestConfigFromForm();
  }
  return getServiceModelRequestConfig(sourceService);
}

function getRuntimeSourceServiceName(sourceServiceId) {
  const sourceService = getRuntimeSourceService(sourceServiceId);
  return sourceService ? getServiceDisplayName(sourceService) : "";
}

export function getResolvedRuntimeRequestState(preferLiveForm = true) {
  const runtimeConfig = getRuntimeModelConfig(preferLiveForm);
  const mainModel = String(runtimeConfig.model || "").trim();
  const mainSourceServiceId = mainModel
    ? String(runtimeConfig.modelServiceId || "").trim()
    : "";
  const explicitTitleModel = String(runtimeConfig.titleModel || "").trim();
  const titleModel = explicitTitleModel || mainModel;
  const titleSourceServiceId = explicitTitleModel
    ? String(runtimeConfig.titleModelServiceId || mainSourceServiceId || "").trim()
    : mainSourceServiceId;

  return {
    runtimeConfig,
    mainModel,
    mainSourceServiceId,
    mainSourceConfig: getRuntimeSourceRequestConfig(mainSourceServiceId),
    mainServiceName: getRuntimeSourceServiceName(mainSourceServiceId),
    titleModel,
    titleSourceServiceId,
    titleSourceConfig: getRuntimeSourceRequestConfig(titleSourceServiceId),
    titleServiceName: getRuntimeSourceServiceName(
      titleSourceServiceId || mainSourceServiceId
    ),
  };
}

export function getConfig(side) {
  const runtimeState = getResolvedRuntimeRequestState();

  if (side === "Title") {
    return {
      provider: runtimeState.titleSourceConfig.provider,
      endpointMode: runtimeState.titleSourceConfig.endpointMode,
      apiKey: runtimeState.titleSourceConfig.apiKey || "",
      model: runtimeState.titleModel,
      serviceName: runtimeState.titleServiceName,
      apiUrl: String(runtimeState.titleSourceConfig.apiUrl || "").trim(),
      systemPrompt: "",
      reasoningEffort: "none",
    };
  }

  return {
    provider: runtimeState.mainSourceConfig.provider,
    endpointMode: runtimeState.mainSourceConfig.endpointMode,
    apiKey: runtimeState.mainSourceConfig.apiKey || "",
    model: runtimeState.mainModel,
    serviceName: runtimeState.mainServiceName,
    apiUrl: String(runtimeState.mainSourceConfig.apiUrl || "").trim(),
    systemPrompt: runtimeState.runtimeConfig.systemPrompt,
    reasoningEffort: runtimeState.runtimeConfig.reasoningEffort,
  };
}

export function getWebSearchConfig() {
  const toolMode = getCurrentWebSearchToolMode();
  const runtimeState = getResolvedRuntimeRequestState();
  const maxResults = parseInt(elements.tavilyMaxResults?.value, 10);
  return {
    endpointMode: runtimeState.mainSourceConfig.endpointMode,
    toolMode,
    enabled: isWebSearchEnabled(),
    provider: toolMode,
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
      store.serviceManagerSelectedId || store.activeServiceId,
      store.activeServiceId
    );
    state.services = ensuredServices.services;
    state.serviceManagerSelectedId = ensuredServices.serviceManagerSelectedId;
    state.runtimeModelConfig = reconcileRuntimeModelConfig(
      store.runtime,
      state.services
    );

    if (ensuredServices.createdDraft) {
      persistState({
        services: state.services,
        serviceManagerSelectedId: state.serviceManagerSelectedId,
        runtime: state.runtimeModelConfig,
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
      applyRuntimeModelConfigToForm(store.runtime);
    } else {
      applyEmptyServiceStateToForm();
    }
    setWebSearchToolMode(
      pendingWebSearchToolMode || "tavily",
      {
        persist: false,
      }
    );
    setWebSearchEnabled(pendingWebSearchEnabled, { persist: false });
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

export async function exportConfigBackup() {
  await autoSaveManagedServiceDraft();

  const backup = buildConfigBackupPayload();
  const fileName = `prism-config-${formatLocalDateStamp()}.json`;
  const text = JSON.stringify(backup, null, 2);

  try {
    let saved = false;
    if (isDesktopRuntime()) {
      saved = await saveTextWithDesktopApi(text, fileName);
    } else {
      triggerTextDownload(text, fileName);
      saved = true;
    }

    if (!saved) return;

    await showAlert(t("配置已导出"), {
      title: t("操作完成"),
    });
  } catch (error) {
    console.error("导出配置失败:", error);
    await showAlert(
      error instanceof Error && error.message
        ? error.message
        : t("导出配置失败"),
      {
        title: t("导出失败"),
      }
    );
  }
}

export async function importConfigBackup() {
  try {
    const rawText = await readImportConfigFile();
    if (!rawText) return;

    const backup = parseConfigBackupPayload(rawText);
    const confirmed = await showConfirm(t("导入配置会覆盖当前本地配置，是否继续？"), {
      title: t("导入配置"),
      okText: t("导入配置"),
      cancelText: t("取消"),
      danger: true,
      hint: hasUnsavedConfigChanges()
        ? t("当前编辑中的未保存修改也会丢失")
        : "",
    });
    if (!confirmed) return;

    await applyImportedConfigBackup(backup);
    await showAlert(t("配置已导入"), {
      title: t("导入成功"),
    });
  } catch (error) {
    console.error("导入配置失败:", error);
    await showAlert(
      error instanceof Error && error.message
        ? error.message
        : t("导入配置失败"),
      {
        title: t("导入失败"),
      }
    );
  } finally {
    resetImportConfigInput();
  }
}

export async function clearConfig() {
  const confirmed = await showConfirm(t("确定要清除所有配置吗？"), {
    title: t("清除配置"),
    okText: t("清空"),
    danger: true,
    hint: t("此操作会重置当前页面所有本地配置"),
  });
  if (!confirmed) return;

  const ensuredServices = ensureServicesWithDraft([]);
  state.services = ensuredServices.services;
  state.serviceManagerSelectedId = ensuredServices.serviceManagerSelectedId;
  state.runtimeModelConfig = createDefaultRuntimeModelConfig();

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
    serviceManagerSelectedId: state.serviceManagerSelectedId,
    runtime: state.runtimeModelConfig,
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
  await showAlert(t("配置已清除"), {
    title: t("操作完成"),
  });
  closeConfigModal();
}

export async function createService() {
  const service = createDraftService();
  state.services = [service, ...state.services];
  // 取消自动选中，让用户手动点击卡片进行编辑
  persistState({
    services: state.services,
    serviceManagerSelectedId: state.serviceManagerSelectedId || service.id,
  });
  renderServiceManagementUi();
}

export async function duplicateService() {
  const service = getManagedService();
  if (!service) return;
  const duplicated = normalizeService({
    ...cloneValue(service),
    id: createId(),
    name: getUniqueServiceName(
      t("{name} 副本", { name: getServiceDisplayName(service) })
    ),
    connectivity: createConnectivityState(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  state.services = [duplicated, ...state.services];
  state.serviceManagerSelectedId = duplicated.id;
  persistState({
    services: state.services,
    serviceManagerSelectedId: duplicated.id,
  });
  renderServiceManagementUi();
  focusServiceNameInput();
}

export async function deleteService() {
  const service = getManagedService();
  if (!service) return;
  const confirmed = await showConfirm(t("确定要删除服务「{name}」吗？", {
    name: getServiceDisplayName(service),
  }), {
    title: t("删除服务"),
    okText: t("确认"),
    danger: true,
  });
  if (!confirmed) return;

  if (service.id === state.serviceManagerSelectedId && hasUnsavedManagedServiceChanges()) {
    const shouldDiscard = await showConfirm(
      t("该服务有未保存修改，删除后这些修改将丢失，是否继续？"),
      {
        title: t("放弃未保存修改"),
        okText: t("确认"),
        cancelText: t("取消"),
        danger: true,
      }
    );
    if (!shouldDiscard) return;
  }

  state.services = state.services.filter((item) => item.id !== service.id);
  const ensuredServices = ensureServicesWithDraft(
    state.services,
    state.serviceManagerSelectedId === service.id
      ? null
      : state.serviceManagerSelectedId
  );
  state.services = ensuredServices.services;
  state.serviceManagerSelectedId = ensuredServices.serviceManagerSelectedId;
  persistState({
    services: state.services,
    serviceManagerSelectedId: state.serviceManagerSelectedId,
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
    serviceManagerSelectedId: state.serviceManagerSelectedId,
  });
  renderServiceManagementUi();
  scheduleServiceConnectivityAutoHide(serviceId, nextConnectivity);
}

export async function testSelectedServiceConnection() {
  const service = getManagedService();
  if (!service) {
    clearTransientConnectivityHideTimer();
    renderServiceConnectivityState(
      createConnectivityState("idle", t("请先选择或新建一个服务，再测试连接。"), 0),
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
      t("正在尝试拉取模型列表…"),
      0
    );
    clearTransientConnectivityHideTimer();
    renderServiceConnectivityState(transientTestingState, true);
  } else {
    updateServiceConnectivity(service.id, {
      status: "testing",
      message: t("正在尝试拉取模型列表…"),
    });
  }

  try {
    const { ids, connectivityMode, message } = await fetchModelsOnce(
      draftService.model
    );
    const successMessage =
      connectivityMode === "messages_probe"
        ? message || t("模型列表接口不可用，但已通过 Messages 接口验证连接。")
        : t("成功拉取 {count} 个模型。", { count: ids.length });
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
        error?.message || t("测试失败"),
        Date.now()
      );
      renderServiceConnectivityState(transientErrorState, true);
      scheduleTransientConnectivityAutoHide(service.id, transientErrorState);
    } else {
      updateServiceConnectivity(service.id, {
        status: "error",
        message: error?.message || t("测试失败"),
        testedAt: Date.now(),
      });
    }
  }
}
