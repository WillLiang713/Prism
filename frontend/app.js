const STORAGE_KEYS = {
  config: "aiPkConfig",
  topics: "aiPkTopicsV1",
  activeTopicId: "aiPkActiveTopicId",
  isSidebarCollapsed: "aiPkIsSidebarCollapsed",
};

const MOBILE_LAYOUT_MEDIA_QUERY = "(max-width: 900px)";

const state = {
  modelFetch: {
    main: {
      timer: null,
      inFlight: false,
      lastKey: "",
      lastFetchedAt: 0,
      models: [],
      datalistFillToken: 0,
      dropdownLimit: 120,
    },
    Title: {
      timer: null,
      inFlight: false,
      lastKey: "",
      lastFetchedAt: 0,
      models: [],
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
  autoScroll: true, // 是否自动跟随滚动
  isSidebarCollapsed: false,
};

const floatingDropdownOrigins = new WeakMap();
const floatingDropdownAnchors = new WeakMap();

const elements = {
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

  // 模型配置
  provider: document.getElementById("provider"),
  providerPickerInput: document.getElementById("providerPickerInput"),
  providerPickerBtn: document.getElementById("providerPickerBtn"),
  providerPickerDropdown: document.getElementById("providerPickerDropdown"),
  providerHint: document.getElementById("providerHint"),
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model"),
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

document.addEventListener("DOMContentLoaded", () => {
  initMarkdown();
  initConfigSelectPickers();
  loadConfig();
  syncAllConfigSelectPickers();
  updateProviderUi();
  initChat();
  bindEvents();
  bindDialogEvents();
  updateModelNames();
  setSendButtonMode("send");
  autoGrowPromptInput();
  updateConfigStatusStrip();
  initLayout(); // 初始化布局
  renderAll();
  startHeaderClock();

});

function getProviderMode(config) {
  const provider = config?.provider || "openai";
  return provider === "anthropic" ? "anthropic" : "openai";
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getConfigSelectPickerDefs() {
  return [
    {
      key: "provider",
      select: elements.provider,
      input: elements.providerPickerInput,
      btn: elements.providerPickerBtn,
      dropdown: elements.providerPickerDropdown,
    },
    {
      key: "webSearchProvider",
      select: elements.webSearchProvider,
      input: elements.webSearchProviderPickerInput,
      btn: elements.webSearchProviderPickerBtn,
      dropdown: elements.webSearchProviderPickerDropdown,
    },
    {
      key: "tavilySearchDepth",
      select: elements.tavilySearchDepth,
      input: elements.tavilySearchDepthPickerInput,
      btn: elements.tavilySearchDepthPickerBtn,
      dropdown: elements.tavilySearchDepthPickerDropdown,
    },
    {
      key: "exaSearchType",
      select: elements.exaSearchType,
      input: elements.exaSearchTypePickerInput,
      btn: elements.exaSearchTypePickerBtn,
      dropdown: elements.exaSearchTypePickerDropdown,
    },
  ];
}

function getConfigSelectPickerDef(key) {
  return getConfigSelectPickerDefs().find((item) => item.key === key) || null;
}

function getSelectOptionLabel(selectEl, value) {
  if (!selectEl) return "";
  const options = Array.from(selectEl.options || []);
  const found = options.find((opt) => opt.value === value);
  return (found?.textContent || value || "").trim();
}

function rememberDropdownOrigin(dropdownEl) {
  if (!(dropdownEl instanceof HTMLElement)) return;
  if (floatingDropdownOrigins.has(dropdownEl)) return;
  floatingDropdownOrigins.set(dropdownEl, {
    parent: dropdownEl.parentElement,
    next: dropdownEl.nextSibling,
  });
}

function restoreDropdownOrigin(dropdownEl) {
  if (!(dropdownEl instanceof HTMLElement)) return;
  const origin = floatingDropdownOrigins.get(dropdownEl);
  if (!origin?.parent) return;
  if (dropdownEl.parentElement === origin.parent) return;
  if (origin.next && origin.next.parentNode === origin.parent) {
    origin.parent.insertBefore(dropdownEl, origin.next);
  } else {
    origin.parent.appendChild(dropdownEl);
  }
}

function positionFloatingDropdown(dropdownEl) {
  if (!(dropdownEl instanceof HTMLElement)) return;
  const anchorEl = floatingDropdownAnchors.get(dropdownEl);
  if (!(anchorEl instanceof HTMLElement)) return;

  const rect = anchorEl.getBoundingClientRect();
  const viewportPadding = 12;
  const gap = 6;
  const width = Math.min(
    Math.max(220, Math.round(rect.width)),
    Math.max(220, window.innerWidth - viewportPadding * 2)
  );
  const spaceBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
  const maxHeight = Math.max(140, Math.min(320, Math.round(spaceBelow)));
  const left = Math.min(
    Math.max(viewportPadding, Math.round(rect.left)),
    Math.max(viewportPadding, window.innerWidth - viewportPadding - width)
  );
  const top = Math.round(rect.bottom + gap);

  dropdownEl.style.left = `${left}px`;
  dropdownEl.style.top = `${top}px`;
  dropdownEl.style.width = `${width}px`;
  dropdownEl.style.maxHeight = `${maxHeight}px`;
}

function openFloatingDropdown(dropdownEl, anchorEl) {
  if (!(dropdownEl instanceof HTMLElement) || !(anchorEl instanceof HTMLElement))
    return;
  rememberDropdownOrigin(dropdownEl);
  const host = elements.configModal || document.body;
  if (dropdownEl.parentElement !== host) {
    host.appendChild(dropdownEl);
  }
  dropdownEl.classList.add("is-floating-dropdown");
  floatingDropdownAnchors.set(dropdownEl, anchorEl);
  positionFloatingDropdown(dropdownEl);
  dropdownEl.hidden = false;
  dropdownEl.setAttribute("aria-hidden", "false");
}

function closeFloatingDropdown(dropdownEl) {
  if (!(dropdownEl instanceof HTMLElement)) return;
  dropdownEl.classList.remove("is-floating-dropdown");
  dropdownEl.style.left = "";
  dropdownEl.style.top = "";
  dropdownEl.style.width = "";
  dropdownEl.style.maxHeight = "";
  floatingDropdownAnchors.delete(dropdownEl);
  restoreDropdownOrigin(dropdownEl);
}

function repositionOpenFloatingDropdowns() {
  const dropdowns = [
    elements.modelDropdown,
    ...getConfigSelectPickerDefs().map((item) => item.dropdown),
  ];
  for (const dropdownEl of dropdowns) {
    if (!(dropdownEl instanceof HTMLElement)) continue;
    if (dropdownEl.hidden) continue;
    if (!dropdownEl.classList.contains("is-floating-dropdown")) continue;
    positionFloatingDropdown(dropdownEl);
  }
}

function syncConfigSelectPicker(key) {
  const picker = getConfigSelectPickerDef(key);
  if (!picker?.select || !picker?.input) return;
  picker.input.value = getSelectOptionLabel(picker.select, picker.select.value);
}

function syncAllConfigSelectPickers() {
  const defs = getConfigSelectPickerDefs();
  for (const picker of defs) {
    syncConfigSelectPicker(picker.key);
  }
}

function setConfigSelectPickerButtonState(key, isOpen) {
  const picker = getConfigSelectPickerDef(key);
  const btn = picker?.btn;
  if (!btn) return;
  btn.classList.toggle("open", !!isOpen);
  btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

function isConfigSelectPickerOpen(key) {
  const picker = getConfigSelectPickerDef(key);
  return !!picker?.dropdown && !picker.dropdown.hidden;
}

function closeConfigSelectPicker(key) {
  const picker = getConfigSelectPickerDef(key);
  if (!picker?.dropdown) return;
  picker.dropdown.hidden = true;
  picker.dropdown.setAttribute("aria-hidden", "true");
  picker.dropdown.innerHTML = "";
  closeFloatingDropdown(picker.dropdown);
  setConfigSelectPickerButtonState(key, false);
}

function closeAllConfigSelectPickers(exceptKey = "") {
  for (const picker of getConfigSelectPickerDefs()) {
    if (picker.key === exceptKey) continue;
    closeConfigSelectPicker(picker.key);
  }
}

function applyConfigSelectPickerValue(key, value) {
  const picker = getConfigSelectPickerDef(key);
  if (!picker?.select) return;
  const nextValue = String(value || "");
  if (picker.select.value !== nextValue) {
    picker.select.value = nextValue;
    picker.select.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    syncConfigSelectPicker(key);
  }
  closeConfigSelectPicker(key);
}

function renderConfigSelectPicker(key) {
  const picker = getConfigSelectPickerDef(key);
  if (!picker?.dropdown || !picker?.select) return;
  const options = Array.from(picker.select.options || []);

  picker.dropdown.innerHTML = "";
  if (!options.length) {
    const empty = document.createElement("div");
    empty.className = "model-dropdown-empty";
    empty.textContent = "暂无可选项";
    picker.dropdown.appendChild(empty);
    return;
  }

  for (const opt of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "model-dropdown-item";
    btn.dataset.value = opt.value;
    btn.textContent = (opt.textContent || opt.value || "").trim();
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () =>
      applyConfigSelectPickerValue(key, opt.value)
    );
    picker.dropdown.appendChild(btn);
  }
}

function openConfigSelectPicker(key) {
  const picker = getConfigSelectPickerDef(key);
  if (!picker?.dropdown || !picker?.input) return;
  closeModelDropdown("main");
  closeAllConfigSelectPickers(key);
  renderConfigSelectPicker(key);
  openFloatingDropdown(picker.dropdown, picker.input);
  setConfigSelectPickerButtonState(key, true);
}

function toggleConfigSelectPicker(key) {
  if (isConfigSelectPickerOpen(key)) {
    closeConfigSelectPicker(key);
    return;
  }
  openConfigSelectPicker(key);
}

function bindConfigSelectPicker(key) {
  const picker = getConfigSelectPickerDef(key);
  if (!picker?.select || !picker?.input || !picker?.btn || !picker?.dropdown) {
    return;
  }

  if (!picker.btn.dataset.bound) {
    picker.btn.addEventListener("click", () => toggleConfigSelectPicker(key));
    picker.btn.dataset.bound = "1";
  }

  if (!picker.input.dataset.bound) {
    picker.input.addEventListener("click", () => toggleConfigSelectPicker(key));
    picker.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleConfigSelectPicker(key);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeConfigSelectPicker(key);
      }
    });
    picker.input.dataset.bound = "1";
  }

  if (!picker.select.dataset.pickerBound) {
    picker.select.addEventListener("change", () => {
      syncConfigSelectPicker(key);
      closeConfigSelectPicker(key);
    });
    picker.select.dataset.pickerBound = "1";
  }

  syncConfigSelectPicker(key);
}

function initConfigSelectPickers() {
  for (const picker of getConfigSelectPickerDefs()) {
    bindConfigSelectPicker(picker.key);
  }
}

function isTopicRunning(topicId) {
  return !!topicId && state.chat.runningControllers.has(topicId);
}

function syncSendButtonModeByActiveTopic() {
  const activeTopicId = state.chat.activeTopicId;
  setSendButtonMode(isTopicRunning(activeTopicId) ? "stop" : "send");
}

function markTopicRunning(topicId, controller) {
  if (!topicId || !controller) return;
  state.chat.runningControllers.set(topicId, controller);
  if (topicId === state.chat.activeTopicId) {
    syncSendButtonModeByActiveTopic();
  }
  renderTopicList();
}

function unmarkTopicRunning(topicId, controller) {
  if (!topicId) return;
  const current = state.chat.runningControllers.get(topicId);
  if (controller && current && current !== controller) return;
  state.chat.runningControllers.delete(topicId);
  if (topicId === state.chat.activeTopicId) {
    syncSendButtonModeByActiveTopic();
  }
  renderTopicList();
}

function getLiveTurnUi(turnId, fallbackUi) {
  const liveUi = state.chat.turnUiById.get(turnId);
  if (liveUi?.statusEl?.isConnected) return liveUi;
  return fallbackUi || null;
}

function formatTime(ts) {
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


function updateHeaderMeta() {
  const topic = getActiveTopic();
  const title = (topic?.title || "未命名话题").trim() || "未命名话题";
  const count = Array.isArray(topic?.turns) ? topic.turns.length : 0;

  if (elements.headerSessionInfo) {
    elements.headerSessionInfo.textContent = `会话：${title} · ${count} 条`;
  }
}

function startHeaderClock() {
  updateHeaderMeta();
}

function hasOpenModal() {
  return !!document.querySelector(".modal-overlay.open");
}

function syncBodyScrollLock() {
  document.body.style.overflow = hasOpenModal() ? "hidden" : "";
}

function isPromptConfirmDialogOpen() {
  return !!elements.promptConfirmModal?.classList.contains("open");
}

function resolvePromptConfirmDialog(confirmed) {
  if (!elements.promptConfirmModal || !state.dialog.resolver) return;

  const resolver = state.dialog.resolver;
  state.dialog.resolver = null;

  elements.promptConfirmModal.classList.remove("open");
  elements.promptConfirmModal.setAttribute("aria-hidden", "true");
  syncBodyScrollLock();
  resolver(!!confirmed);
}

function openPromptConfirmDialog(options = {}) {
  if (!elements.promptConfirmModal) {
    return Promise.resolve(false);
  }

  if (state.dialog.resolver) {
    resolvePromptConfirmDialog(false);
  }

  const {
    title = "提示",
    message = "",
    okText = "确定",
    cancelText = "取消",
    showCancel = true,
    danger = false,
    hint = "",
  } = options;

  if (elements.promptConfirmTitle) {
    elements.promptConfirmTitle.textContent = title;
  }
  if (elements.promptConfirmMessage) {
    elements.promptConfirmMessage.textContent = message;
  }
  if (elements.promptConfirmOkBtn) {
    elements.promptConfirmOkBtn.textContent = okText;
    elements.promptConfirmOkBtn.classList.toggle("btn-danger", !!danger);
  }
  if (elements.promptConfirmCancelBtn) {
    elements.promptConfirmCancelBtn.textContent = cancelText;
    elements.promptConfirmCancelBtn.hidden = !showCancel;
  }
  if (elements.promptConfirmHint) {
    const nextHint = (hint || "").trim();
    elements.promptConfirmHint.textContent = nextHint;
    elements.promptConfirmHint.hidden = !nextHint;
  }

  elements.promptConfirmModal.classList.add("open");
  elements.promptConfirmModal.setAttribute("aria-hidden", "false");
  syncBodyScrollLock();

  window.setTimeout(() => {
    elements.promptConfirmOkBtn?.focus();
  }, 0);

  return new Promise((resolve) => {
    state.dialog.resolver = resolve;
  });
}

async function showConfirm(message, options = {}) {
  const confirmed = await openPromptConfirmDialog({
    ...options,
    message,
    showCancel: true,
  });
  return !!confirmed;
}

async function showAlert(message, options = {}) {
  await openPromptConfirmDialog({
    ...options,
    message,
    showCancel: false,
    okText: options.okText || "知道了",
  });
}

function estimateTokensFromText(text) {
  if (!text) return 0;
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const asciiCount = Math.max(0, text.length - cjkCount);
  return Math.max(0, Math.ceil(cjkCount + asciiCount / 4));
}

function initMarkdown() {
  if (typeof marked === "undefined") return;
  marked.setOptions({
    highlight: function (code, lang) {
      if (typeof hljs !== "undefined") {
        try {
          // 如果指定了语言且该语言已注册，则使用指定语言高亮
          if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
          }
          // 否则尝试自动检测语言
          return hljs.highlightAuto(code).value;
        } catch (e) {
          console.error("代码高亮失败:", e);
        }
      }
      return code;
    },
    breaks: true,
    gfm: true,
  });
}

function renderMarkdownToElement(element, text) {
  if (!element) return;
  if (typeof marked !== "undefined") {
    try {
      element.innerHTML = marked.parse(text || "");
      enhanceRenderedMarkdown(element);
      return;
    } catch (e) {
      console.error("Markdown渲染失败:", e);
    }
  }
  element.textContent = text || "";
}

function enhanceRenderedMarkdown(root) {
  if (!root) return;

  // 手动高亮所有代码块
  if (typeof hljs !== "undefined") {
    const codeBlocks = root.querySelectorAll("pre code");
    codeBlocks.forEach((block) => {
      try {
        // 获取语言类型
        const lang = getLanguageFromCodeEl(block);

        // 跳过不支持的语言（如 mermaid、plantuml 等需要特殊渲染的）
        const unsupportedLanguages = ["mermaid", "plantuml", "graphviz", "dot"];
        if (unsupportedLanguages.includes(lang.toLowerCase())) {
          return;
        }

        // 只高亮支持的语言
        if (!lang || hljs.getLanguage(lang)) {
          hljs.highlightElement(block);
        }
      } catch (e) {
        console.error("手动高亮代码块失败:", e);
      }
    });
  }

  addCopyButtonsToCodeBlocks(root);
  // 为所有链接添加 target="_blank" 和 rel="noopener noreferrer"
  const links = root.querySelectorAll("a[href]");
  links.forEach((link) => {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  });
}

function getLanguageFromCodeEl(codeEl) {
  const className = (codeEl?.className || "").toString();
  const m = className.match(/(?:^|\s)(?:language|lang)-([\w-]+)(?:\s|$)/i);
  return m?.[1] || "";
}

async function copyTextToClipboard(text) {
  const content = (text ?? "").toString();
  if (!content) return false;

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(content);
      return true;
    } catch {
      // 回退到 execCommand
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = content;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return !!ok;
  } catch {
    return false;
  }
}

