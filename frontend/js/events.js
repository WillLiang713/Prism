import { state, elements, STORAGE_KEYS, MOBILE_LAYOUT_MEDIA_QUERY } from './state.js';
import { toggleLanguage, onLanguageChange } from './i18n.js';
import { showConfirm, isPromptConfirmDialogOpen, resolvePromptConfirmDialog } from './dialog.js';
import {
  openConfigModal,
  closeConfigModal,
  updateProviderUi,
  updateModelNames,
  clearConfig,
  exportConfigBackup,
  importConfigBackup,
  setActiveConfigTab,
  syncRoleSettingPreview,
  showRoleSettingPreview,
  showRoleSettingEditor,
  createService,
  duplicateService,
  deleteService,
  testSelectedServiceConnection,
  autoSaveManagedServiceDraft,
  normalizeApiUrlInputValue,
} from './config.js';
import { applyWebSearchApiKeyValue, applyWebSearchModeValue, applyWebSearchSelection, closeWebSearchToolSelector, isWebSearchEnabled, renderWebSearchToolSelector, positionWebSearchToolSelector, setWebSearchEnabled, setWebSearchToolMode, updateConfigStatusStrip, updateWebSearchProviderUi } from './web-search.js';
import { syncDesktopPreferences } from './desktop.js';
import { scheduleFetchModels, updateModelHint, toggleModelDropdown, closeModelDropdown, updateModelDropdownFilter, getCachedModelIds, openModelDropdown, toggleHeaderModelDropdown, closeHeaderModelDropdown, syncTitleModelFollowPresentation } from './models.js';
import {
  closeAllConfigSelectPickers,
  repositionOpenFloatingDropdowns,
  mountBodyDropdown,
  unmountBodyDropdown,
  clearBodyDropdownPosition,
  positionBodyDropdown,
} from './dropdown.js';
import { setSendButtonMode, autoGrowPromptInput, updateScrollToBottomButton, scrollToBottom, isNearBottom, onSendButtonClick, initScrollbarAutoHide, initTopicListHeaderAlignment, toggleTheme } from './ui.js';
import { sendPrompt, stopGeneration } from './conversation.js';
import {
  triggerCreateTopic,
  isTopicRunning,
  requestDeleteTopic,
  requestClearAllTopics,
  exportTopicsBackup,
  importTopicsBackup,
  closeTopicActionMenu,
  getActiveTopic,
  refreshChatDataPanel,
  setActiveTopic,
  renderAll,
} from './chat.js';
import { addImages } from './images.js';
import {
  toggleSidebar,
  isMobileLayout,
  collapseSidebarForMobile,
  beginMobileNativePickerSession,
  endMobileNativePickerSession,
} from './layout.js';

const PRESS_START_EVENT =
  typeof window !== "undefined" && "PointerEvent" in window
    ? "pointerdown"
    : "mousedown";
const REASONING_DROPDOWN_MIN_WIDTH = 68;
const CHAT_SCROLL_USER_INTENT_MS = 1200;
let lastMobileLayoutState =
  typeof window !== "undefined" ? isMobileLayout() : false;

function markChatScrollIntent() {
  state.chat.userScrollIntentAt = Date.now();
  if (state.chat.suppressScrollToBottomButton) {
    state.chat.suppressScrollToBottomButton = false;
    updateScrollToBottomButton();
  }
}

function markChatScrollbarPointerIntent(e) {
  if (!elements.chatMessages || typeof e?.clientX !== "number") return;
  const rect = elements.chatMessages.getBoundingClientRect();
  const scrollbarGutterPx = 18;
  if (
    e.clientX <= rect.left + scrollbarGutterPx ||
    e.clientX >= rect.right - scrollbarGutterPx
  ) {
    markChatScrollIntent();
  }
}

function isWithinTopicActionUi(target) {
  if (!target || typeof target.closest !== "function") return false;
  return !!target.closest(
    ".topic-action-menu, .topic-action-dropdown.is-floating-topic-menu"
  );
}

