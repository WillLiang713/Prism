import { state, elements, SHORTCUTS } from './state.js';

let imagePreviewLastTrigger = null;

export function hasOpenModal() {
  return !!document.querySelector(".modal-overlay.open");
}

export function syncBodyScrollLock() {
  document.body.style.overflow = hasOpenModal() ? "hidden" : "";
}

export function isPromptConfirmDialogOpen() {
  return !!elements.promptConfirmModal?.classList.contains("open");
}

export function isImagePreviewOpen() {
  return !!elements.imagePreviewModal?.classList.contains("open");
}

export function openImagePreview({ src = "", alt = "", trigger = null } = {}) {
  if (
    !elements.imagePreviewModal ||
    !elements.imagePreviewImage ||
    !String(src || "").trim()
  ) {
    return;
  }

  imagePreviewLastTrigger = trigger instanceof HTMLElement ? trigger : null;
  elements.imagePreviewImage.src = src;
  elements.imagePreviewImage.alt = alt || "图片预览";

  if (elements.imagePreviewCaption) {
    elements.imagePreviewCaption.textContent = "";
    elements.imagePreviewCaption.hidden = true;
  }

  elements.imagePreviewModal.classList.add("open");
  elements.imagePreviewModal.setAttribute("aria-hidden", "false");
  syncBodyScrollLock();

  window.setTimeout(() => {
    elements.imagePreviewCloseBtn?.focus();
  }, 0);
}

export function closeImagePreview({ restoreFocus = true } = {}) {
  if (!elements.imagePreviewModal) return;

  elements.imagePreviewModal.classList.remove("open");
  elements.imagePreviewModal.setAttribute("aria-hidden", "true");
  syncBodyScrollLock();

  if (restoreFocus && imagePreviewLastTrigger instanceof HTMLElement) {
    imagePreviewLastTrigger.focus();
  }
  imagePreviewLastTrigger = null;
}

export function createShortcutKeysElement(keys = []) {
  const wrap = document.createElement("div");
  wrap.className = "shortcut-keys";
  keys.forEach((key, index) => {
    const kbd = document.createElement("kbd");
    kbd.textContent = key;
    wrap.appendChild(kbd);
    if (index < keys.length - 1) {
      const sep = document.createElement("span");
      sep.className = "shortcut-sep";
      sep.textContent = "+";
      wrap.appendChild(sep);
    }
  });
  return wrap;
}

export function renderShortcutHelpList() {
  if (!elements.shortcutHelpList) return;
  elements.shortcutHelpList.innerHTML = "";

  SHORTCUTS.forEach((item) => {
    const tr = document.createElement("tr");

    const actionTd = document.createElement("td");
    actionTd.className = "shortcut-action";
    actionTd.textContent = item.action;

    const keysTd = document.createElement("td");
    keysTd.appendChild(createShortcutKeysElement(item.keys));

    const noteTd = document.createElement("td");
    noteTd.className = "shortcut-note";
    noteTd.textContent = item.note || "";

    tr.appendChild(actionTd);
    tr.appendChild(keysTd);
    tr.appendChild(noteTd);
    elements.shortcutHelpList.appendChild(tr);
  });
}

export function resolvePromptConfirmDialog(confirmed) {
  if (!elements.promptConfirmModal || !state.dialog.resolver) return;

  const resolver = state.dialog.resolver;
  state.dialog.resolver = null;

  elements.promptConfirmModal.classList.remove("open");
  elements.promptConfirmModal.setAttribute("aria-hidden", "true");
  syncBodyScrollLock();
  resolver(!!confirmed);
}

export function openPromptConfirmDialog(options = {}) {
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

export async function showConfirm(message, options = {}) {
  const confirmed = await openPromptConfirmDialog({
    ...options,
    message,
    showCancel: true,
  });
  return !!confirmed;
}

export async function showAlert(message, options = {}) {
  await openPromptConfirmDialog({
    ...options,
    message,
    showCancel: false,
    okText: options.okText || "知道了",
  });
}

export function bindDialogEvents() {
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

  elements.imagePreviewModal?.addEventListener("click", (e) => {
    if (e.target === elements.imagePreviewModal) {
      closeImagePreview();
    }
  });

  elements.imagePreviewCloseBtn?.addEventListener("click", () => {
    closeImagePreview();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !isImagePreviewOpen()) return;
    e.preventDefault();
    closeImagePreview();
  });
}