function createCopyButton(getText, options = {}) {
  const {
    className = "message-copy-btn",
    label = "复制",
    loadingText = "复制…",
    successText = "已复制",
    errorText = "失败",
    resetDelayMs = 1800,
    icon = false,
  } = options || {};

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;

  if (icon) {
    btn.classList.add("copy-icon-btn");
    btn.setAttribute("aria-label", label);
    btn.title = label;

    const mkSvg = (svgClass, inner) => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      svg.classList.add("icon", svgClass);
      svg.innerHTML = inner;
      return svg;
    };

    btn.appendChild(
      mkSvg(
        "icon-copy",
        '<rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>'
      )
    );
    btn.appendChild(mkSvg("icon-check", '<path d="M20 6L9 17l-5-5"></path>'));
    btn.appendChild(mkSvg("icon-x", '<path d="M18 6L6 18M6 6l12 12"></path>'));
  } else {
    btn.textContent = label;
  }

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const original = icon
      ? btn.getAttribute("aria-label") || label
      : btn.textContent;
    btn.disabled = true;
    if (icon) {
      btn.dataset.copyState = "loading";
      btn.title = loadingText;
    } else {
      btn.textContent = loadingText;
    }

    const text = typeof getText === "function" ? getText() : getText;
    const ok = await copyTextToClipboard(text);
    if (icon) {
      btn.dataset.copyState = ok ? "success" : "error";
      btn.title = ok ? successText : errorText;
    } else {
      btn.textContent = ok ? successText : errorText;
    }

    setTimeout(() => {
      // 成功状态直接消失，不恢复原状态
      if (icon && ok) {
        // 添加淡出类，但保持success状态显示对勾图标
        btn.classList.add("copy-btn-fade-out");
        setTimeout(() => {
          btn.disabled = false;
          btn.classList.remove("copy-btn-fade-out");
          delete btn.dataset.copyState;
          btn.title = original;
        }, 300);
      } else {
        // 错误状态或非图标按钮恢复原状态
        btn.disabled = false;
        if (icon) {
          delete btn.dataset.copyState;
          btn.title = original;
        } else {
          btn.textContent = original;
        }
      }
    }, resetDelayMs);
  });

  return btn;
}