function bindStableDropdownToggle(button, onToggle) {
  if (!(button instanceof HTMLElement) || typeof onToggle !== "function") return;
  button.addEventListener(PRESS_START_EVENT, (e) => {
    e.preventDefault();
  });
  button.addEventListener("click", (e) => {
    e.preventDefault();
    onToggle();
  });
}

function getActiveConfigTabName() {
  const activeTab = document.querySelector('.config-tab.is-active[data-tab]');
  return String(activeTab?.dataset?.tab || "").trim() || "services";
}

function toggleConfigModalTab(tabName = "services") {
  const targetTab = typeof tabName === "string" ? tabName : "services";
  const isOpen = !!elements.configModal?.classList.contains("open");
  if (!isOpen) {
    openConfigModal(targetTab);
    return;
  }

  if (getActiveConfigTabName() === targetTab) {
    closeConfigModal();
    return;
  }

  openConfigModal(targetTab);
}

function isReasoningDropdownOpen() {
  return !!elements.reasoningEffortSelector?.classList.contains("open");
}

function mountReasoningDropdown() {
  const dropdownEl = elements.reasoningEffortDropdown;
  if (!(dropdownEl instanceof HTMLElement)) return;
  mountBodyDropdown(dropdownEl);
}

function unmountReasoningDropdown() {
  const dropdownEl = elements.reasoningEffortDropdown;
  if (!(dropdownEl instanceof HTMLElement)) return;
  unmountBodyDropdown(dropdownEl);
}

function clearReasoningDropdownPosition() {
  clearBodyDropdownPosition(elements.reasoningEffortDropdown);
}

function positionReasoningDropdown() {
  const dropdownEl = elements.reasoningEffortDropdown;
  const triggerEl = elements.reasoningEffortSelector?.querySelector(
    ".reasoning-effort-current"
  );
  if (!(dropdownEl instanceof HTMLElement) || !(triggerEl instanceof HTMLElement)) return;

  if (!isReasoningDropdownOpen()) {
    clearReasoningDropdownPosition();
    return;
  }

  if (!isMobileLayout()) {
    clearReasoningDropdownPosition();
    unmountReasoningDropdown();
    return;
  }

  mountReasoningDropdown();
  positionBodyDropdown(dropdownEl, triggerEl, {
    minWidth: REASONING_DROPDOWN_MIN_WIDTH,
    minViewportWidth: 120,
    viewportPadding: 12,
    gap: 8,
    align: "end",
  });
}

function openReasoningDropdown() {
  if (!elements.reasoningEffortSelector) return;
  elements.reasoningEffortSelector.classList.add("open");
  elements.reasoningEffortSelector
    .querySelector(".reasoning-effort-current")
    ?.setAttribute("aria-expanded", "true");
  if (isMobileLayout()) {
    mountReasoningDropdown();
    positionReasoningDropdown();
  } else {
    clearReasoningDropdownPosition();
  }
}

function closeReasoningDropdown() {
  if (!elements.reasoningEffortSelector) return;
  elements.reasoningEffortSelector.classList.remove("open");
  elements.reasoningEffortSelector
    .querySelector(".reasoning-effort-current")
    ?.setAttribute("aria-expanded", "false");
  clearReasoningDropdownPosition();
  unmountReasoningDropdown();
}

function toggleReasoningDropdown() {
  if (isReasoningDropdownOpen()) {
    closeReasoningDropdown();
    return;
  }
  openReasoningDropdown();
}

function handleLayoutModeChange(isMobile) {
  if (isMobile) {
    collapseSidebarForMobile();
  }
  closeModelDropdown("main");
  closeModelDropdown("Title");
  closeHeaderModelDropdown();
  closeAllConfigSelectPickers();
  closeReasoningDropdown();
  closeWebSearchToolSelector();
  lastMobileLayoutState = !!isMobile;
}

