import { state, STORAGE_KEYS, MOBILE_LAYOUT_MEDIA_QUERY, elements } from './state.js';

let mobileViewportBound = false;
let mobileViewportFrame = 0;
let lastVisibleHeight = 0;
let lastViewportOffsetTop = 0;
let lastKeyboardInset = 0;

export function isMobileLayout() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MOBILE_LAYOUT_MEDIA_QUERY).matches
  );
}

function syncMobileViewportVars() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const root = document.documentElement;
  const viewport = window.visualViewport;
  const visibleHeight = Math.round(viewport?.height || window.innerHeight || 0);
  const viewportOffsetTop = Math.round(viewport?.offsetTop || 0);
  const keyboardInset = viewport
    ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
    : 0;

  root.style.setProperty("--mobile-visible-height", `${visibleHeight}px`);
  root.style.setProperty("--mobile-viewport-offset-top", `${viewportOffsetTop}px`);
  root.style.setProperty("--mobile-keyboard-inset", `${keyboardInset}px`);

  const hasViewportChanged =
    visibleHeight !== lastVisibleHeight ||
    viewportOffsetTop !== lastViewportOffsetTop ||
    keyboardInset !== lastKeyboardInset;

  lastVisibleHeight = visibleHeight;
  lastViewportOffsetTop = viewportOffsetTop;
  lastKeyboardInset = keyboardInset;

  return hasViewportChanged;
}

function keepPromptVisible() {
  if (!isMobileLayout()) return;
  if (document.activeElement !== elements.promptInput) return;

  requestAnimationFrame(() => {
    elements.chatMessages?.scrollTo({
      top: elements.chatMessages.scrollHeight,
      behavior: "auto",
    });
    elements.promptInput?.scrollIntoView({ block: "nearest" });
  });
}

function scheduleMobileViewportSync(forceKeepPromptVisible = false) {
  if (mobileViewportFrame) {
    cancelAnimationFrame(mobileViewportFrame);
  }

  mobileViewportFrame = requestAnimationFrame(() => {
    mobileViewportFrame = 0;
    const hasViewportChanged = syncMobileViewportVars();
    if (forceKeepPromptVisible || hasViewportChanged) {
      keepPromptVisible();
    }
  });
}

function bindMobileViewport() {
  if (mobileViewportBound || typeof window === "undefined") return;
  mobileViewportBound = true;

  scheduleMobileViewportSync();

  window.addEventListener("resize", scheduleMobileViewportSync, { passive: true });
  window.addEventListener("orientationchange", scheduleMobileViewportSync, {
    passive: true,
  });

  window.visualViewport?.addEventListener("resize", scheduleMobileViewportSync, {
    passive: true,
  });
  window.visualViewport?.addEventListener("scroll", scheduleMobileViewportSync, {
    passive: true,
  });

  elements.promptInput?.addEventListener("focus", () => {
    scheduleMobileViewportSync(true);
    window.setTimeout(() => scheduleMobileViewportSync(true), 180);
  });

  elements.promptInput?.addEventListener("blur", () => {
    window.setTimeout(scheduleMobileViewportSync, 120);
  });
}

export function initLayout() {
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
  bindMobileViewport();

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

export function updateLayoutUi() {
  const chatLayout = document.querySelector(".chat-layout");

  if (state.isSidebarCollapsed) {
    chatLayout?.classList.add("sidebar-collapsed");
  } else {
    chatLayout?.classList.remove("sidebar-collapsed");
  }
}

export function toggleSidebar() {
  state.isSidebarCollapsed = !state.isSidebarCollapsed;
  localStorage.setItem(
    STORAGE_KEYS.isSidebarCollapsed,
    state.isSidebarCollapsed
  );
  updateLayoutUi();
}

export function collapseSidebarForMobile() {
  if (!isMobileLayout() || state.isSidebarCollapsed) return;
  state.isSidebarCollapsed = true;
  updateLayoutUi();
}
