export const STORAGE_KEYS = {
  config: "aiPkConfig",
  topics: "aiPkTopicsV1",
  activeTopicId: "aiPkActiveTopicId",
  isSidebarCollapsed: "aiPkIsSidebarCollapsed",
};

export const MOBILE_LAYOUT_MEDIA_QUERY = "(max-width: 900px)";
export const DESKTOP_DEFAULT_API_BASE = "http://127.0.0.1:33100";
export const BOOTSTRAP_HEALTH_TIMEOUT_MS = 15000;
export const BOOTSTRAP_HEALTH_INTERVAL_MS = 500;

export const SHORTCUTS = [
  {
    action: "新建话题",
    mac: ["Cmd", "Alt", "N"],
    win: ["Ctrl", "Alt", "N"],
    note: "仅在非输入状态下生效",
  },
  {
    action: "打开快捷键帮助",
    mac: ["Shift", "?"],
    win: ["Shift", "?"],
    note: "仅在非输入状态下生效",
  },
  {
    action: "发送消息",
    mac: ["Enter"],
    win: ["Enter"],
    note: "输入框聚焦时",
  },
  {
    action: "换行",
    mac: ["Shift", "Enter"],
    win: ["Shift", "Enter"],
    note: "输入框聚焦时",
  },
];

export function resolveRuntimeConfig() {
  const runtime = window.__PRISM_RUNTIME__ || {};
  const params = new URLSearchParams(window.location.search);
  const queryApiBase = (params.get("apiBase") || "").trim();
  const injectedApiBase = String(runtime.apiBase || "").trim();
  const apiBase = (queryApiBase || injectedApiBase || "").replace(/\/+$/, "");
  const platform =
    runtime.platform || (apiBase ? "desktop" : "web");

  return {
    platform,
    apiBase: apiBase || (platform === "desktop" ? DESKTOP_DEFAULT_API_BASE : ""),
    backendManagedByDesktop:
      runtime.backendManagedByDesktop === true || platform === "desktop",
    startupError: String(runtime.startupError || "").trim(),
  };
}

export const PRISM_RUNTIME = resolveRuntimeConfig();

export function buildApiUrl(path) {
  const normalizedPath = String(path || "").startsWith("/")
    ? String(path || "")
    : `/${String(path || "")}`;

  if (!PRISM_RUNTIME.apiBase) return normalizedPath;
  return `${PRISM_RUNTIME.apiBase}${normalizedPath}`;
}

export function isDesktopRuntime() {
  return PRISM_RUNTIME.platform === "desktop";
}

export function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function getDesktopWindowBridge() {
  if (!isDesktopRuntime()) return null;
  try {
    const tauriWindow = window.__TAURI__?.window;
    if (!tauriWindow || typeof tauriWindow.getCurrentWindow !== "function") {
      return null;
    }
    return tauriWindow.getCurrentWindow();
  } catch (_error) {
    return null;
  }
}

export const state = {
  modelFetch: {
    main: {
      timer: null,
      inFlight: false,
      lastKey: "",
      lastFetchedAt: 0,
      models: [],
      pendingAfterReady: false,
      datalistFillToken: 0,
      dropdownLimit: 120,
    },
    Title: {
      timer: null,
      inFlight: false,
      lastKey: "",
      lastFetchedAt: 0,
      models: [],
      pendingAfterReady: false,
      datalistFillToken: 0,
      dropdownLimit: 120,
    },
  },
  chat: {
    topics: [],
    activeTopicId: null,
    saveTimer: null,
    isCreatingTopic: false,
    generatingTitleTopicIds: new Set(), // 正在生成标题的话题ID集合
    runningControllers: new Map(), // topicId -> AbortController
    turnUiById: new Map(), // turnId -> 当前可见的卡片UI引用
  },
  images: {
    selectedImages: [], // 存储当前选择的图片 { id, dataUrl, name, size }
  },
  dialog: {
    resolver: null,
  },
  runtime: {
    bootstrapped: false,
    bootstrapInFlight: false,
    backendReady: !isDesktopRuntime(),
    backendFailed: false,
    backendLastError: "",
    desktopWindow: null,
    isWindowMaximized: false,
    isWindowFocused: true,
  },
  autoScroll: true, // 是否自动跟随滚动
  isSidebarCollapsed: false,
};

export const floatingDropdownOrigins = new WeakMap();
export const floatingDropdownAnchors = new WeakMap();

