import { state, elements, isDesktopRuntime, getDesktopWindowBridge, delay, buildApiUrl, BOOTSTRAP_HEALTH_TIMEOUT_MS, BOOTSTRAP_HEALTH_INTERVAL_MS, PRISM_RUNTIME, isDesktopBackendAvailable } from './state.js';
import { setSendButtonMode, autoGrowPromptInput } from './ui.js';
import { updateModelHint, scheduleFetchModels } from './models.js';

let promptLayoutSyncToken = 0;
const PROMPT_PLACEHOLDER = "随便聊点什么吧";
const DESKTOP_PREFERENCES_COMMAND = "update_desktop_preferences";

function getTauriInvoke() {
  return window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke || null;
}

export async function syncDesktopPreferences(options = {}) {
  if (!isDesktopRuntime()) return;

  const invoke = getTauriInvoke();
  if (typeof invoke !== "function") return;

  try {
    await invoke(DESKTOP_PREFERENCES_COMMAND, {
      payload: {
        closeToTray: options.closeToTray === true,
      },
    });
  } catch (error) {
    console.error("同步桌面关闭行为失败:", error);
  }
}

function schedulePromptLayoutSync() {
  if (!elements.promptInput) return;

  const token = ++promptLayoutSyncToken;
  window.requestAnimationFrame(() => {
    if (token !== promptLayoutSyncToken) return;
    autoGrowPromptInput();
  });
}

export function applyDesktopWindowState() {
  document.body.classList.toggle(
    "is-window-maximized",
    !!state.runtime.isWindowMaximized
  );
  document.body.classList.toggle(
    "is-window-blurred",
    state.runtime.isWindowFocused === false
  );

  if (elements.windowMaximizeBtn) {
    elements.windowMaximizeBtn.setAttribute(
    "title",
    state.runtime.isWindowMaximized ? "还原" : "最大化"
  );
    elements.windowMaximizeBtn.setAttribute(
    "aria-label",
    state.runtime.isWindowMaximized ? "还原" : "最大化"
  );
  }
}

export async function syncDesktopWindowState() {
  const appWindow = state.runtime.desktopWindow;
  if (!appWindow) return;

  try {
    state.runtime.isWindowMaximized = await appWindow.isMaximized();
  } catch (_error) {
    state.runtime.isWindowMaximized = false;
  }

  try {
    state.runtime.isWindowFocused = await appWindow.isFocused();
  } catch (_error) {
    state.runtime.isWindowFocused = true;
  }

  applyDesktopWindowState();
}

export async function initDesktopWindowShell() {
  if (!isDesktopRuntime()) return;

  const appWindow = getDesktopWindowBridge();
  state.runtime.desktopWindow = appWindow;
  if (!appWindow) {
    console.warn("Desktop window bridge unavailable");
    return;
  }

  await syncDesktopPreferences({
    closeToTray: true,
  });

  bindDesktopTitlebarControls(appWindow);
  await syncDesktopWindowState();

  if (typeof appWindow.onResized === "function") {
    appWindow.onResized(() => {
      syncDesktopWindowState();
    });
  }
  if (typeof appWindow.onFocusChanged === "function") {
    appWindow.onFocusChanged(({ payload }) => {
      state.runtime.isWindowFocused = payload !== false;
      applyDesktopWindowState();
    });
  }
}

export function bindDesktopTitlebarControls(appWindow) {
  if (elements.desktopTitlebar && !elements.desktopTitlebar.dataset.bound) {
    elements.desktopTitlebar.addEventListener("dblclick", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest(".no-drag")) return;
      appWindow.toggleMaximize().then(syncDesktopWindowState).catch(console.error);
    });
    elements.desktopTitlebar.dataset.bound = "1";
  }

  if (elements.windowMinimizeBtn && !elements.windowMinimizeBtn.dataset.bound) {
    elements.windowMinimizeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      appWindow.minimize().catch(console.error);
    });
    elements.windowMinimizeBtn.dataset.bound = "1";
  }

  if (elements.windowMaximizeBtn && !elements.windowMaximizeBtn.dataset.bound) {
    elements.windowMaximizeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      appWindow.toggleMaximize().then(syncDesktopWindowState).catch(console.error);
    });
    elements.windowMaximizeBtn.dataset.bound = "1";
  }

  if (elements.windowCloseBtn && !elements.windowCloseBtn.dataset.bound) {
    elements.windowCloseBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      appWindow.close().catch(console.error);
    });
    elements.windowCloseBtn.dataset.bound = "1";
  }
}

export function syncDesktopBackendUi() {
  const isReady = isDesktopBackendAvailable();
  const promptPlaceholder = PROMPT_PLACEHOLDER;
  if (elements.promptInput) {
    elements.promptInput.disabled = false;
    elements.promptInput.readOnly = !isReady;
    elements.promptInput.setAttribute("aria-readonly", String(!isReady));
    elements.promptInput.placeholder = promptPlaceholder;
    elements.promptInput.title = isReady ? "" : promptPlaceholder;
  }

  if (elements.sendBtn) {
    elements.sendBtn.disabled = !isReady;
    if (!isReady) {
      elements.sendBtn.title = promptPlaceholder;
      elements.sendBtn.setAttribute("aria-label", promptPlaceholder);
    } else {
      setSendButtonMode(elements.sendBtn.dataset.mode);
    }
  }

  updateModelHint("main");
  schedulePromptLayoutSync();
}

export function flushPendingModelFetches() {
  for (const [side, slot] of Object.entries(state.modelFetch)) {
    if (!slot?.pendingAfterReady) continue;
    slot.pendingAfterReady = false;
    scheduleFetchModels(side, 0);
  }
}

export async function beginDesktopBackendBootstrap(options = {}) {
  if (!isDesktopRuntime() || state.runtime.bootstrapInFlight) return;

  state.runtime.bootstrapInFlight = true;
  state.runtime.backendReady = false;
  state.runtime.backendFailed = false;
  state.runtime.backendLastError = "";
  syncDesktopBackendUi();

  try {
    const startupError = options.ignoreStartupError
      ? ""
      : String(PRISM_RUNTIME.startupError || "").trim();
    if (startupError) {
      throw new Error(startupError);
    }

    await waitForDesktopBackend();
    state.runtime.backendReady = true;
    state.runtime.backendFailed = false;
    state.runtime.backendLastError = "";
    flushPendingModelFetches();
  } catch (error) {
    console.error("desktop backend bootstrap failed:", error);
    state.runtime.backendReady = false;
    state.runtime.backendFailed = true;
    state.runtime.backendLastError =
      error instanceof Error ? error.message : String(error || "未知错误");
  } finally {
    state.runtime.bootstrapInFlight = false;
    syncDesktopBackendUi();
  }
}

export async function waitForDesktopBackend() {
  const deadline = Date.now() + BOOTSTRAP_HEALTH_TIMEOUT_MS;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(buildApiUrl("/api/health"), {
        method: "GET",
        cache: "no-store",
      });

      if (response.ok) {
        const payload = await response.json();
        if (payload?.status === "ok") return payload;
        lastError = "健康检查返回格式异常";
      } else {
        lastError = `健康检查失败：HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error || "");
    }

    state.runtime.backendLastError = lastError;
    syncDesktopBackendUi();
    await delay(BOOTSTRAP_HEALTH_INTERVAL_MS);
  }

  throw new Error(lastError || "本地服务启动超时，请检查 sidecar 或端口占用情况");
}