function addCopyButtonsToCodeBlocks(root) {
  const codeBlocks = root.querySelectorAll("pre > code");
  for (const codeEl of codeBlocks) {
    const preEl = codeEl.parentElement;
    if (!preEl || preEl.tagName !== "PRE") continue;
    if (preEl.closest(".code-block")) continue;

    const wrapper = document.createElement("div");
    wrapper.className = "code-block";

    const toolbar = document.createElement("div");
    toolbar.className = "code-toolbar";

    const language = getLanguageFromCodeEl(codeEl);

    const lang = document.createElement("span");
    lang.className = "code-lang";
    lang.textContent = language || "text";
    toolbar.appendChild(lang);

    // 使用统一的createCopyButton函数创建复制按钮
    const btn = createCopyButton(() => codeEl.textContent || "", {
      label: "复制代码",
      icon: true,
      className: "code-copy-btn",
    });

    // 检查是否在 loading 状态的消息中，如果是则立即禁用按钮
    const message = root.closest(".assistant-message");
    if (message && message.classList.contains("loading")) {
      btn.disabled = true;
      btn.style.opacity = "0.5";
      btn.style.cursor = "not-allowed";
    }

    toolbar.appendChild(btn);

    const parent = preEl.parentNode;
    if (!parent) continue;
    parent.insertBefore(wrapper, preEl);
    wrapper.appendChild(toolbar);
    wrapper.appendChild(preEl);
  }
}

function truncateText(text, maxLen) {
  const s = (text || "").toString();
  if (!maxLen || maxLen <= 0) return s;
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "…";
}

// ========== 图片处理函数 ==========

// 将图片文件读取为base64 data URL
function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("不是有效的图片文件"));
      return;
    }

    // 限制图片大小为10MB
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      reject(new Error("图片大小不能超过10MB"));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

// 添加图片到状态
async function addImages(files) {
  if (!files || files.length === 0) return;

  const fileArray = Array.from(files);
  for (const file of fileArray) {
    try {
      const dataUrl = await readImageAsDataUrl(file);
      const image = {
        id: createId(),
        dataUrl,
        name: file.name,
        size: file.size,
        type: file.type,
      };
      state.images.selectedImages.push(image);
    } catch (e) {
      console.error("添加图片失败:", e);
      await showAlert(`添加图片失败：${e.message}`, {
        title: "图片处理失败",
      });
    }
  }

  renderImagePreviews();
}

// 从状态中移除图片
function removeImage(imageId) {
  state.images.selectedImages = state.images.selectedImages.filter(
    (img) => img.id !== imageId
  );
  renderImagePreviews();
}

// 清空所有图片
function clearImages() {
  state.images.selectedImages = [];
  renderImagePreviews();
}

// 渲染图片预览
function renderImagePreviews() {
  const container = elements.imagePreviewContainer;
  if (!container) return;

  const images = state.images.selectedImages;

  if (images.length === 0) {
    container.style.display = "none";
    container.innerHTML = "";
    return;
  }

  container.style.display = "flex";
  container.innerHTML = "";

  for (const image of images) {
    const preview = document.createElement("div");
    preview.className = "image-preview-item";
    preview.dataset.imageId = image.id;

    const img = document.createElement("img");
    img.src = image.dataUrl;
    img.alt = image.name;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "image-preview-remove";
    removeBtn.title = "移除图片";
    removeBtn.innerHTML = "×";
    removeBtn.addEventListener("click", () => removeImage(image.id));

    preview.appendChild(img);
    preview.appendChild(removeBtn);
    container.appendChild(preview);
  }
}

function renderWebSearchSection(container, webSearch) {
  if (!container) return;
  container.innerHTML = "";
  if (!webSearch) return;

  const header = document.createElement("div");
  header.className = "web-search-header";

  const title = document.createElement("span");
  title.className = "web-search-title";
  title.textContent = "联网搜索";

  const status = document.createElement("span");
  status.className = `web-search-status ${webSearch.status || "ready"}`;

  // 添加spinner元素
  const spinner = document.createElement("span");
  spinner.className = "web-search-status-spinner";
  status.appendChild(spinner);

  // 添加状态文本
  const statusText = document.createElement("span");
  statusText.textContent =
    webSearch.status === "loading"
      ? "搜索中"
      : webSearch.status === "error"
      ? "搜索失败"
      : "联网搜索";
  status.appendChild(statusText);

  header.appendChild(status);
  header.appendChild(title);

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
        const link = document.createElement("a");
        link.href = r.url || "#";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = r.title || r.url || "(无标题)";
        item.appendChild(link);

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

  // 绑定折叠/展开事件
  header.addEventListener("click", () => {
    container.classList.toggle("collapsed");
    container.classList.toggle("expanded");
    // 用户手动操作后，标记为已手动操作，取消自动折叠
    container.dataset.userToggled = "1";
  });

  container.appendChild(header);
  container.appendChild(body);

  // 默认折叠状态
  container.classList.add("collapsed");
  container.classList.remove("expanded");
}

function formatToolEventText(event) {
  if (!event || typeof event !== "object") return "";
  const name = event.name || "未知工具";
  const status = event.status || "info";

  if (status === "start") {
    const args = event.arguments && typeof event.arguments === "object"
      ? JSON.stringify(event.arguments, null, 0)
      : "";
    return args ? `调用 ${name}，参数：${truncateText(args, 120)}` : `调用 ${name}`;
  }

  if (status === "error") {
    return `${name} 失败：${event.resultSummary || event.error || "未知错误"}`;
  }

  if (status === "success") {
    return `${name} 完成：${event.resultSummary || "调用完成"}`;
  }


  return `${name}：${event.resultSummary || ""}`;
}

function renderToolEvents(sectionEl, listEl, events) {
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
    const li = document.createElement("li");
    li.className = `tool-call-item ${event.status || "info"}`;
    li.textContent = formatToolEventText(event);
    listEl.appendChild(li);
  });
}

