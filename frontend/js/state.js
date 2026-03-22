export const STORAGE_KEYS = {
  config: "aiPkConfig",
  topics: "aiPkTopicsV1",
  activeTopicId: "aiPkActiveTopicId",
  isSidebarCollapsed: "aiPkIsSidebarCollapsed",
};

export const MOBILE_LAYOUT_MEDIA_QUERY = "(max-width: 900px)";
export const DESKTOP_DEFAULT_API_BASE = "http://127.0.0.1:33100";
export const BOOTSTRAP_HEALTH_TIMEOUT_MS = 15000;
export const BOOTSTRAP_HEALTH_INTERVAL_MS = 100;

export const SHORTCUTS = [
  {
    action: "新建话题",
    keys: ["Ctrl", "Shift", "O"],
    note: "聊天输入框聚焦时也可用",
  },
  {
    action: "打开快捷键页",
    keys: ["Shift", "?"],
    note: "聊天输入框聚焦时也可用，会打开配置中心",
  },
  {
    action: "删除当前话题",
    keys: ["Ctrl", "Shift", "Backspace"],
    note: "聊天输入框聚焦时也可用，会弹出确认",
  },
  {
    action: "收起或展开话题栏",
    keys: ["Ctrl", "B"],
    note: "聊天输入框聚焦时也可用",
  },
  {
    action: "发送消息",
    keys: ["Enter"],
    note: "输入框聚焦时",
  },
  {
    action: "换行",
    keys: ["Shift", "Enter"],
    note: "输入框聚焦时",
  },
];

export const PROVIDER_SELECTIONS = {
  openai_chat: {
    provider: "openai",
    endpointMode: "chat_completions",
    label: "OpenAI Chat Completions",
  },
  openai_responses: {
    provider: "openai",
    endpointMode: "responses",
    label: "OpenAI Responses",
  },
  anthropic: {
    provider: "anthropic",
    endpointMode: "chat_completions",
    label: "Anthropic Messages",
  },
  gemini: {
    provider: "gemini",
    endpointMode: "chat_completions",
    label: "Google Gemini",
  },
};

export function normalizeProviderSelection(value, endpointMode = "chat_completions") {
  const normalizedValue = String(value || "").trim().toLowerCase();
  if (normalizedValue === "openai_responses") return "openai_responses";
  if (normalizedValue === "anthropic") return "anthropic";
  if (normalizedValue === "gemini") return "gemini";
  if (normalizedValue === "openai_chat") return "openai_chat";
  if (normalizedValue === "openai") {
    return String(endpointMode || "").trim().toLowerCase() === "responses"
      ? "openai_responses"
      : "openai_chat";
  }
  return "openai_chat";
}

export function resolveProviderSelection(value, endpointMode = "chat_completions") {
  const selection = normalizeProviderSelection(value, endpointMode);
  return {
    selection,
    ...(PROVIDER_SELECTIONS[selection] || PROVIDER_SELECTIONS.openai_chat),
  };
}

export function resolveRuntimeConfig() {
  const runtime = window.__PRISM_RUNTIME__ || {};
  const params = new URLSearchParams(window.location.search);
  const queryApiBase = (params.get("apiBase") || "").trim();
  const injectedApiBase = String(runtime.apiBase || "").trim();
  const apiBase = (queryApiBase || injectedApiBase || "").replace(/\/+$/, "");
  const platform = runtime.platform || (apiBase ? "desktop" : "web");

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
      dropdownQuery: null,
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
      dropdownQuery: null,
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
    editingTurnId: null,
    editDraftByTurnId: new Map(),
    turnIdsWithoutAnimation: new Set(),
    generatingTitleTopicIds: new Set(), // 正在生成标题的话题ID集合
    runningControllers: new Map(), // topicId -> AbortController
    turnUiById: new Map(), // turnId -> 当前可见的卡片UI引用
  },
  images: {
    selectedImages: [], // 存储当前选择的图片 { id, dataUrl, name, size }
  },
  webSearch: {
    enabled: false,
    toolMode: "tavily",
    selectorOpen: false,
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
  services: [],
  activeServiceId: null,
  serviceManagerSelectedId: null,
  headerModelFetchSlots: new Map(),
};

export const floatingDropdownOrigins = new WeakMap();
export const floatingDropdownAnchors = new WeakMap();