export function bindEvents() {
  initScrollbarAutoHide();
  initTopicListHeaderAlignment();
  onLanguageChange(() => {
    refreshChatDataPanel();
  });
  const autoSaveConfigDraft = () => {
    void autoSaveManagedServiceDraft();
  };

  elements.clearConfig?.addEventListener("click", clearConfig);
  elements.exportTopicsBtn?.addEventListener("click", () => {
    void exportTopicsBackup();
  });
  
  elements.importDataBtn?.addEventListener("click", () => {
    elements.importDataInput?.click();
  });

  elements.importDataInput?.addEventListener("change", () => {
    void importTopicsBackup();
  });

  elements.clearTopicsBtn?.addEventListener("click", () => {
    void requestClearAllTopics();
  });

  elements.closeToTrayOnClose?.addEventListener("change", () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.config);
      const config = raw ? JSON.parse(raw) : {};
      config.desktop = config.desktop || {};
      config.desktop.closeToTrayOnClose =
        !!elements.closeToTrayOnClose?.checked;
      localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(config));
    } catch (error) {
      console.error("保存关闭到托盘设置失败:", error);
    }
    void syncDesktopPreferences({
      closeToTray: !!elements.closeToTrayOnClose?.checked,
    });
    autoSaveConfigDraft();
  });

  elements.webSearchProvider?.addEventListener("change", () => {
    updateWebSearchProviderUi();
    updateConfigStatusStrip();
    autoSaveConfigDraft();
  });
  elements.webSearchDefaultMode?.addEventListener("change", () => {
    applyWebSearchSelection(elements.webSearchDefaultMode?.value);
    updateConfigStatusStrip();
    autoSaveConfigDraft();
  });
  elements.webSearchApiKey?.addEventListener("input", () => {
    applyWebSearchApiKeyValue(elements.webSearchApiKey?.value);
    updateConfigStatusStrip();
  });
  elements.webSearchApiKey?.addEventListener("blur", () => {
    applyWebSearchApiKeyValue(elements.webSearchApiKey?.value);
    autoSaveConfigDraft();
  });
  elements.webSearchMode?.addEventListener("change", () => {
    applyWebSearchModeValue(elements.webSearchMode?.value);
  });
  elements.exaSearchType?.addEventListener("change", () => {
    updateConfigStatusStrip();
    autoSaveConfigDraft();
  });
  elements.tavilyMaxResults?.addEventListener("input", updateConfigStatusStrip);
  elements.tavilyMaxResults?.addEventListener("blur", autoSaveConfigDraft);
  elements.tavilyMaxResults?.addEventListener("change", autoSaveConfigDraft);
  elements.tavilySearchDepth?.addEventListener("change", () => {
    updateConfigStatusStrip();
    autoSaveConfigDraft();
  });

  elements.reasoningEffortSelector
    ?.querySelector(".reasoning-effort-current")
    ?.addEventListener("click", () => {
      toggleReasoningDropdown();
    });
  elements.reasoningEffortDropdown?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (!(btn instanceof HTMLButtonElement)) return;
    elements.reasoningEffortDropdown
      .querySelectorAll("button")
      .forEach((button) => button.classList.remove("active"));
    btn.classList.add("active");
    elements.reasoningEffortValue.textContent = btn.dataset.label;
    elements.reasoningEffortSelector?.classList.toggle(
      "is-off",
      btn.dataset.value === "none"
    );
    closeReasoningDropdown();
    autoSaveConfigDraft();
  });

  // 点击外部关闭下拉
  document.addEventListener("click", (e) => {
    const target = e.target;
    if (
      !target.closest?.(".reasoning-effort-selector") &&
      !target.closest?.(".reasoning-effort-dropdown")
    ) {
      closeReasoningDropdown();
    }
    if (!e.target.closest(".web-search-control") && !e.target.closest(".web-search-tool-dropdown")) {
      closeWebSearchToolSelector();
    }
    if (!isWithinTopicActionUi(e.target)) {
      closeTopicActionMenu();
    }
  });

  elements.themeToggleBtn?.addEventListener("click", toggleTheme);
  elements.languageToggleBtn?.addEventListener("click", toggleLanguage);
  elements.openConfigBtn?.addEventListener("click", openConfigModal);
  elements.closeConfigBtn?.addEventListener("click", closeConfigModal);
  elements.createServiceBtn?.addEventListener("click", () => {
    void createService();
  });
  elements.duplicateServiceBtn?.addEventListener("click", () => {
    void duplicateService();
  });
  elements.deleteServiceBtn?.addEventListener("click", () => {
    void deleteService();
  });
  elements.exportConfigBtn?.addEventListener("click", () => {
    void exportConfigBackup();
  });
  elements.importConfigBtn?.addEventListener("click", () => {
    void importConfigBackup();
  });
  elements.testServiceConnectionBtn?.addEventListener("click", () => {
    void testSelectedServiceConnection();
  });
  elements.serviceNameInput?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    autoSaveConfigDraft();
  });
  elements.serviceNameInput?.addEventListener("blur", autoSaveConfigDraft);
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
    closeTopicActionMenu();
    closeConfigModal();
  });

  elements.sendBtn.addEventListener("click", onSendButtonClick);

  // 滚动到底部按钮
  elements.scrollToBottomBtn?.addEventListener("click", () => {
    state.autoScroll = true;
    state.chat.userScrollIntentAt = 0;
    state.chat.suppressScrollToBottomButton = false;
    scrollToBottom(elements.chatMessages, true);
  });

  elements.chatMessages?.addEventListener("wheel", markChatScrollIntent, {
    passive: true,
  });
  elements.chatMessages?.addEventListener("touchmove", markChatScrollIntent, {
    passive: true,
  });
  elements.chatMessages?.addEventListener(
    PRESS_START_EVENT,
    markChatScrollbarPointerIntent,
    { passive: true }
  );
  elements.chatMessages?.addEventListener("keydown", (e) => {
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "PageUp",
        "PageDown",
        "Home",
        "End",
        " ",
      ].includes(e.key)
    ) {
      markChatScrollIntent();
    }
  });

  // 监听聊天消息区域的滚动事件，控制按钮显示和自动滚动状态
  elements.chatMessages?.addEventListener("scroll", () => {
    updateScrollToBottomButton();

    const hasRecentUserScrollIntent =
      Date.now() - Number(state.chat.userScrollIntentAt || 0) <
      CHAT_SCROLL_USER_INTENT_MS;

    if (Date.now() < Number(state.chat.autoScrollLockUntil || 0)) {
      if (hasRecentUserScrollIntent) {
        state.autoScroll = false;
        state.chat.autoScrollLockUntil = 0;
        return;
      }
      state.autoScroll = true;
      return;
    }

    // 检测用户是否手动向上滚动（不在底部）
    if (!isNearBottom(elements.chatMessages)) {
      if (hasRecentUserScrollIntent) {
        state.autoScroll = false;
      }
    } else {
      // 如果用户滚回底部，重新启用自动滚动
      state.autoScroll = true;
    }
  });

  elements.newTopicBtn.addEventListener("click", triggerCreateTopic);

  // 新建话题快捷键：Ctrl+Alt+O
  document.addEventListener("keydown", (e) => {
    if (!isNewTopicShortcut(e)) return;
    e.preventDefault();
    triggerCreateTopic();
  });

  // 删除当前话题快捷键：Ctrl+Alt+Backspace
  document.addEventListener("keydown", async (e) => {
    if (!isDeleteCurrentTopicShortcut(e)) return;
    e.preventDefault();
    await requestDeleteTopic();
  });

  // 切换到上一个话题：Ctrl+Alt+[
  document.addEventListener("keydown", (e) => {
    if (!isPreviousTopicShortcut(e)) return;
    e.preventDefault();
    switchTopicByOffset(-1);
  });

  // 切换到下一个话题：Ctrl+Alt+]
  document.addEventListener("keydown", (e) => {
    if (!isNextTopicShortcut(e)) return;
    e.preventDefault();
    switchTopicByOffset(1);
  });

  // 切换话题栏：Ctrl+B
  document.addEventListener("keydown", (e) => {
    if (!isToggleSidebarShortcut(e)) return;
    e.preventDefault();
    toggleSidebar();
  });

  // 切换主题：Ctrl+Alt+T
  document.addEventListener("keydown", (e) => {
    if (!isToggleThemeShortcut(e)) return;
    e.preventDefault();
    toggleTheme();
  });

  // 打开设置：Ctrl+Alt+S
  document.addEventListener("keydown", (e) => {
    if (!isOpenSettingsShortcut(e)) return;
    e.preventDefault();
    toggleConfigModalTab("services");
  });

  // 查看快捷键：Ctrl+Alt+K
  document.addEventListener("keydown", (e) => {
    if (!isShortcutHelpShortcut(e)) return;
    e.preventDefault();
    toggleConfigModalTab("shortcuts");
  });

  // 密钥输入框明文切换
  document.querySelectorAll(".password-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      btn.querySelector(".eye-open").style.display = isPassword ? "none" : "";
      btn.querySelector(".eye-closed").style.display = isPassword ? "" : "none";
    });
  });

  // 监听接口类型变化，更新 API 地址提示 + 自动获取模型列表
  elements.provider.addEventListener("change", () => {
    setWebSearchToolMode(state.webSearch?.toolMode);
    setWebSearchEnabled(isWebSearchEnabled());
    closeWebSearchToolSelector();
    updateProviderUi();
    updateModelHint();
    updateModelHint("Title");
    updateConfigStatusStrip();
    scheduleFetchModels("main", 0);
    scheduleFetchModels("Title", 0);
    autoSaveConfigDraft();
  });
  elements.builtinWebSearch?.addEventListener("change", () => {
    setWebSearchToolMode(state.webSearch?.toolMode);
    setWebSearchEnabled(isWebSearchEnabled());
    closeWebSearchToolSelector();
    updateProviderUi();
    updateConfigStatusStrip();
    autoSaveConfigDraft();
  });

  elements.apiKey?.addEventListener("input", () => {
    updateModelHint();
    updateModelHint("Title");
    updateConfigStatusStrip();
    scheduleFetchModels("main", 400);
    scheduleFetchModels("Title", 400);
  });
  elements.apiKey?.addEventListener("blur", autoSaveConfigDraft);
  elements.apiUrl?.addEventListener("input", () => {
    updateModelHint();
    updateModelHint("Title");
    updateConfigStatusStrip();
    scheduleFetchModels("main", 500);
    scheduleFetchModels("Title", 500);
  });
  elements.apiUrl?.addEventListener("blur", () => {
    normalizeApiUrlInputValue();
    updateModelHint();
    updateModelHint("Title");
    updateConfigStatusStrip();
    scheduleFetchModels("main", 0);
    scheduleFetchModels("Title", 0);
    autoSaveConfigDraft();
  });

  elements.roleSetting?.addEventListener("blur", () => {
    showRoleSettingPreview();
    autoSaveConfigDraft();
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
    const modelValue = String(elements.model?.value || "").trim();
    if (!modelValue) {
      delete elements.model.dataset.serviceId;
    }
    updateModelNames();
    updateConfigStatusStrip();
    updateModelDropdownFilter("main");
  });
  elements.model?.addEventListener("blur", () => {
    window.setTimeout(() => {
      const activeEl = document.activeElement;
      const keepDropdownOpen =
        activeEl instanceof HTMLElement &&
        (activeEl.closest(".model-picker") || activeEl.closest(".model-dropdown"));
      if (!keepDropdownOpen) {
        closeModelDropdown("main");
      }
      autoSaveConfigDraft();
    }, 0);
  });

  bindStableDropdownToggle(elements.modelDropdownBtn, () =>
    toggleModelDropdown("main")
  );
  bindStableDropdownToggle(elements.headerModelTrigger, () =>
    toggleHeaderModelDropdown()
  );
  elements.titleGenerationModel?.addEventListener("input", () => {
    const titleModelValue = String(elements.titleGenerationModel?.value || "").trim();
    if (!titleModelValue) {
      delete elements.titleGenerationModel.dataset.serviceId;
    }
    updateConfigStatusStrip();
    updateModelDropdownFilter("Title");
    syncTitleModelFollowPresentation();
  });
  elements.titleGenerationModel?.addEventListener("click", () => {
    toggleModelDropdown("Title");
  });
  elements.titleGenerationModel?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleModelDropdown("Title");
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeModelDropdown("Title");
    }
  });
  elements.titleGenerationModel?.addEventListener("blur", () => {
    window.setTimeout(() => {
      const activeEl = document.activeElement;
      const keepDropdownOpen =
        activeEl instanceof HTMLElement &&
        (activeEl.closest(".model-picker") || activeEl.closest(".model-dropdown"));
      if (!keepDropdownOpen) {
        closeModelDropdown("Title");
      }
      syncTitleModelFollowPresentation();
      autoSaveConfigDraft();
    }, 0);
  });

  bindStableDropdownToggle(elements.modelDropdownBtnTitle, () =>
    toggleModelDropdown("Title")
  );

  document.addEventListener(PRESS_START_EVENT, (e) => {
    const t = e.target;
    if (!(t instanceof Node)) return;
    if (t.closest?.(".brand-model-trigger") || t.closest?.(".header-model-dropdown")) {
      return;
    }
    if (t.closest?.(".model-picker") || t.closest?.(".model-dropdown")) return;
    if (isWithinTopicActionUi(t)) return;
    closeModelDropdown("main");
    closeModelDropdown("Title");
    closeHeaderModelDropdown();
    closeAllConfigSelectPickers();
    closeTopicActionMenu();
  });
  document.addEventListener("focusin", (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== "function") return;
    if (t.closest(".brand-model-trigger") || t.closest(".header-model-dropdown")) return;
    if (t.closest(".model-picker") || t.closest(".model-dropdown")) return;
    closeModelDropdown("main");
    closeModelDropdown("Title");
    closeHeaderModelDropdown();
    if (!isWithinTopicActionUi(t)) {
      closeTopicActionMenu();
    }
  });
  elements.configContent?.addEventListener("scroll", repositionOpenFloatingDropdowns);
  elements.topicList?.addEventListener("scroll", () => {
    closeTopicActionMenu();
  });
  window.addEventListener("resize", () => {
    const nextMobileLayoutState = isMobileLayout();
    if (nextMobileLayoutState !== lastMobileLayoutState) {
      handleLayoutModeChange(nextMobileLayoutState);
    }
    updateModelNames();
    renderWebSearchToolSelector();
    repositionOpenFloatingDropdowns();
    positionWebSearchToolSelector();
    positionReasoningDropdown();
    closeTopicActionMenu();
  });
  if (typeof window.matchMedia === "function") {
    const layoutMedia = window.matchMedia(MOBILE_LAYOUT_MEDIA_QUERY);
    const onLayoutMediaChange = (event) => {
      handleLayoutModeChange(event.matches);
      repositionOpenFloatingDropdowns();
      positionWebSearchToolSelector();
      positionReasoningDropdown();
    };
    if (typeof layoutMedia.addEventListener === "function") {
      layoutMedia.addEventListener("change", onLayoutMediaChange);
    } else if (typeof layoutMedia.addListener === "function") {
      layoutMedia.addListener(onLayoutMediaChange);
    }
  }
  window.visualViewport?.addEventListener("resize", repositionOpenFloatingDropdowns, {
    passive: true,
  });
  window.visualViewport?.addEventListener("scroll", repositionOpenFloatingDropdowns, {
    passive: true,
  });
  window.visualViewport?.addEventListener("resize", positionReasoningDropdown, {
    passive: true,
  });
  window.visualViewport?.addEventListener("scroll", positionReasoningDropdown, {
    passive: true,
  });

  // Enter 发送；Shift+Enter 换行（移动端仅换行，避免输入法确认时误发送）
  let promptImeComposing = false;
  let promptImeEndAt = 0;
  let promptImeDeferredSendTimer = 0;
  let imagePickerReturnCleanup = null;
  const PROMPT_IME_GUARD_MS = 120;

  function clearPromptImeDeferredSend() {
    if (!promptImeDeferredSendTimer) return;
    window.clearTimeout(promptImeDeferredSendTimer);
    promptImeDeferredSendTimer = 0;
  }

  function clearImagePickerReturnHooks() {
    imagePickerReturnCleanup?.();
    imagePickerReturnCleanup = null;
  }

  function finishMobileImagePickerSession(delayMs = 120) {
    clearImagePickerReturnHooks();
    endMobileNativePickerSession(delayMs);
  }

  function bindMobileImagePickerReturnHooks() {
    clearImagePickerReturnHooks();

    const handleWindowFocus = () => {
      finishMobileImagePickerSession(120);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      finishMobileImagePickerSession(120);
    };

    window.addEventListener("focus", handleWindowFocus, { once: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);

    imagePickerReturnCleanup = () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }

  function schedulePromptSendAfterImeGuard() {
    clearPromptImeDeferredSend();

    const queuedPromptValue = elements.promptInput.value;
    const queuedImageCount = state.images.selectedImages?.length || 0;
    const remainingGuardMs = Math.max(
      0,
      PROMPT_IME_GUARD_MS - (Date.now() - promptImeEndAt)
    );

    promptImeDeferredSendTimer = window.setTimeout(() => {
      promptImeDeferredSendTimer = 0;

      if (document.activeElement !== elements.promptInput) return;
      if (elements.promptInput.readOnly) return;
      if (promptImeComposing) return;
      if (isMobileLayout()) return;
      if (isTopicRunning(state.chat.activeTopicId)) return;
      if (elements.promptInput.value !== queuedPromptValue) return;

      const currentImageCount = state.images.selectedImages?.length || 0;
      if (currentImageCount !== queuedImageCount) return;

      void sendPrompt();
    }, remainingGuardMs + 10);
  }

  elements.promptInput.addEventListener("compositionstart", () => {
    promptImeComposing = true;
    clearPromptImeDeferredSend();
  });

  elements.promptInput.addEventListener("compositionend", () => {
    promptImeComposing = false;
    promptImeEndAt = Date.now();
  });

  elements.promptInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.shiftKey) return;
    if (elements.promptInput.readOnly) return;

    if (isMobileLayout()) return;

    const isActiveImeEvent =
      e.isComposing ||
      promptImeComposing ||
      e.keyCode === 229;
    if (isActiveImeEvent) return;

    const isWithinImeGuard =
      Date.now() - promptImeEndAt < PROMPT_IME_GUARD_MS;
    if (isWithinImeGuard) {
      e.preventDefault();
      schedulePromptSendAfterImeGuard();
      return;
    }

    e.preventDefault();
    if (!isTopicRunning(state.chat.activeTopicId)) void sendPrompt();
  });

  elements.promptInput.addEventListener("input", () => {
    clearPromptImeDeferredSend();
    autoGrowPromptInput();
  });
  elements.promptInput.addEventListener("blur", clearPromptImeDeferredSend);

  // 图片上传按钮点击事件
  elements.imageUploadBtn?.addEventListener(PRESS_START_EVENT, (e) => {
    e.preventDefault(); // 阻止按钮获得焦点，避免触发输入框容器的选中效果
    if (!isMobileLayout()) return;

    clearPromptImeDeferredSend();
    beginMobileNativePickerSession();
    elements.promptInput?.blur();
  });
  elements.imageUploadBtn?.addEventListener("click", () => {
    if (isMobileLayout()) {
      beginMobileNativePickerSession();
      bindMobileImagePickerReturnHooks();
    }
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
    finishMobileImagePickerSession(60);
  });
  elements.imageInput?.addEventListener("cancel", () => {
    finishMobileImagePickerSession(60);
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
  elements.mobileExpandSidebarBtn?.addEventListener("click", toggleSidebar);
  elements.sidebarScrim?.addEventListener("click", () => {
    if (!isMobileLayout() || state.isSidebarCollapsed) return;
    toggleSidebar();
  });

}

export function isNewTopicShortcut(e) {
  if (!e || e.defaultPrevented || e.repeat || e.isComposing) return false;

  if (shouldBlockGlobalShortcutForTarget(e.target)) return false;

  const key = (e.key || "").toLowerCase();

  if (e.metaKey || e.shiftKey) return false;
  if (!e.ctrlKey || !e.altKey) return false;
  return key === "o";
}

export function isEditableKeyboardTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    target.isContentEditable
  );
}

