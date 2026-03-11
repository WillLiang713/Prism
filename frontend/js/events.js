import { state, elements, STORAGE_KEYS } from './state.js';
import { showConfirm, isPromptConfirmDialogOpen, isShortcutHelpModalOpen, resolvePromptConfirmDialog, openShortcutHelpModal, closeShortcutHelpModal } from './dialog.js';
import { openConfigModal, closeConfigModal, updateProviderUi, updateModelNames, saveConfig, clearConfig, setActiveConfigTab, syncRoleSettingPreview, showRoleSettingPreview, showRoleSettingEditor } from './config.js';
import { updateConfigStatusStrip, updateWebSearchProviderUi } from './web-search.js';
import { scheduleFetchModels, updateModelHint, toggleModelDropdown, closeModelDropdown, updateModelDropdownFilter } from './models.js';
import { closeAllConfigSelectPickers, repositionOpenFloatingDropdowns } from './dropdown.js';
import { setSendButtonMode, autoGrowPromptInput, updateScrollToBottomButton, scrollToBottom, isNearBottom, onSendButtonClick } from './ui.js';
import { sendPrompt, stopGeneration } from './conversation.js';
import { triggerCreateTopic, isTopicRunning } from './chat.js';
import { addImages } from './images.js';
import { toggleSidebar, isMobileLayout } from './layout.js';

export function bindEvents() {
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
  elements.openShortcutHelpBtn?.addEventListener("click", openShortcutHelpModal);
  elements.closeShortcutHelpBtn?.addEventListener("click", closeShortcutHelpModal);
  elements.configTabs?.addEventListener("click", (e) => {
    const tabBtn = e.target?.closest?.(".config-tab[data-tab]");
    if (!tabBtn) return;
    setActiveConfigTab(tabBtn.dataset.tab);
  });
  elements.configModal?.addEventListener("click", (e) => {
    if (e.target === elements.configModal) closeConfigModal();
  });
  elements.shortcutHelpModal?.addEventListener("click", (e) => {
    if (e.target === elements.shortcutHelpModal) closeShortcutHelpModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (isPromptConfirmDialogOpen()) {
      e.preventDefault();
      resolvePromptConfirmDialog(false);
      return;
    }
    if (isShortcutHelpModalOpen()) {
      e.preventDefault();
      closeShortcutHelpModal();
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

  elements.newTopicBtn.addEventListener("click", triggerCreateTopic);

  // 新建话题快捷键：Mac Cmd+Alt+N / Windows-Linux Ctrl+Alt+N
  document.addEventListener("keydown", (e) => {
    if (!isNewTopicShortcut(e)) return;
    e.preventDefault();
    triggerCreateTopic();
  });

  // 打开快捷键帮助：Shift+/
  document.addEventListener("keydown", (e) => {
    if (!isShortcutHelpShortcut(e)) return;
    e.preventDefault();
    openShortcutHelpModal();
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

  elements.modelCustomName?.addEventListener("input", () => {
    updateModelNames();
    updateConfigStatusStrip();
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

  // Enter 发送；Shift+Enter 换行（移动端仅换行，避免输入法确认时误发送）
  let promptImeComposing = false;
  let promptImeEndAt = 0;
  const PROMPT_IME_GUARD_MS = 120;

  elements.promptInput.addEventListener("compositionstart", () => {
    promptImeComposing = true;
  });

  elements.promptInput.addEventListener("compositionend", () => {
    promptImeComposing = false;
    promptImeEndAt = Date.now();
  });

  elements.promptInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.shiftKey) return;

    const isImeGuarded =
      e.isComposing ||
      promptImeComposing ||
      e.keyCode === 229 ||
      Date.now() - promptImeEndAt < PROMPT_IME_GUARD_MS;
    if (isImeGuarded) return;

    if (isMobileLayout()) return;

    e.preventDefault();
    if (!isTopicRunning(state.chat.activeTopicId)) sendPrompt();
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

export function isNewTopicShortcut(e) {
  if (!e || e.defaultPrevented || e.repeat || e.isComposing) return false;

  if (isEditableKeyboardTarget(e.target)) return false;

  const key = (e.key || "").toLowerCase();
  const hasAlt = !!e.altKey;
  const isMacShortcut = !!e.metaKey && !e.ctrlKey;
  const isWinLinuxShortcut = !!e.ctrlKey && !e.metaKey;

  return key === "n" && hasAlt && (isMacShortcut || isWinLinuxShortcut);
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

export function isShortcutHelpShortcut(e) {
  if (!e || e.defaultPrevented || e.repeat || e.isComposing) return false;
  if (isPromptConfirmDialogOpen()) return false;
  if (elements.configModal?.classList.contains("open")) return false;
  if (isEditableKeyboardTarget(e.target)) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const key = (e.key || "").toLowerCase();
  return e.shiftKey && (key === "?" || key === "/");
}