function renderSources(sectionEl, sources) {
  if (!sectionEl) return;
  const items = Array.isArray(sources) ? sources : [];
  if (!items.length) {
    sectionEl.style.display = "none";
    sectionEl.innerHTML = "";
    return;
  }

  sectionEl.style.display = "block";
  sectionEl.innerHTML = "";

  const title = document.createElement("div");
  title.className = "sources-title";
  title.textContent = "来源";
  sectionEl.appendChild(title);

  const list = document.createElement("div");
  list.className = "sources-list";

  items.forEach((s) => {
    const chip = document.createElement("a");
    chip.className = "source-chip";
    chip.href = s.url || "#";
    chip.target = "_blank";
    chip.rel = "noopener noreferrer";

    // Favicon
    let hostname = "";
    try { hostname = new URL(s.url).hostname; } catch (_) {}
    const favicon = document.createElement("img");
    favicon.className = "source-chip-favicon";
    favicon.src = hostname
      ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`
      : "";
    favicon.alt = "";
    favicon.loading = "lazy";
    favicon.onerror = function () {
      this.style.display = "none";
    };

    // Body (title + url)
    const body = document.createElement("div");
    body.className = "source-chip-body";

    const label = document.createElement("span");
    label.className = "source-chip-label";
    label.textContent = s.title || hostname || s.url;

    const urlLine = document.createElement("span");
    urlLine.className = "source-chip-url";
    urlLine.textContent = hostname;

    body.appendChild(label);
    body.appendChild(urlLine);

    chip.appendChild(favicon);
    chip.appendChild(body);
    list.appendChild(chip);
  });

  sectionEl.appendChild(list);
}

function buildPromptWithWebSearch(originalPrompt, webSearch) {
  const results = Array.isArray(webSearch?.results) ? webSearch.results : [];
  const lines = [];
  lines.push(
    "你将获得一些联网搜索结果。请优先基于这些结果作答。来源链接会自动展示在回复下方，回复中无需重复列出参考链接。"
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

function normalizeTavilySearchDepth(value) {
  return String(value || "").toLowerCase() === "advanced"
    ? "advanced"
    : "basic";
}

function normalizeWebSearchProvider(value) {
  return String(value || "").toLowerCase() === "exa" ? "exa" : "tavily";
}

function normalizeExaSearchType(value) {
  return String(value || "").toLowerCase() === "instant" ? "instant" : "auto";
}

function setStatusPillState(el, isReady, text) {
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-ready", !!isReady);
  el.classList.toggle("is-pending", !isReady);
}

function updateConfigStatusStrip() {
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

function updateWebSearchProviderUi() {
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

async function tavilySearch(
  query,
  apiKey,
  maxResults = 5,
  searchDepth = "basic"
) {
  if (window.location.protocol === "file:") {
    throw new Error(
      "当前是 file:// 打开页面，无法调用本地接口；请用 python server.py 方式访问 http://localhost:3000"
    );
  }

  const resp = await fetch("/api/tavily/search", {
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

function bindEvents() {
  elements.saveConfig.addEventListener("click", saveConfig);
  elements.clearConfig.addEventListener("click", clearConfig);

  // 联网搜索开关的label元素，阻止焦点转移
  const webSearchLabel = elements.enableWebSearch?.parentElement;
  if (webSearchLabel) {
    webSearchLabel.addEventListener("mousedown", (e) => {
      // 只阻止label本身的默认行为，不阻止checkbox的点击
      if (
        e.target === webSearchLabel ||
        e.target.classList.contains("switch-track") ||
        e.target.classList.contains("switch-text") ||
        e.target.tagName === "svg" ||
        e.target.tagName === "path"
      ) {
        e.preventDefault();
      }
    });
  }

  elements.enableWebSearch?.addEventListener("change", (e) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.config);
      const config = raw ? JSON.parse(raw) : {};
      config.webSearch = config.webSearch || {};
      config.webSearch.enabled = !!elements.enableWebSearch.checked;
      localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(config));
    } catch (e) {
      console.error("保存联网搜索开关失败:", e);
    }
  });

  elements.webSearchProvider?.addEventListener("change", () => {
    updateWebSearchProviderUi();
    updateConfigStatusStrip();
  });
  elements.tavilyApiKey?.addEventListener("input", updateConfigStatusStrip);
  elements.exaApiKey?.addEventListener("input", updateConfigStatusStrip);
  elements.exaSearchType?.addEventListener("change", updateConfigStatusStrip);
  elements.tavilyMaxResults?.addEventListener("input", updateConfigStatusStrip);
  elements.tavilySearchDepth?.addEventListener("change", updateConfigStatusStrip);


  // 思考强度下拉选择器
  elements.reasoningEffortSelector?.addEventListener("click", (e) => {
    // 点击选项
    const btn = e.target.closest("button[data-value]");
    if (btn) {
      elements.reasoningEffortDropdown.querySelectorAll("button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      elements.reasoningEffortValue.textContent = btn.dataset.label;
      elements.reasoningEffortSelector.classList.remove("open");
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.config);
        const config = raw ? JSON.parse(raw) : {};
        config.reasoningEffort = btn.dataset.value;
        localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(config));
      } catch (e) {
        console.error("保存思考强度失败:", e);
      }
      return;
    }
    // 点击触发器，切换展开
    if (e.target.closest(".reasoning-effort-current")) {
      elements.reasoningEffortSelector.classList.toggle("open");
    }
  });

  // 点击外部关闭下拉
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".reasoning-effort-selector")) {
      elements.reasoningEffortSelector?.classList.remove("open");
    }
  });

  elements.openConfigBtn?.addEventListener("click", openConfigModal);
  elements.closeConfigBtn?.addEventListener("click", closeConfigModal);
  elements.configTabs?.addEventListener("click", (e) => {
    const tabBtn = e.target?.closest?.(".config-tab[data-tab]");
    if (!tabBtn) return;
    setActiveConfigTab(tabBtn.dataset.tab);
  });
  elements.configModal?.addEventListener("click", (e) => {
    if (e.target === elements.configModal) closeConfigModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (isPromptConfirmDialogOpen()) {
      e.preventDefault();
      resolvePromptConfirmDialog(false);
      return;
    }
    closeConfigModal();
  });

  elements.sendBtn.addEventListener("click", onSendButtonClick);

  // 滚动到底部按钮
  elements.scrollToBottomBtn?.addEventListener("click", () => {
    state.autoScroll = true;
    scrollToBottom(elements.chatMessages, true);
  });

  // 监听聊天消息区域的滚动事件，控制按钮显示和自动滚动状态
  elements.chatMessages?.addEventListener("scroll", () => {
    updateScrollToBottomButton();

    // 检测用户是否手动向上滚动（不在底部）
    if (!isNearBottom(elements.chatMessages)) {
      state.autoScroll = false;
    } else {
      // 如果用户滚回底部，重新启用自动滚动
      state.autoScroll = true;
    }
  });

  elements.newTopicBtn.addEventListener("click", () => {
    if (state.chat.isCreatingTopic) return; // 防止重复创建

    // 检查当前话题是否为空（无消息）
    const currentTopic = getActiveTopic();
    if (currentTopic) {
      const hasRealContent = currentTopic.turns.some(
        (turn) => turn.prompt?.trim()
      );

      if (!hasRealContent && currentTopic.turns.length <= 1) {
        // 当前话题为空，无需创建新话题
        elements.promptInput.focus();
        return;
      }
    }

    state.chat.isCreatingTopic = true;
    try {
      const topic = createTopic();
      setActiveTopic(topic.id);
      collapseSidebarForMobile();
      renderAll();
      elements.promptInput.focus();
    } finally {
      state.chat.isCreatingTopic = false;
    }
  });

  // 监听提供商变化，更新API地址提示 + 自动获取模型列表
  elements.provider.addEventListener("change", () => {
    updateProviderUi();
    updateModelHint();
    updateConfigStatusStrip();
    scheduleFetchModels("main", 0);
  });

  elements.apiKey?.addEventListener("input", () => {
    updateModelHint();
    updateConfigStatusStrip();
    scheduleFetchModels("main", 400);
  });
  elements.apiUrl?.addEventListener("input", () => {
    updateModelHint();
    updateConfigStatusStrip();
    scheduleFetchModels("main", 500);
  });

  elements.roleSetting?.addEventListener("blur", () => {
    showRoleSettingPreview();
  });
  elements.roleSettingPreview?.addEventListener("click", () => {
    showRoleSettingEditor(true);
  });
  elements.roleSettingPreview?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      showRoleSettingEditor(true);
    }
  });

  // 监听模型名称变化
  elements.model.addEventListener("input", () => {
    updateModelNames();
    updateConfigStatusStrip();
    updateModelDropdownFilter("main");
  });

  elements.modelDropdownBtn?.addEventListener("click", () =>
    toggleModelDropdown("main")
  );
  elements.model?.addEventListener("focus", () =>
    updateModelDropdownFilter("main")
  );

  document.addEventListener("mousedown", (e) => {
    const t = e.target;
    if (!(t instanceof Node)) return;
    if (t.closest?.(".model-picker") || t.closest?.(".model-dropdown")) return;
    closeModelDropdown("main");
    closeAllConfigSelectPickers();
  });
  elements.configContent?.addEventListener("scroll", repositionOpenFloatingDropdowns);
  window.addEventListener("resize", repositionOpenFloatingDropdowns);

  // Enter 发送（Shift+Enter 换行）
  elements.promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!isTopicRunning(state.chat.activeTopicId)) sendPrompt();
    }
  });

  elements.promptInput.addEventListener("input", autoGrowPromptInput);

  // 图片上传按钮点击事件
  elements.imageUploadBtn?.addEventListener("mousedown", (e) => {
    e.preventDefault(); // 阻止按钮获得焦点，避免触发输入框容器的选中效果
  });
  elements.imageUploadBtn?.addEventListener("click", () => {
    elements.imageInput?.click();
  });

  // 文件选择事件
  elements.imageInput?.addEventListener("change", (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      addImages(files);
    }
    // 清空input，允许重复选择同一文件
    e.target.value = "";
  });

  // 粘贴图片事件
  elements.promptInput?.addEventListener("paste", async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles = [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      await addImages(imageFiles);
    }
  });

  elements.toggleSidebarBtn?.addEventListener("click", toggleSidebar);
  elements.expandSidebarBtn?.addEventListener("click", toggleSidebar);
}

function setActiveConfigTab(tabName = "model") {
  const tabs = document.querySelectorAll(".config-tab[data-tab]");
  const panels = document.querySelectorAll(".config-tab-panel[data-panel]");
  if (!tabs.length || !panels.length) return;

  const target = String(tabName || "model");
  let found = false;

  tabs.forEach((tab) => {
    const active = tab.dataset.tab === target;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
    if (active) found = true;
  });

  const finalTab = found ? target : "model";
  panels.forEach((panel) => {
    const active = panel.dataset.panel === finalTab;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
  closeModelDropdown("main");
  closeAllConfigSelectPickers();

  if (elements.configContent) {
    elements.configContent.scrollTop = 0;
  }
}

function openConfigModal() {
  if (!elements.configModal) return;
  setActiveConfigTab("model");
  syncAllConfigSelectPickers();
  elements.configModal.classList.add("open");
  elements.configModal.setAttribute("aria-hidden", "false");
  syncBodyScrollLock();
  updateModelHint();
  syncRoleSettingPreview(true);
  updateConfigStatusStrip();
  scheduleFetchModels("main", 0);
}

function closeConfigModal() {
  if (!elements.configModal) return;
  elements.configModal.classList.remove("open");
  elements.configModal.setAttribute("aria-hidden", "true");
  syncBodyScrollLock();
  closeModelDropdown("main");
  closeAllConfigSelectPickers();
}

function showRoleSettingEditor(focus = false) {
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

function showRoleSettingPreview() {
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

function syncRoleSettingPreview(preferPreview = true) {
  const text = (elements.roleSetting?.value || "").trim();
  if (preferPreview && text) {
    showRoleSettingPreview();
    return;
  }
  showRoleSettingEditor(false);
}

function autoGrowPromptInput() {
  const el = elements.promptInput;
  if (!el) return;

  const maxHeight = 160; // 与 CSS max-height 保持一致
  el.style.height = "0px";
  const nextHeight = Math.min(el.scrollHeight, maxHeight);
  el.style.height = `${nextHeight}px`;
  el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
}

function setSendButtonMode(mode) {
  if (!elements.sendBtn) return;
  const nextMode = mode === "stop" ? "stop" : "send";
  elements.sendBtn.dataset.mode = nextMode;
  if (nextMode === "stop") {
    elements.sendBtn.title = "停止生成";
    elements.sendBtn.setAttribute("aria-label", "停止生成");
  } else {
    elements.sendBtn.title = "发送";
    elements.sendBtn.setAttribute("aria-label", "发送");
  }
}

function onSendButtonClick() {
  if (isTopicRunning(state.chat.activeTopicId)) stopGeneration();
  else sendPrompt();
}

// 更新滚动到底部按钮的显示状态
function updateScrollToBottomButton() {
  if (!elements.chatMessages || !elements.scrollToBottomBtn) return;

  const { scrollTop, scrollHeight, clientHeight } = elements.chatMessages;
  const nearBottom = scrollHeight - scrollTop - clientHeight < 100;

  // 如果接近底部，隐藏按钮；否则显示按钮
  elements.scrollToBottomBtn.style.display = nearBottom ? "none" : "flex";
}

function updateProviderUi() {
  const provider = elements.provider?.value || "openai";
  const hintEl = elements.providerHint;

  if (hintEl) {
    if (provider === "openai") {
      hintEl.textContent =
        "OpenAI 兼容接口，请填写 API 地址。";
    } else if (provider === "anthropic") {
      hintEl.textContent =
        "Anthropic 兼容接口，请填写 API 地址。";
    }
  }

  updateApiUrlPlaceholder();
  updateModelHint();
}

function updateApiUrlPlaceholder() {
  const providerEl = elements.provider;
  const urlInput = elements.apiUrl;
  if (!providerEl || !urlInput) return;

  const provider = providerEl.value;
  const placeholders = {
    openai: "https://api.openai.com/v1/chat/completions",
    anthropic: "https://api.anthropic.com/v1/messages",
  };
  urlInput.placeholder = placeholders[provider] || "";
}

function updateModelNames() {
  const modelVal = elements.model.value || "";

  // 更新模型名称（未配置时不显示任何内容）
  elements.modelName.textContent = modelVal || "";

  // 根据配置状态显示/隐藏模型行
  const modelLine = elements.modelName.closest(".brand-model");
  if (modelLine) {
    modelLine.style.display = modelVal ? "" : "none";
  }
}

function getConfigFromForm(side) {
  // 如果是标题模型，从主配置中获取
  if (side === "Title") {
    return {
      provider: elements.provider?.value || "openai",
      apiKey: elements.apiKey?.value || "",
      apiUrl: elements.apiUrl?.value || "",
    };
  }

  return {
    provider: elements.provider?.value || "openai",
    apiKey: elements.apiKey?.value || "",
    apiUrl: elements.apiUrl?.value || "",
  };
}

function setModelHint(side, text) {
  if (side === "Title") return;
  const el = elements.modelHint;
  if (!el) return;
  el.textContent = text || "";
}

function updateModelHint(side) {
  const config = getConfigFromForm(side || "main");
  const apiKey = (config.apiKey || "").trim();
  const apiUrl = (config.apiUrl || "").trim();

  if (!apiKey) {
    setModelHint(
      side || "main",
      "先填写 API Key、API 地址，再拉取模型列表。"
    );
    return;
  }

  if (!apiUrl) {
    setModelHint(
      side || "main",
      "先填写 API 地址，再拉取模型列表。"
    );
    return;
  }

  setModelHint(
    side || "main",
    "填模型ID；可下拉选或手动输入。"
  );
}

function getCachedModelIds(side) {
  const slot = state.modelFetch[side];
  return Array.isArray(slot?.models) ? slot.models : [];
}

function getModelDropdownLimit(side) {
  const slot = state.modelFetch[side];
  if (!slot) return 120;
  return Math.max(40, Math.min(2000, Number(slot.dropdownLimit) || 120));
}

function resetModelDropdownLimit(side) {
  const slot = state.modelFetch[side];
  if (!slot) return;
  slot.dropdownLimit = 120;
}

function increaseModelDropdownLimit(side, delta = 200) {
  const slot = state.modelFetch[side];
  if (!slot) return;
  slot.dropdownLimit =
    getModelDropdownLimit(side) + Math.max(40, Number(delta) || 200);
}

function isModelDropdownOpen(side) {
  const el = side === "Title" ? elements.modelDropdownTitle : elements.modelDropdown;
  return !!el && !el.hidden;
}

function setModelDropdownButtonState(side, isOpen) {
  const btn = side === "Title" ? elements.modelDropdownBtnTitle : elements.modelDropdownBtn;
  if (!btn) return;
  btn.classList.toggle("open", !!isOpen);
  btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

function closeModelDropdown(side) {
  const el = side === "Title" ? elements.modelDropdownTitle : elements.modelDropdown;
  if (!el) return;
  el.onscroll = null;
  el.hidden = true;
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = "";
  closeFloatingDropdown(el);
  setModelDropdownButtonState(side, false);
}

function renderModelDropdown(side, filterText) {
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
      ? "无匹配模型，可继续输入。"
      : isLoading
      ? "正在获取模型列表…"
      : "暂无模型列表，请先配置Key/地址。";
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
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      const input =
        side === "Title"
          ? elements.titleGenerationModel
          : elements.model;
      if (input) input.value = id;
      if (side !== "Title") updateModelNames();
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
    more.addEventListener("mousedown", (e) => e.preventDefault());
    more.addEventListener("click", () => {
      increaseModelDropdownLimit(side, 240);
      renderModelDropdown(side, filterText);
    });
    dropdownEl.appendChild(more);
  }
}

function openModelDropdown(side) {
  const dropdownEl = side === "Title" ? elements.modelDropdownTitle : elements.modelDropdown;
  const inputEl =
    side === "Title" ? elements.titleGenerationModel : elements.model;
  if (!dropdownEl || !inputEl) return;

  renderModelDropdown(side, inputEl.value);
  openFloatingDropdown(dropdownEl, inputEl);
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

function toggleModelDropdown(side) {
  if (isModelDropdownOpen(side)) closeModelDropdown(side);
  else {
    closeAllConfigSelectPickers();
    openModelDropdown(side);
  }
}

function updateModelDropdownFilter(side) {
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

function normalizeBaseUrlForModels(config) {
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

async function fetchModelsOnce(config) {
  const resp = await fetch("/api/models/list", {
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

function scheduleFetchModels(side, delayMs = 400) {
  const slot = state.modelFetch[side];
  if (!slot) return;

  if (slot.timer) clearTimeout(slot.timer);
  slot.timer = setTimeout(() => {
    slot.timer = null;
    void fetchAndUpdateModels(side);
  }, Math.max(0, delayMs || 0));
}

async function fetchAndUpdateModels(side) {
  const slot = state.modelFetch[side];
  if (!slot || slot.inFlight) return;

  const config = getConfigFromForm(side);
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
        `已获取 ${ids.length} 个模型ID，可下拉选或手动输入。`
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
      setModelHint(side, "自动获取失败，请手动输入模型ID。");
    }
  } finally {
    slot.inFlight = false;
  }
}

async function saveConfig() {
  const provider = elements.provider?.value || "openai";
  const apiKey = (elements.apiKey?.value || "").trim();
  const apiUrl = (elements.apiUrl?.value || "").trim();
  const model = (elements.model?.value || "").trim();

  if (!apiKey || !apiUrl || !model) {
    setActiveConfigTab("model");
    await showAlert("请先完成模型必填项：API Key、API 地址、模型。", {
      title: "缺少必填项",
    });
    return;
  }

  const config = {
    webSearch: {
      enabled: !!elements.enableWebSearch?.checked,
      provider: normalizeWebSearchProvider(elements.webSearchProvider?.value),
      tavilyApiKey: elements.tavilyApiKey?.value || "",
      exaApiKey: elements.exaApiKey?.value || "",
      exaSearchType: normalizeExaSearchType(elements.exaSearchType?.value),
      maxResults: parseInt(elements.tavilyMaxResults?.value) || 5,
      searchDepth: normalizeTavilySearchDepth(
        elements.tavilySearchDepth?.value
      ),
    },
    tools: {
      enabled: true,
    },
    autoTitle: {
      enabled: true,
      model: "",
    },
    model: {
      provider,
      apiKey,
      model,
      apiUrl,
      systemPrompt: elements.roleSetting?.value || "",
    },
  };

  localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(config));
  updateConfigStatusStrip();
  await showAlert("配置已保存", {
    title: "保存成功",
  });
  closeConfigModal();
}

function loadConfig() {
  const saved = localStorage.getItem(STORAGE_KEYS.config);
  const config = saved ? JSON.parse(saved) : {};

  try {
    // 加载联网搜索配置 - 总是设置状态，默认关闭
    if (elements.enableWebSearch) {
      const webSearchEnabled = config.webSearch?.enabled === true;
      elements.enableWebSearch.checked = webSearchEnabled;
    }
    if (config.webSearch) {
      if (elements.webSearchProvider) {
        elements.webSearchProvider.value = normalizeWebSearchProvider(
          config.webSearch.provider
        );
      }
      if (elements.tavilyApiKey)
        elements.tavilyApiKey.value = config.webSearch.tavilyApiKey || "";
      if (elements.exaApiKey)
        elements.exaApiKey.value = config.webSearch.exaApiKey || "";
      if (elements.exaSearchType)
        elements.exaSearchType.value = normalizeExaSearchType(
          config.webSearch.exaSearchType
        );
      if (elements.tavilyMaxResults)
        elements.tavilyMaxResults.value = config.webSearch.maxResults || 5;
      if (elements.tavilySearchDepth) {
        elements.tavilySearchDepth.value = normalizeTavilySearchDepth(
          config.webSearch.searchDepth
        );
      }
    } else if (elements.webSearchProvider) {
      elements.webSearchProvider.value = "tavily";
      if (elements.exaSearchType) elements.exaSearchType.value = "auto";
    }
    // 加载思考强度配置
    if (config.reasoningEffort && elements.reasoningEffortDropdown) {
      elements.reasoningEffortDropdown.querySelectorAll("button").forEach(b => {
        b.classList.toggle("active", b.dataset.value === config.reasoningEffort);
      });
      const activeBtn = elements.reasoningEffortDropdown.querySelector("button.active");
      if (activeBtn && elements.reasoningEffortValue) {
        elements.reasoningEffortValue.textContent = activeBtn.dataset.label;
      }
    }
    // 加载模型配置（兼容旧格式 config.A）
    const modelConfig = config.model || config.A;
    if (modelConfig) {
      elements.provider.value = modelConfig.provider || "openai";
      elements.apiKey.value = modelConfig.apiKey || "";
      elements.model.value = modelConfig.model || "";
      elements.apiUrl.value = modelConfig.apiUrl || "";
      if (elements.roleSetting)
        elements.roleSetting.value =
          modelConfig.systemPrompt || modelConfig.roleSetting || "";
    }
    syncRoleSettingPreview(true);
  } catch (e) {
    console.error("加载配置失败:", e);
  }

  syncAllConfigSelectPickers();
  updateWebSearchProviderUi();
  updateConfigStatusStrip();
}

async function clearConfig() {
  const confirmed = await showConfirm("确定要清除所有配置吗？", {
    title: "清除配置",
    okText: "清除",
    danger: true,
    hint: "此操作会重置当前页面所有本地配置",
  });
  if (!confirmed) return;

  localStorage.removeItem(STORAGE_KEYS.config);

  if (elements.enableWebSearch) elements.enableWebSearch.checked = false;
  if (elements.webSearchProvider) elements.webSearchProvider.value = "tavily";
  if (elements.tavilyApiKey) elements.tavilyApiKey.value = "";
  if (elements.exaApiKey) elements.exaApiKey.value = "";
  if (elements.exaSearchType) elements.exaSearchType.value = "auto";
  if (elements.tavilyMaxResults) elements.tavilyMaxResults.value = 5;
  if (elements.tavilySearchDepth) elements.tavilySearchDepth.value = "basic";

  elements.provider.value = "openai";
  elements.apiKey.value = "";
  elements.model.value = "";
  elements.apiUrl.value = "";
  if (elements.roleSetting) elements.roleSetting.value = "";
  syncRoleSettingPreview(false);

  syncAllConfigSelectPickers();
  updateProviderUi();
  updateWebSearchProviderUi();
  updateModelNames();
  updateConfigStatusStrip();
  await showAlert("配置已清除", {
    title: "操作完成",
  });
  closeConfigModal();
}

// ========== 布局处理函数 ==========

function isMobileLayout() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MOBILE_LAYOUT_MEDIA_QUERY).matches
  );
}

function initLayout() {
  const storedSidebarCollapsed = localStorage.getItem(
    STORAGE_KEYS.isSidebarCollapsed
  );
  localStorage.removeItem("aiPkIsWideMode");
  state.isSidebarCollapsed =
    storedSidebarCollapsed === null
      ? isMobileLayout()
      : storedSidebarCollapsed === "true";

  // 移动端默认折叠侧栏，避免首屏遮挡聊天区域
  if (isMobileLayout()) {
    state.isSidebarCollapsed = true;
  }

  updateLayoutUi();

  const chatLayout = document.querySelector(".chat-layout");
  if (chatLayout) {
    chatLayout.classList.remove("layout-ready");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        chatLayout.classList.add("layout-ready");
      });
    });
  }
}

function updateLayoutUi() {
  const chatLayout = document.querySelector(".chat-layout");

  if (state.isSidebarCollapsed) {
    chatLayout?.classList.add("sidebar-collapsed");
  } else {
    chatLayout?.classList.remove("sidebar-collapsed");
  }
}

function toggleSidebar() {
  state.isSidebarCollapsed = !state.isSidebarCollapsed;
  localStorage.setItem(
    STORAGE_KEYS.isSidebarCollapsed,
    state.isSidebarCollapsed
  );
  updateLayoutUi();
}

function collapseSidebarForMobile() {
  if (!isMobileLayout() || state.isSidebarCollapsed) return;
  state.isSidebarCollapsed = true;
  updateLayoutUi();
}

function getConfig(side) {
  // 标题生成配置：始终跟随主模型
  if (side === "Title") {
    return {
      provider: elements.provider?.value || "openai",
      apiKey: elements.apiKey?.value || "",
      model: elements.model?.value || "",
      apiUrl: elements.apiUrl?.value || "",
      systemPrompt: "", // 标题生成不需要系统提示词
      reasoningEffort: "none",
    };
  }

  return {
    provider: elements.provider?.value || "openai",
    apiKey: elements.apiKey?.value || "",
    model: elements.model?.value || "",
    apiUrl: elements.apiUrl?.value || "",
    // 角色设定：发送给后端作为系统提示词
    systemPrompt: elements.roleSetting?.value || "",
    reasoningEffort: elements.reasoningEffortDropdown?.querySelector("button.active")?.dataset.value || "medium",
  };
}

function getWebSearchConfig() {
  const maxResults = parseInt(elements.tavilyMaxResults?.value);
  return {
    enabled: !!elements.enableWebSearch?.checked,
    provider: normalizeWebSearchProvider(elements.webSearchProvider?.value),
    tavilyApiKey: (elements.tavilyApiKey?.value || "").trim(),
    exaApiKey: (elements.exaApiKey?.value || "").trim(),
    exaSearchType: normalizeExaSearchType(elements.exaSearchType?.value),
    maxResults: maxResults >= 1 && maxResults <= 20 ? maxResults : 5,
    searchDepth: normalizeTavilySearchDepth(elements.tavilySearchDepth?.value),
  };
}


function initChat() {
  const topicsRaw = localStorage.getItem(STORAGE_KEYS.topics);
  const activeRaw = localStorage.getItem(STORAGE_KEYS.activeTopicId);

  if (topicsRaw) {
    try {
      const parsed = JSON.parse(topicsRaw);
      if (Array.isArray(parsed)) {
        state.chat.topics = parsed;
        for (const topic of state.chat.topics) {
          if (
            typeof topic?.title === "string" &&
            /^新话题\s*\d+$/.test(topic.title.trim())
          ) {
            topic.title = "新话题";
          }
          // 兼容旧数据：将 models.A 迁移为 models.main
          if (Array.isArray(topic.turns)) {
            for (const turn of topic.turns) {
              if (turn.models?.A && !turn.models.main) {
                turn.models.main = turn.models.A;
              }
              delete turn.models.A;
              delete turn.models.B;
            }
          }
        }
      }
    } catch (e) {
      console.error("加载话题失败:", e);
    }
  }

  if (activeRaw && state.chat.topics.some((t) => t.id === activeRaw)) {
    state.chat.activeTopicId = activeRaw;
  }

  if (!state.chat.topics.length) {
    const topic = createTopic();
    state.chat.activeTopicId = topic.id;
    saveChatState();
  }

  if (!state.chat.activeTopicId) {
    state.chat.activeTopicId = state.chat.topics[0].id;
  }
}

function scheduleSaveChat() {
  if (state.chat.saveTimer) clearTimeout(state.chat.saveTimer);
  state.chat.saveTimer = setTimeout(() => {
    state.chat.saveTimer = null;
    saveChatState();
  }, 500);
}

function saveChatState() {
  try {
    localStorage.setItem(
      STORAGE_KEYS.topics,
      JSON.stringify(state.chat.topics)
    );
    if (state.chat.activeTopicId)
      localStorage.setItem(
        STORAGE_KEYS.activeTopicId,
        state.chat.activeTopicId
      );
  } catch (e) {
    console.error("保存话题失败:", e);
  }
}

function createTopic(forceCreate = false) {
  // 检查是否已存在空的新话题（避免重复创建）
  if (!forceCreate) {
    const emptyNewTopic = state.chat.topics.find(
      (t) =>
        t.title === "新话题" &&
        t.turns.length === 0
    );

    if (emptyNewTopic) {
      return emptyNewTopic;
    }
  }

  const now = Date.now();
  const topic = {
    id: createId(),
    title: "新话题",
    createdAt: now,
    updatedAt: now,
    turns: [],
  };

  state.chat.topics.unshift(topic);
  scheduleSaveChat();
  return topic;
}

function deleteTopic(topicId) {
  stopGeneration(topicId);
  const before = state.chat.topics.length;
  state.chat.topics = state.chat.topics.filter((t) => t.id !== topicId);
  if (!state.chat.topics.length) {
    const topic = createTopic();
    state.chat.activeTopicId = topic.id;
  } else if (state.chat.activeTopicId === topicId) {
    state.chat.activeTopicId = state.chat.topics[0].id;
  }
  if (before !== state.chat.topics.length) scheduleSaveChat();
}

function getActiveTopic() {
  return (
    state.chat.topics.find((t) => t.id === state.chat.activeTopicId) || null
  );
}

function setActiveTopic(topicId) {
  state.chat.activeTopicId = topicId;
  localStorage.setItem(STORAGE_KEYS.activeTopicId, topicId);
  syncSendButtonModeByActiveTopic();
}

function renderAll() {
  renderTopicList();
  renderChatMessages();
  syncSendButtonModeByActiveTopic();
}

function renderTopicList() {
  if (!elements.topicList) return;

  // 清空列表
  elements.topicList.innerHTML = "";

  const topics = [...state.chat.topics].sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
  );
  const onlyTopic = topics[0] || null;
  const hideDeleteForOnlyNewTopic =
    topics.length === 1 &&
    (onlyTopic?.title || "").trim().startsWith("新话题") &&
    (!Array.isArray(onlyTopic?.turns) || onlyTopic.turns.length === 0);

  for (const topic of topics) {
    const item = document.createElement("div");
    const isGeneratingTitle = state.chat.generatingTitleTopicIds.has(topic.id);
    const isGenerating = isTopicRunning(topic.id);
    item.className = `topic-item${
      topic.id === state.chat.activeTopicId ? " active" : ""
    }${isGeneratingTitle ? " generating-title" : ""}${
      isGenerating ? " running" : ""
    }`;
    item.dataset.topicId = topic.id;

    const title = document.createElement("div");
    title.className = "topic-title";
    title.textContent = topic.title || "未命名话题";

    const meta = document.createElement("div");
    meta.className = "topic-meta";
    meta.textContent = `${topic.turns?.length || 0} 条${
      isGenerating ? " · 生成中" : ""
    } · ${formatTime(
      topic.updatedAt || topic.createdAt
    )}`;

    const footer = document.createElement("div");
    footer.className = "topic-footer";
    footer.appendChild(meta);

    if (!hideDeleteForOnlyNewTopic) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "topic-delete-btn";
      deleteBtn.textContent = "删除";
      deleteBtn.title = "删除该话题";
      deleteBtn.setAttribute(
        "aria-label",
        `删除话题：${topic.title || "未命名话题"}`
      );
      deleteBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (isTopicRunning(topic.id)) {
          const stopThenDelete = await showConfirm(
            "该话题正在生成中，删除前会先停止生成，是否继续？",
            {
              title: "删除话题",
              okText: "继续",
            }
          );
          if (!stopThenDelete) return;
        }

        const confirmed = await showConfirm(
          `确定要删除话题「${topic.title || "未命名话题"}」吗？`,
          {
            title: "删除话题",
            okText: "删除",
            danger: true,
            hint: "",
          }
        );
        if (!confirmed) return;

        deleteTopic(topic.id);
        renderAll();
      });
      footer.appendChild(deleteBtn);
    }

    item.appendChild(title);
    item.appendChild(footer);

    item.addEventListener("click", () => {
      setActiveTopic(topic.id);
      collapseSidebarForMobile();
      renderAll();
    });

    elements.topicList.appendChild(item);
  }

  updateHeaderMeta();
}

function isNearBottom(container, thresholdPx = 150) {
  if (!container) return true;
  const remaining =
    container.scrollHeight - container.scrollTop - container.clientHeight;
  // 增加阈值到 150px，并且考虑浮点数误差
  return remaining <= thresholdPx || remaining < 1;
}

function scrollToBottom(container, smooth = false) {
  if (!container) return;
  if (smooth) {
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  } else {
    container.scrollTop = container.scrollHeight;
  }
}

function renderChatMessages() {
  if (!elements.chatMessages) return;
  elements.chatMessages.innerHTML = "";
  state.chat.turnUiById.clear();

  const topic = getActiveTopic();
  if (!topic || !Array.isArray(topic.turns) || !topic.turns.length) {
    if (elements.scrollToBottomBtn) {
      elements.scrollToBottomBtn.style.display = "none";
    }
    return;
  }

  for (const turn of topic.turns) {
    const { el, cards } = createTurnElement(turn);
    if (cards?.main) {
      state.chat.turnUiById.set(turn.id, cards.main);
    }
    elements.chatMessages.appendChild(el);
  }
  updateScrollToBottomButton();
}

function createTurnElement(turn) {
  const turnEl = document.createElement("div");
  turnEl.className = "turn";
  turnEl.dataset.turnId = turn.id;

  const hasUserImages = Array.isArray(turn.images) && turn.images.length > 0;
  const hasUserText =
    typeof turn.prompt === "string" && turn.prompt.trim().length > 0;
  const hasUserContent = hasUserImages || hasUserText;
  let userWrap = null;

  if (hasUserContent) {
    userWrap = document.createElement("div");
    userWrap.className = "user-bubble-wrap";

    const userBubble = document.createElement("div");
    userBubble.className = "user-bubble";

    // 如果有图片，先显示图片
    if (hasUserImages) {
      const imagesContainer = document.createElement("div");
      imagesContainer.className = "user-images";

      for (const image of turn.images) {
        const imgWrapper = document.createElement("div");
        imgWrapper.className = "user-image-item";

        const img = document.createElement("img");
        img.src = image.dataUrl;
        img.alt = image.name || "用户上传的图片";
        img.loading = "lazy";

        imgWrapper.appendChild(img);
        imagesContainer.appendChild(imgWrapper);
      }

      userBubble.appendChild(imagesContainer);
    }

    // 显示文本消息
    if (hasUserText) {
      const textContent = document.createElement("div");
      textContent.className = "user-text";
      textContent.textContent = turn.prompt;
      userBubble.appendChild(textContent);
    }

    if (hasUserText) {
      const userCopyBtn = createCopyButton(() => turn.prompt || "", {
        label: "复制",
        icon: true,
      });
      userCopyBtn.classList.add("user-copy-btn");
      userWrap.appendChild(userCopyBtn);
    }

    userWrap.appendChild(userBubble);
  }

  let webSearchEl = null;
  if (turn.webSearch) {
    webSearchEl = document.createElement("div");
    webSearchEl.className = "web-search";
    renderWebSearchSection(webSearchEl, turn.webSearch);
  }

  const assistants = document.createElement("div");
  assistants.className = "turn-assistants single-model";

  // 只渲染 A 侧模型卡片（兼容旧数据）
  const cards = {};
  if (turn.models.main) {
    const aCard = createAssistantCard(turn);
    assistants.appendChild(aCard.el);
    cards.main = aCard;
  }

  if (userWrap) turnEl.appendChild(userWrap);
  if (webSearchEl) turnEl.appendChild(webSearchEl);
  turnEl.appendChild(assistants);

  return { el: turnEl, cards, webSearchEl };
}

function createAssistantCard(turn) {
  const side = "main";
  const modelSnapshot = turn?.models?.main?.model || "";
  const contentSnapshot = turn?.models?.main?.content || "";
  const thinkingSnapshot = turn?.models?.main?.thinking || "";
  const toolEventsSnapshot = Array.isArray(turn?.models?.main?.toolEvents)
    ? turn.models.main.toolEvents
    : [];
  const thinkingTimeSnapshot = turn?.models?.main?.thinkingTime || 0;
  const tokenSnapshot = turn?.models?.main?.tokens;
  const timeSnapshot = turn?.models?.main?.timeCostSec;
  const statusSnapshot = turn?.models?.main?.status || "ready";

  const message = document.createElement("div");
  message.className = "assistant-message";

  // 头部：模型名称 + 状态
  const header = document.createElement("div");
  header.className = "assistant-message-header";

  const modelName = document.createElement("span");
  modelName.className = "assistant-model-name";
  modelName.textContent =
    modelSnapshot || elements.modelName.textContent || "未配置";

  const statusEl = document.createElement("span");
  statusEl.className = "status";
  applyStatus(statusEl, statusSnapshot);

  header.appendChild(modelName);
  header.appendChild(statusEl);

  // 内容区域
  const content = document.createElement("div");
  content.className = "assistant-message-content";

  const thinkingSection = document.createElement("div");
  thinkingSection.className = "thinking-section collapsed";
  thinkingSection.style.display = "none";

  const thinkingHeader = document.createElement("div");
  thinkingHeader.className = "thinking-header";
  const thinkingLabel = document.createElement("span");
  thinkingLabel.textContent = "思考过程";
  const thinkingTime = document.createElement("span");
  thinkingTime.className = "thinking-time";
  if (thinkingTimeSnapshot > 0) {
    thinkingTime.textContent = `${thinkingTimeSnapshot.toFixed(1)}s`;
  }
  thinkingHeader.appendChild(thinkingLabel);
  thinkingHeader.appendChild(thinkingTime);
  thinkingHeader.addEventListener("click", () => {
    thinkingSection.dataset.userToggled = "1";
    thinkingSection.classList.toggle("collapsed");
    // 保存折叠状态到数据中
    const collapsed = thinkingSection.classList.contains("collapsed");
    if (turn?.models?.[side]) {
      turn.models[side].thinkingCollapsed = collapsed;
      scheduleSaveChat();
    }
  });

  const thinkingContent = document.createElement("div");
  thinkingContent.className = "thinking-content";
  if (thinkingSnapshot) {
    renderMarkdownToElement(thinkingContent, thinkingSnapshot);
  }

  thinkingSection.appendChild(thinkingHeader);
  thinkingSection.appendChild(thinkingContent);

  if (thinkingSnapshot) {
    thinkingSection.style.display = "block";
    // 如果有保存的折叠状态，使用该状态；否则默认折叠
    const shouldCollapse = turn?.models?.[side]?.thinkingCollapsed !== false;
    if (shouldCollapse) {
      thinkingSection.classList.add("collapsed");
    } else {
      thinkingSection.classList.remove("collapsed");
    }
  }

  const responseSection = document.createElement("div");
  responseSection.className = "response-section";
  const responseContent = document.createElement("div");
  responseContent.className = "response-content";
  renderMarkdownToElement(responseContent, contentSnapshot);
  responseSection.appendChild(responseContent);

  const toolCallsSection = document.createElement("div");
  toolCallsSection.className = "tool-calls-section";
  toolCallsSection.style.display = "none";

  const toolCallsList = document.createElement("ul");
  toolCallsList.className = "tool-calls-list";

  toolCallsSection.appendChild(toolCallsList);
  renderToolEvents(toolCallsSection, toolCallsList, toolEventsSnapshot);

  // 来源链接区域
  const sourcesSnapshot = Array.isArray(turn?.models?.main?.sources)
    ? turn.models.main.sources
    : [];
  const sourcesSection = document.createElement("div");
  sourcesSection.className = "sources-section";
  sourcesSection.style.display = "none";
  renderSources(sourcesSection, sourcesSnapshot);

  content.appendChild(thinkingSection);
  content.appendChild(toolCallsSection);
  content.appendChild(responseSection);
  content.appendChild(sourcesSection);

  // 底部：元数据 + 操作按钮
  const footer = document.createElement("div");
  footer.className = "assistant-message-footer";

  const metaInfo = document.createElement("div");
  metaInfo.className = "message-meta";

  const tokenEl = document.createElement("span");
  tokenEl.className = "meta-item token-count";
  tokenEl.textContent = `${
    Number.isFinite(tokenSnapshot)
      ? tokenSnapshot
      : estimateTokensFromText(contentSnapshot)
  } tokens`;

  const timeEl = document.createElement("span");
  timeEl.className = "meta-item time-cost";
  timeEl.textContent = `${
    Number.isFinite(timeSnapshot) ? timeSnapshot.toFixed(1) : "0.0"
  }s`;

  const speedEl = document.createElement("span");
  speedEl.className = "meta-item token-speed";
  if (
    Number.isFinite(tokenSnapshot) &&
    Number.isFinite(timeSnapshot) &&
    timeSnapshot > 0
  ) {
    const speed = tokenSnapshot / timeSnapshot;
    speedEl.textContent = `${speed.toFixed(1)} t/s`;
  } else {
    speedEl.textContent = "";
    speedEl.style.display = "none";
  }

  metaInfo.appendChild(tokenEl);
  metaInfo.appendChild(timeEl);
  metaInfo.appendChild(speedEl);

  const actions = document.createElement("div");
  actions.className = "message-actions";

  // 复制按钮
  const copyBtn = createCopyButton(() => turn?.models?.[side]?.content || "", {
    label: "复制",
    icon: true,
    className: "action-btn copy-btn",
  });

  actions.appendChild(copyBtn);

  footer.appendChild(metaInfo);
  footer.appendChild(actions);

  message.appendChild(header);
  message.appendChild(content);
  message.appendChild(footer);

  if (
    statusSnapshot === "loading" &&
    (thinkingSnapshot || contentSnapshot || toolEventsSnapshot.length > 0)
  ) {
    message.classList.remove("loading");
    message.classList.add("streaming");
  }

  return {
    el: message,
    statusEl,
    modelNameEl: modelName,
    responseEl: responseContent,
    toolCallsSectionEl: toolCallsSection,
    toolCallsListEl: toolCallsList,
    thinkingSectionEl: thinkingSection,
    thinkingContentEl: thinkingContent,
    thinkingTimeEl: thinkingTime,
    tokenEl,
    timeEl,
    speedEl,
    copyBtn,
    sourcesSectionEl: sourcesSection,
    turn: turn,
    side: side,
  };
}

function applyStatus(statusEl, status) {
  const map = {
    ready: { cls: "ready", text: "就绪" },
    loading: { cls: "loading", text: "生成中..." },
    complete: { cls: "complete", text: "完成" },
    error: { cls: "error", text: "错误" },
    stopped: { cls: "ready", text: "已停止" },
  };
  const next = map[status] || map.ready;
  statusEl.className = `status ${next.cls}`;
  statusEl.textContent = next.text;

  // 同步更新消息的loading状态类和复制按钮状态
  const message = statusEl.closest(".assistant-message");
  if (message) {
    const isLoading = status === "loading";
    if (isLoading) {
      message.classList.add("loading");
      message.classList.remove("streaming");
    } else {
      message.classList.remove("loading");
      message.classList.remove("streaming");
    }

    // 禁用/启用消息的复制按钮
    const copyBtn = message.querySelector(
      ".message-actions .action-btn.copy-btn"
    );
    if (copyBtn) {
      copyBtn.disabled = isLoading;
      copyBtn.style.opacity = isLoading ? "0.5" : "";
      copyBtn.style.cursor = isLoading ? "not-allowed" : "";
    }

    // 禁用/启用所有代码块的复制按钮
    const codeBlockCopyBtns = message.querySelectorAll(".code-copy-btn");
    codeBlockCopyBtns.forEach((btn) => {
      btn.disabled = isLoading;
      btn.style.opacity = isLoading ? "0.5" : "";
      btn.style.cursor = isLoading ? "not-allowed" : "";
    });
  }
}


async function sendPrompt() {
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
    thinking: "",
    toolEvents: [],
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

function stopGeneration(topicId = state.chat.activeTopicId) {
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

async function clearActiveTopicMessages() {
  const topic = getActiveTopic();
  if (!topic) return;
  if (isTopicRunning(topic.id)) {
    const stopThenClear = await showConfirm(
      "当前话题正在生成中，仍要清空并停止生成吗？",
      {
        title: "清空会话",
        okText: "继续",
      }
    );
    if (!stopThenClear) return;
  }
  const confirmed = await showConfirm("确定要清空当前话题的所有消息吗？", {
    title: "清空会话",
    okText: "清空",
    danger: true,
    hint: "",
  });
  if (!confirmed) return;
  if (isTopicRunning(topic.id)) stopGeneration(topic.id);

  topic.turns = [];
  topic.updatedAt = Date.now();
  scheduleSaveChat();
  renderAll();
}

async function callModel(
  prompt,
  config,
  topicId,
  turn,
  ui,
  startTime,
  webSearchConfig
) {
  const resolveUi = () => {
    const nextUi = getLiveTurnUi(turn.id, ui);
    if (nextUi) ui = nextUi;
    return ui;
  };

  const initUi = resolveUi();
  if (initUi) {
    applyStatus(initUi.statusEl, "loading");
    initUi.modelNameEl.textContent = config.model || "未配置";
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
    const response = await fetch("/api/chat/stream", {
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

    // 响应完成后再渲染来源链接，避免来源先于内容显示
    if (uiRef?.sourcesSectionEl && Array.isArray(turn.models.main.sources) && turn.models.main.sources.length) {
      renderSources(uiRef.sourcesSectionEl, turn.models.main.sources);
    }

    if (
      turn.models.main.thinking &&
      uiRef?.thinkingSectionEl?.dataset?.userToggled !== "1"
    ) {
      uiRef.thinkingSectionEl.classList.add("collapsed");
      turn.models.main.thinkingCollapsed = true;
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

// ========== 对话框绑定 ==========

function bindDialogEvents() {
  elements.promptConfirmCancelBtn?.addEventListener("click", () =>
    resolvePromptConfirmDialog(false)
  );

  elements.promptConfirmModal?.addEventListener("click", (e) => {
    if (e.target === elements.promptConfirmModal) {
      resolvePromptConfirmDialog(false);
    }
  });

  elements.promptConfirmOkBtn?.addEventListener("click", () =>
    resolvePromptConfirmDialog(true)
  );
}
// ========== 话题标题自动生成功能 ==========

/**
 * 为话题生成标题
 * @param {string} topicId - 话题ID
 * @param {object} config - 标题生成配置
 * @returns {Promise<string>} 生成的标题
 */
function resolveAutoTitleModel(topic, config) {
  const mainInputModel = (elements.model?.value || "").trim();
  if (mainInputModel) return mainInputModel;

  const turns = Array.isArray(topic?.turns) ? topic.turns : [];
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const usedModel = (turns[i]?.models?.main?.model || "").trim();
    if (usedModel) return usedModel;
  }

  return "";
}

function fallbackTopicTitleFromTurns(topic) {
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

async function generateTopicTitle(topicId, config) {
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
    const response = await fetch("/api/topics/generate-title", {
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

/**
 * 自动为指定话题生成标题（在该话题回复完成后调用）
 */
async function autoGenerateTitle(topicId = state.chat.activeTopicId) {
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