function isPromptInputTarget(target) {
  return !!elements.promptInput && target === elements.promptInput;
}

function shouldBlockGlobalShortcutForTarget(target) {
  return isEditableKeyboardTarget(target) && !isPromptInputTarget(target);
}

export function isShortcutHelpShortcut(e) {
  if (!e || e.defaultPrevented || e.repeat || e.isComposing) return false;
  if (isPromptConfirmDialogOpen()) return false;
  if (e.metaKey || e.shiftKey) return false;
  if (!e.ctrlKey || !e.altKey) return false;
  const key = (e.key || "").toLowerCase();
  return key === "k";
}

export function isDeleteCurrentTopicShortcut(e) {
  if (!e || e.defaultPrevented || e.repeat || e.isComposing) return false;
  if (isPromptConfirmDialogOpen()) return false;
  if (elements.configModal?.classList.contains("open")) return false;
  if (shouldBlockGlobalShortcutForTarget(e.target)) return false;

  const key = (e.key || "").toLowerCase();

  if (e.metaKey || e.shiftKey) return false;
  if (!e.ctrlKey || !e.altKey) return false;
  return key === "backspace";
}

function isTopicSwitchShortcutBase(e) {
  if (!e || e.defaultPrevented || e.repeat || e.isComposing) return false;
  if (isPromptConfirmDialogOpen()) return false;
  if (elements.configModal?.classList.contains("open")) return false;
  if (shouldBlockGlobalShortcutForTarget(e.target)) return false;
  if (e.metaKey || e.shiftKey) return false;
  return !!e.ctrlKey && !!e.altKey;
}

