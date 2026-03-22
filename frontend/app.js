// ============================================================
// Prism – 模块入口
// ============================================================

import { state, isDesktopRuntime } from './js/state.js';
import { initMarkdown } from './js/markdown.js';
import { initHtmlPreview } from './js/html-preview.js';
import { initConfigSelectPickers, syncAllConfigSelectPickers, setCloseModelDropdown } from './js/dropdown.js';
import { renderShortcutHelpList, bindDialogEvents } from './js/dialog.js';
import { bindEvents } from './js/events.js';
import { setSendButtonMode, autoGrowPromptInput, startHeaderClock, setConversationFns, setChatFns } from './js/ui.js';
import { initLayout } from './js/layout.js';
import { initDesktopWindowShell, syncDesktopBackendUi, beginDesktopBackendBootstrap } from './js/desktop.js';
import { closeModelDropdown, setConfigFns } from './js/models.js';
import { loadConfig, updateProviderUi, updateModelNames, getConfigFromForm, autoSaveManagedServiceDraft, applyHeaderModelSelection, getServiceDisplayName } from './js/config.js';
import { updateConfigStatusStrip } from './js/web-search.js';
import { initChat, renderAll, getActiveTopic, isTopicRunning, setStopGeneration, setRegenerateTurn, setSubmitTurnEdit, setRegenerateTopicTitle } from './js/chat.js';
import { sendPrompt, stopGeneration, regenerateTurn, submitTurnEdit, regenerateTopicTitle } from './js/conversation.js';

// ---- 连接模块间的延迟绑定 ----
setCloseModelDropdown(closeModelDropdown);
setConfigFns({
  updateModelNames,
  getConfigFromForm,
  autoSaveManagedServiceDraft,
  applyHeaderModelSelection,
  getServiceDisplayName,
});
setConversationFns(sendPrompt, stopGeneration);
setChatFns(getActiveTopic, isTopicRunning);
setStopGeneration(stopGeneration);
setRegenerateTurn(regenerateTurn);
setSubmitTurnEdit(submitTurnEdit);
setRegenerateTopicTitle(regenerateTopicTitle);

// ---- 启动 ----
document.addEventListener("DOMContentLoaded", () => {
  bootstrapApplication();
});

function bootstrapApplication() {
  if (state.runtime.bootstrapped) return;

  startApplication();
  state.runtime.bootstrapped = true;

  if (isDesktopRuntime()) {
    void beginDesktopBackendBootstrap();
  } else {
    syncDesktopBackendUi();
  }
}

function startApplication() {
  document.body.classList.toggle("is-desktop-runtime", isDesktopRuntime());
  initMarkdown();
  initHtmlPreview();
  initConfigSelectPickers();
  loadConfig();
  syncAllConfigSelectPickers();
  updateProviderUi();
  initChat();
  renderShortcutHelpList();
  bindEvents();
  bindDialogEvents();
  updateModelNames();
  setSendButtonMode("send");
  updateConfigStatusStrip();
  initLayout();
  renderAll();
  startHeaderClock();
  initDesktopWindowShell();
  syncDesktopBackendUi();
  autoGrowPromptInput();
}