export const elements = {
  // 配置相关
  clearConfig: document.getElementById("clearConfig"),
  configModal: document.getElementById("configModal"),
  configTabs: document.getElementById("configTabs"),
  configContent: document.getElementById("configContent"),
  modelStatusPill: document.getElementById("modelStatusPill"),
  webStatusPill: document.getElementById("webStatusPill"),
  openConfigBtn: document.getElementById("openConfigBtn"),
  closeConfigBtn: document.getElementById("closeConfigBtn"),
  shortcutHelpList: document.getElementById("shortcutHelpList"),
  toggleSidebarBtn: document.getElementById("toggleSidebarBtn"),
  expandSidebarBtn: document.getElementById("expandSidebarBtn"),
  mobileExpandSidebarBtn: document.getElementById("mobileExpandSidebarBtn"),
  sidebarScrim: document.getElementById("sidebarScrim"),

  // 联网搜索
  webSearchControl: document.getElementById("webSearchControl"),
  webSearchSwitchText: document.getElementById("webSearchSwitchText"),
  webSearchToolCurrent: document.getElementById("webSearchToolCurrent"),
  webSearchToolValue: document.getElementById("webSearchToolValue"),
  webSearchToolDropdown: document.getElementById("webSearchToolDropdown"),
  webSearchProvider: document.getElementById("webSearchProvider"),
  webSearchProviderGroup: document.getElementById("webSearchProviderGroup"),
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
  webSearchMaxResultsGroup: document.getElementById("webSearchMaxResultsGroup"),
  closeToTrayOnClose: document.getElementById("closeToTrayOnClose"),
  desktopCloseToTrayGroup: document.getElementById("desktopCloseToTrayGroup"),

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
  serviceList: document.getElementById("serviceList"),
  serviceNameInput: document.getElementById("serviceNameInput"),
  serviceSummary: document.getElementById("serviceSummary"),
  serviceConnectivityBadge: document.getElementById("serviceConnectivityBadge"),
  serviceConnectivityMessage: document.getElementById("serviceConnectivityMessage"),
  serviceConnectivityTime: document.getElementById("serviceConnectivityTime"),
  createServiceBtn: document.getElementById("createServiceBtn"),
  duplicateServiceBtn: document.getElementById("duplicateServiceBtn"),
  deleteServiceBtn: document.getElementById("deleteServiceBtn"),
  testServiceConnectionBtn: document.getElementById("testServiceConnectionBtn"),
  provider: document.getElementById("provider"),
  providerPickerInput: document.getElementById("providerPickerInput"),
  providerPickerBtn: document.getElementById("providerPickerBtn"),
  providerPickerDropdown: document.getElementById("providerPickerDropdown"),
  providerHint: document.getElementById("providerHint"),
  endpointModeHint: document.getElementById("endpointModeHint"),
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model"),
  apiUrl: document.getElementById("apiUrl"),
  roleSetting: document.getElementById("roleSetting"),
  roleSettingPreview: document.getElementById("roleSettingPreview"),
  modelHint: document.getElementById("modelHint"),
  modelDropdown: document.getElementById("modelDropdown"),
  modelDropdownBtn: document.getElementById("modelDropdownBtn"),
  titleGenerationModel: document.getElementById("titleGenerationModel"),
  titleGenerationModelHint: document.getElementById("titleGenerationModelHint"),
  modelDropdownTitle: document.getElementById("modelDropdownTitle"),
  modelDropdownBtnTitle: document.getElementById("modelDropdownBtnTitle"),
  webSearchProviderPickerInput: document.getElementById(
    "webSearchProviderPickerInput"
  ),
  webSearchProviderPickerBtn: document.getElementById("webSearchProviderPickerBtn"),
  webSearchProviderPickerDropdown: document.getElementById(
    "webSearchProviderPickerDropdown"
  ),

  // 头部状态
  headerModelInfo: document.getElementById("headerModelInfo"),
  headerModelTrigger: document.getElementById("headerModelTrigger"),
  headerModelDropdown: document.getElementById("headerModelDropdown"),
  serviceNameLabel: document.getElementById("serviceNameLabel"),
  serviceModelDivider: document.getElementById("serviceModelDivider"),
  modelName: document.getElementById("modelName"),
  headerSessionInfo: document.getElementById("headerSessionInfo"),

  // 通用确认弹窗
  promptConfirmModal: document.getElementById("promptConfirmModal"),
  promptConfirmTitle: document.getElementById("promptConfirmTitle"),
  promptConfirmMessage: document.getElementById("promptConfirmMessage"),
  promptConfirmHint: document.getElementById("promptConfirmHint"),
  promptConfirmCancelBtn: document.getElementById("promptConfirmCancelBtn"),
  promptConfirmOkBtn: document.getElementById("promptConfirmOkBtn"),

  // HTML 预览
  htmlPreviewLayer: document.getElementById("htmlPreviewLayer"),
  htmlPreviewBackdrop: document.getElementById("htmlPreviewBackdrop"),
  htmlPreviewDrawer: document.getElementById("htmlPreviewDrawer"),
  htmlPreviewCloseBtn: document.getElementById("htmlPreviewCloseBtn"),
  htmlPreviewFrame: document.getElementById("htmlPreviewFrame"),
  htmlPreviewEmpty: document.getElementById("htmlPreviewEmpty"),
};

export function isDesktopBackendAvailable() {
  return !isDesktopRuntime() || state.runtime.backendReady;
}

export function getProviderMode(config) {
  const provider = config?.provider || "openai";
  if (provider === "gemini") return "gemini";
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
