import {
  state,
  elements,
  SHORTCUTS,
  isDesktopRuntime,
  buildApiUrl,
} from './state.js';

let imagePreviewLastTrigger = null;

function inferPreviewImageExtension(src = "") {
  const normalized = String(src || "").trim().toLowerCase();
  if (normalized.startsWith("data:image/")) {
    const mime = normalized.slice("data:image/".length).split(/[;,]/, 1)[0];
    if (mime === "jpeg") return "jpg";
    if (mime) return mime;
  }
  if (normalized.includes(".png")) return "png";
  if (normalized.includes(".webp")) return "webp";
  if (normalized.includes(".gif")) return "gif";
  if (normalized.includes(".jpg") || normalized.includes(".jpeg")) return "jpg";
  return "png";
}

function blobFromDataUrl(dataUrl) {
  const raw = String(dataUrl || "");
  const parts = raw.split(",", 2);
  if (parts.length !== 2) {
    throw new Error("无效的图片数据");
  }
  const header = parts[0];
  const body = parts[1];
  const mimeMatch = header.match(/^data:([^;]+);base64$/i);
  const mimeType = mimeMatch?.[1] || "image/png";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function getDesktopDialogSave() {
  if (!isDesktopRuntime()) return null;
  return window.__TAURI__?.dialog?.save || null;
}

function getDesktopFsWriteFile() {
  if (!isDesktopRuntime()) return null;
  return window.__TAURI__?.fs?.writeFile || null;
}

function buildImageProxyUrl(src) {
  const normalizedSrc = String(src || "").trim();
  if (!/^https?:\/\//i.test(normalizedSrc)) {
    return normalizedSrc;
  }
  return buildApiUrl(`/proxy/file?url=${encodeURIComponent(normalizedSrc)}`);
}

async function resolvePreviewImageFile(src) {
  const normalizedSrc = String(src || "").trim();
  if (!normalizedSrc) {
    throw new Error("没有可保存的图片");
  }

  let blob = null;
  if (normalizedSrc.startsWith("data:")) {
    blob = blobFromDataUrl(normalizedSrc);
  } else {
    const response = await fetch(buildImageProxyUrl(normalizedSrc));
    if (!response.ok) {
      throw new Error(`图片读取失败: HTTP ${response.status}`);
    }
    blob = await response.blob();
  }

  const extension = inferPreviewImageExtension(normalizedSrc);
  const fileName = `prism-image-${Date.now()}.${extension}`;
  return { blob, fileName, extension };
}

function triggerImageDownload(blob, fileName) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1000);
}

async function saveImageWithDesktopApi(blob, fileName, extension) {
  const save = getDesktopDialogSave();
  const writeFile = getDesktopFsWriteFile();
  if (typeof save !== "function" || typeof writeFile !== "function") {
    throw new Error("桌面保存接口不可用");
  }

  const normalizedExtension = String(extension || "png").trim().toLowerCase();
  const filterExtension = normalizedExtension === "jpg" ? "jpeg" : normalizedExtension;
  const savePath = await save({
    defaultPath: fileName,
    filters: [
      {
        name: "图片",
        extensions: [filterExtension],
      },
    ],
  });

  if (!savePath) {
    throw new Error("save cancelled");
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  await writeFile(savePath, bytes);
}

async function savePreviewImage() {
  const imageSrc = String(elements.imagePreviewImage?.src || "").trim();
  if (!imageSrc) {
    return;
  }

  const saveButton = elements.imagePreviewSaveBtn;
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.dataset.saving = "1";
  }

  try {
    const { blob, fileName, extension } = await resolvePreviewImageFile(imageSrc);

    if (isDesktopRuntime()) {
      await saveImageWithDesktopApi(blob, fileName, extension);
    } else {
      triggerImageDownload(blob, fileName);
    }
  } catch (error) {
    const message = String(error?.message || "").trim();
    if (message && /abort|cancel|canceled/i.test(message)) {
      return;
    }
    console.error("保存图片失败:", error);
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      delete saveButton.dataset.saving;
    }
  }
}

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

    tr.appendChild(actionTd);
    tr.appendChild(keysTd);
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

  elements.imagePreviewSaveBtn?.addEventListener("click", async () => {
    await savePreviewImage();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !isImagePreviewOpen()) return;
    e.preventDefault();
    closeImagePreview();
  });
}