export function isPreviousTopicShortcut(e) {
  if (!isTopicSwitchShortcutBase(e)) return false;
  const key = (e.key || "").toLowerCase();
  const code = e.code || "";
  return code === "BracketLeft" || key === "[";
}

export function isNextTopicShortcut(e) {
  if (!isTopicSwitchShortcutBase(e)) return false;
  const key = (e.key || "").toLowerCase();
  const code = e.code || "";
  return code === "BracketRight" || key === "]";
}

export function isToggleSidebarShortcut(e) {
  if (!e || e.defaultPrevented || e.repeat || e.isComposing) return false;
  if (isPromptConfirmDialogOpen()) return false;
  if (elements.configModal?.classList.contains("open")) return false;
  if (shouldBlockGlobalShortcutForTarget(e.target)) return false;

  const key = (e.key || "").toLowerCase();

  if (e.metaKey || e.altKey || e.shiftKey) return false;
  if (!e.ctrlKey) return false;
  return key === "b";
}

export function isToggleThemeShortcut(e) {
  if (!e || e.defaultPrevented || e.repeat || e.isComposing) return false;
  if (isPromptConfirmDialogOpen()) return false;
  if (e.metaKey || e.shiftKey) return false;
  if (!e.ctrlKey || !e.altKey) return false;

  const key = (e.key || "").toLowerCase();
  const code = e.code || "";
  return key === "t" || code === "KeyT";
}

export function isOpenSettingsShortcut(e) {
  if (!e || e.defaultPrevented || e.repeat || e.isComposing) return false;
  if (isPromptConfirmDialogOpen()) return false;
  if (e.metaKey || e.shiftKey) return false;
  if (!e.ctrlKey || !e.altKey) return false;

  const key = (e.key || "").toLowerCase();
  return key === "s";
}

function switchTopicByOffset(offset) {
  const topics = Array.isArray(state.chat.topics) ? state.chat.topics : [];
  if (topics.length < 2) return;

  const activeTopic = getActiveTopic();
  const currentIndex = topics.findIndex((topic) => topic.id === activeTopic?.id);
  const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeCurrentIndex + offset + topics.length) % topics.length;
  const nextTopic = topics[nextIndex] || null;
  if (!nextTopic || nextTopic.id === activeTopic?.id) return;

  closeTopicActionMenu();
  setActiveTopic(nextTopic.id);
  renderAll();
}
