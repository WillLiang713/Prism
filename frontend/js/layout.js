import { state, STORAGE_KEYS, MOBILE_LAYOUT_MEDIA_QUERY } from './state.js';

export function isMobileLayout() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MOBILE_LAYOUT_MEDIA_QUERY).matches
  );
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