export const elements = {
  // 配置相关
  saveConfig: document.getElementById("saveConfig"),
  clearConfig: document.getElementById("clearConfig"),
  configModal: document.getElementById("configModal"),
  configTabs: document.getElementById("configTabs"),
  configContent: document.getElementById("configContent"),
  modelStatusPill: document.getElementById("modelStatusPill"),
  webStatusPill: document.getElementById("webStatusPill"),
  openConfigBtn: document.getElementById("openConfigBtn"),
  closeConfigBtn: document.getElementById("closeConfigBtn"),
  openShortcutHelpBtn: document.getElementById("openShortcutHelpBtn"),
  closeShortcutHelpBtn: document.getElementById("closeShortcutHelpBtn"),
  shortcutHelpModal: document.getElementById("shortcutHelpModal"),
  shortcutHelpList: document.getElementById("shortcutHelpList"),
  toggleSidebarBtn: document.getElementById("toggleSidebarBtn"),
  expandSidebarBtn: document.getElementById("expandSidebarBtn"),

  // 联网搜索
  enableWebSearch: document.getElementById("enableWebSearch"),
  webSearchProvider: document.getElementById("webSearchProvider"),
  tavilyApiKey: document.getElementById("tavilyApiKey"),
  exaApiKey: document.getElementById("exaApiKey"),
  exaSearchType: document.getElementById("exaSearchType"),
  exaSearchTypePickerInput: document.getElementById("exaSearchTypePickerInput"),
  exaSearchTypePickerBtn: document.getElementById("exaSearchTypePickerBtn"),
  exaSearchTypePickerDropdown: document.getElementById("exaSearchTypePickerDropdown"),
  tavilyMaxResults: document.getElementById("tavilyMaxResults"),
  tavilySearchDepth: document.getElementById("tavilySearchDepth"),
  tavilySearchDepthPickerInput: document.getElementById(
    "tavilySearchDepthPickerInput"
  ),
  tavilySearchDepthPickerBtn: document.getElementById(
    "tavilySearchDepthPickerBtn"
  ),
  tavilySearchDepthPickerDropdown: document.getElementById(
    "tavilySearchDepthPickerDropdown"
  ),
  tavilyApiKeyGroup: document.getElementById("tavilyApiKeyGroup"),
  exaApiKeyGroup: document.getElementById("exaApiKeyGroup"),
  exaSearchTypeGroup: document.getElementById("exaSearchTypeGroup"),
  tavilySearchDepthGroup: document.getElementById("tavilySearchDepthGroup"),

  // 初始问候语

  // 输入相关
  promptInput: document.getElementById("promptInput"),
  sendBtn: document.getElementById("sendBtn"),
  imageInput: document.getElementById("imageInput"),
  imageUploadBtn: document.getElementById("imageUploadBtn"),
  imagePreviewContainer: document.getElementById("imagePreviewContainer"),
  reasoningEffortSelector: document.getElementById("reasoningEffortSelector"),
  reasoningEffortValue: document.getElementById("reasoningEffortValue"),
  reasoningEffortDropdown: document.getElementById("reasoningEffortDropdown"),

  // 话题
  newTopicBtn: document.getElementById("newTopicBtn"),
  topicList: document.getElementById("topicList"),
  chatMessages: document.getElementById("chatMessages"),
  scrollToBottomBtn: document.getElementById("scrollToBottomBtn"),
  desktopTitlebar: document.getElementById("desktopTitlebar"),
  desktopWindowControls: document.getElementById("desktopWindowControls"),
  windowMinimizeBtn: document.getElementById("windowMinimizeBtn"),
  windowMaximizeBtn: document.getElementById("windowMaximizeBtn"),
  windowCloseBtn: document.getElementById("windowCloseBtn"),

  // 模型配置
  provider: document.getElementById("provider"),
  providerPickerInput: document.getElementById("providerPickerInput"),
  providerPickerBtn: document.getElementById("providerPickerBtn"),
  providerPickerDropdown: document.getElementById("providerPickerDropdown"),
  providerHint: document.getElementById("providerHint"),
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model"),
  modelCustomName: document.getElementById("modelCustomName"),
  apiUrl: document.getElementById("apiUrl"),
  roleSetting: document.getElementById("roleSetting"),
  roleSettingPreview: document.getElementById("roleSettingPreview"),
  modelHint: document.getElementById("modelHint"),
  modelDropdown: document.getElementById("modelDropdown"),
  modelDropdownBtn: document.getElementById("modelDropdownBtn"),
  webSearchProviderPickerInput: document.getElementById(
    "webSearchProviderPickerInput"
  ),
  webSearchProviderPickerBtn: document.getElementById("webSearchProviderPickerBtn"),
  webSearchProviderPickerDropdown: document.getElementById(
    "webSearchProviderPickerDropdown"
  ),

  // 头部状态
  modelName: document.getElementById("modelName"),
  headerSessionInfo: document.getElementById("headerSessionInfo"),

  // 通用确认弹窗
  promptConfirmModal: document.getElementById("promptConfirmModal"),
  promptConfirmTitle: document.getElementById("promptConfirmTitle"),
  promptConfirmMessage: document.getElementById("promptConfirmMessage"),
  promptConfirmHint: document.getElementById("promptConfirmHint"),
  promptConfirmCancelBtn: document.getElementById("promptConfirmCancelBtn"),
  promptConfirmOkBtn: document.getElementById("promptConfirmOkBtn"),
};

export function isDesktopBackendAvailable() {
  return !isDesktopRuntime() || state.runtime.backendReady;
}

export function getProviderMode(config) {
  const provider = config?.provider || "openai";
  return provider === "anthropic" ? "anthropic" : "openai";
}

export function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function truncateText(text, maxLen) {
  const s = (text || "").toString();
  if (!maxLen || maxLen <= 0) return s;
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "…";
}

export function estimateTokensFromText(text) {
  if (!text) return 0;
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const asciiCount = Math.max(0, text.length - cjkCount);
  return Math.max(0, Math.ceil(cjkCount + asciiCount / 4));
}

export function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
