import { elements } from "./state.js";

const PREVIEW_CLOSE_DURATION_MS = 260;
const INLINE_PREVIEW_MEDIA_QUERY = "(min-width: 901px)";
const MOBILE_PREVIEW_MEDIA_QUERY = "(max-width: 900px)";
const FENCED_CODE_BLOCK_PATTERN = /```([^\n`]*)\r?\n([\s\S]*?)```/g;
const FRAME_LOAD_FAILSAFE_MS = 1200;

const previewState = {
  initialized: false,
  isOpen: false,
  markup: "",
  language: "html",
  hideTimer: 0,
  lastTrigger: null,
  activeObjectUrl: "",
  sourceTopicId: "",
  sourceTurnId: "",
  sourceBlockIndex: -1,
  sourceTurnCreatedAt: 0,
  frameLoadPending: false,
  frameLoadFailsafeTimer: 0,
};

function normalizeLanguage(language) {
  return String(language || "").trim().toLowerCase();
}

function normalizeMarkupLanguage(language, sourceText = "") {
  const normalizedLanguage = normalizeLanguage(language);
  if (["html", "htm", "xml", "svg"].includes(normalizedLanguage)) {
    return normalizedLanguage === "htm" ? "html" : normalizedLanguage;
  }

  const text = String(sourceText || "").trim();
  const looksLikeMarkup =
    text.startsWith("<") &&
    /<\/?[a-z][\w:-]*[\s>]/i.test(text);

  if (!normalizedLanguage && looksLikeMarkup) {
    if (/<svg[\s>]/i.test(text)) return "svg";
    return "html";
  }

  return "";
}

function extractPreviewBlocksFromMarkdown(markdownText = "") {
  const source = String(markdownText || "");
  const blocks = [];
  let match = null;
  while ((match = FENCED_CODE_BLOCK_PATTERN.exec(source))) {
    const language = normalizeMarkupLanguage(match[1] || "", match[2] || "");
    if (!language) continue;
    blocks.push({
      markup: String(match[2] || ""),
      language,
    });
  }
  return blocks;
}

function setPreviewSource({
  topicId = "",
  turnId = "",
  blockIndex = -1,
  turnCreatedAt = 0,
} = {}) {
  previewState.sourceTopicId = String(topicId || "");
  previewState.sourceTurnId = String(turnId || "");
  previewState.sourceBlockIndex = Number.isInteger(blockIndex) ? blockIndex : -1;
  previewState.sourceTurnCreatedAt = Number(turnCreatedAt) || 0;
}

function resolvePreviewBlock(blocks, blockIndex = -1) {
  if (!Array.isArray(blocks) || !blocks.length) return null;
  if (!Number.isInteger(blockIndex) || blockIndex < 0) return blocks[0];
  return blocks[Math.min(blockIndex, blocks.length - 1)] || blocks[0];
}

function applyPreviewContent(markup, language, { forceReload = true } = {}) {
  const nextMarkup = String(markup || "");
  if (!nextMarkup.trim()) return;
  previewState.markup = nextMarkup;
  previewState.language = normalizeLanguage(language) || "html";
  renderPreview(forceReload);
}

function isInlinePreviewLayout() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(INLINE_PREVIEW_MEDIA_QUERY).matches
  );
}

function escapeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function revokeActiveObjectUrl() {
  if (!previewState.activeObjectUrl) return;
  try {
    URL.revokeObjectURL(previewState.activeObjectUrl);
  } catch (_error) {
    // 忽略已失效或浏览器不支持的场景
  }
  previewState.activeObjectUrl = "";
}

function clearFrameLoadFailsafeTimer() {
  if (!previewState.frameLoadFailsafeTimer) return;
  window.clearTimeout(previewState.frameLoadFailsafeTimer);
  previewState.frameLoadFailsafeTimer = 0;
}

function setFrameLoading(isLoading) {
  previewState.frameLoadPending = !!isLoading;
  elements.htmlPreviewDrawer?.classList.toggle("is-loading", !!isLoading);

  if (!isLoading) {
    clearFrameLoadFailsafeTimer();
    return;
  }

  clearFrameLoadFailsafeTimer();
  previewState.frameLoadFailsafeTimer = window.setTimeout(() => {
    previewState.frameLoadFailsafeTimer = 0;
    setFrameLoading(false);
  }, FRAME_LOAD_FAILSAFE_MS);
}

function buildPreviewDocument(markup) {
  const source = String(markup || "");
  const baseHref = escapeHtmlAttribute(document.baseURI || window.location.href || "/");
  const hasBaseTag = /<base[\s>]/i.test(source);
  const baseTag = hasBaseTag ? "" : `<base href="${baseHref}">`;

  if (/<!doctype\s+html/i.test(source) || /<html[\s>]/i.test(source)) {
    if (hasBaseTag) return source;

    if (/<head[\s>]/i.test(source)) {
      return source.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
    }

    if (/<html([\s>][\s\S]*?)>/i.test(source)) {
      return source.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}</head>`);
    }

    return `${baseTag}${source}`;
  }

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${baseTag}
  </head>
  <body>${source}</body>
</html>`;
}

function supportsFrameSrcdoc() {
  return !!elements.htmlPreviewFrame && "srcdoc" in elements.htmlPreviewFrame;
}

function shouldPreferSrcdocPreview() {
  if (!supportsFrameSrcdoc()) return false;

  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MOBILE_PREVIEW_MEDIA_QUERY).matches
  );
}

function syncFrameContent(forceReload = false) {
  if (!elements.htmlPreviewFrame) return;

  const nextMarkup = previewState.markup || "";
  const nextDocument = buildPreviewDocument(nextMarkup);
  if (!forceReload && elements.htmlPreviewFrame.dataset.previewDocument === nextDocument) {
    return;
  }

  revokeActiveObjectUrl();
  setFrameLoading(true);
  elements.htmlPreviewFrame.dataset.previewDocument = nextDocument;

  if (shouldPreferSrcdocPreview()) {
    elements.htmlPreviewFrame.removeAttribute("src");
    elements.htmlPreviewFrame.srcdoc = nextDocument;
    return;
  }

  elements.htmlPreviewFrame.removeAttribute("srcdoc");
  elements.htmlPreviewFrame.src = "about:blank";

  window.requestAnimationFrame(() => {
    if (!elements.htmlPreviewFrame) return;

    if (typeof Blob === "function" && window.URL && typeof URL.createObjectURL === "function") {
      const blob = new Blob([nextDocument], { type: "text/html;charset=utf-8" });
      previewState.activeObjectUrl = URL.createObjectURL(blob);
      elements.htmlPreviewFrame.src = previewState.activeObjectUrl;
      return;
    }

    // 兼容不支持 Blob URL 的环境，回退到 srcdoc。
    elements.htmlPreviewFrame.srcdoc = nextDocument;
  });
}

function renderPreview(forceReload = false) {
  const hasMarkup = !!String(previewState.markup || "").trim();

  elements.htmlPreviewDrawer?.classList.toggle("has-content", hasMarkup);
  if (elements.htmlPreviewEmpty) {
    elements.htmlPreviewEmpty.hidden = hasMarkup;
  }

  syncFrameContent(forceReload);
}

function clearHideTimer() {
  if (!previewState.hideTimer) return;
  window.clearTimeout(previewState.hideTimer);
  previewState.hideTimer = 0;
}

function showLayer() {
  if (!elements.htmlPreviewLayer) return;
  clearHideTimer();
  elements.htmlPreviewLayer.hidden = false;
  elements.htmlPreviewLayer.setAttribute("aria-hidden", "false");
  document.body.classList.add("has-html-preview");

  if (isInlinePreviewLayout()) {
    elements.htmlPreviewLayer.classList.add("is-open");
    return;
  }

  window.requestAnimationFrame(() => {
    elements.htmlPreviewLayer?.classList.add("is-open");
  });
}

function hideLayer(restoreFocus = true) {
  if (!elements.htmlPreviewLayer) return;
  clearHideTimer();
  elements.htmlPreviewLayer.classList.remove("is-open");
  elements.htmlPreviewLayer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("has-html-preview");

  if (isInlinePreviewLayout()) {
    elements.htmlPreviewLayer.hidden = true;
    if (restoreFocus && previewState.lastTrigger instanceof HTMLElement) {
      previewState.lastTrigger.focus();
    }
    return;
  }

  previewState.hideTimer = window.setTimeout(() => {
    previewState.hideTimer = 0;
    if (previewState.isOpen) return;
    if (elements.htmlPreviewLayer) {
      elements.htmlPreviewLayer.hidden = true;
    }
  }, PREVIEW_CLOSE_DURATION_MS);

  if (restoreFocus && previewState.lastTrigger instanceof HTMLElement) {
    previewState.lastTrigger.focus();
  }
}

function handleEscape(event) {
  if (event.key !== "Escape" || !previewState.isOpen) return;
  event.preventDefault();
  closeHtmlPreview();
}

function handleLayerPointerDown(event) {
  if (!previewState.isOpen) return;
  if (isInlinePreviewLayout()) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (elements.htmlPreviewDrawer?.contains(target)) return;
  closeHtmlPreview();
}

export function initHtmlPreview() {
  if (previewState.initialized) return;
  if (
    !elements.htmlPreviewLayer ||
    !elements.htmlPreviewDrawer ||
    !elements.htmlPreviewFrame
  ) {
    return;
  }

  previewState.initialized = true;
  renderPreview(true);

  elements.htmlPreviewFrame.addEventListener("load", () => {
    if (!previewState.frameLoadPending) return;
    setFrameLoading(false);
  });
  elements.htmlPreviewFrame.addEventListener("error", () => {
    setFrameLoading(false);
  });

  elements.htmlPreviewBackdrop?.addEventListener("click", () => {
    closeHtmlPreview();
  });
  elements.htmlPreviewCloseBtn?.addEventListener("click", () => {
    closeHtmlPreview();
  });
  document.addEventListener("keydown", handleEscape);
  elements.htmlPreviewLayer.addEventListener("pointerdown", handleLayerPointerDown);
}

export function openHtmlPreview({ markup = "", language = "html", trigger = null } = {}) {
  const nextMarkup = String(markup || "");
  if (!nextMarkup.trim()) return;

  initHtmlPreview();
  applyPreviewContent(nextMarkup, language, { forceReload: true });
  previewState.lastTrigger = trigger instanceof HTMLElement ? trigger : null;
  setPreviewSource();

  if (!previewState.isOpen) {
    previewState.isOpen = true;
    showLayer();
  }

  window.requestAnimationFrame(() => {
    elements.htmlPreviewCloseBtn?.focus();
  });
}

export function closeHtmlPreview() {
  if (!previewState.isOpen) return;
  previewState.isOpen = false;
  revokeActiveObjectUrl();
  hideLayer(true);
}

export function openHtmlPreviewForSource({
  markup = "",
  language = "html",
  topicId = "",
  turnId = "",
  blockIndex = -1,
  turnCreatedAt = 0,
  trigger = null,
} = {}) {
  const nextMarkup = String(markup || "");
  if (!nextMarkup.trim()) return;

  initHtmlPreview();
  applyPreviewContent(nextMarkup, language, { forceReload: true });
  previewState.lastTrigger = trigger instanceof HTMLElement ? trigger : null;
  setPreviewSource({ topicId, turnId, blockIndex, turnCreatedAt });

  if (!previewState.isOpen) {
    previewState.isOpen = true;
    showLayer();
  }

  window.requestAnimationFrame(() => {
    elements.htmlPreviewCloseBtn?.focus();
  });
}

export function syncHtmlPreviewForTurn(topicId, turn, options = {}) {
  const currentTurnId = String(turn?.id || "");
  if (!currentTurnId) return;

  const previewBlocks = extractPreviewBlocksFromMarkdown(
    turn?.models?.main?.content || ""
  );
  const isCurrentSource =
    previewState.sourceTurnId === currentTurnId &&
    previewState.sourceTopicId === String(topicId || "");

  if (isCurrentSource) {
    const nextBlock = resolvePreviewBlock(previewBlocks, previewState.sourceBlockIndex);
    if (nextBlock?.markup) {
      applyPreviewContent(nextBlock.markup, nextBlock.language, {
        forceReload: options.forceReload !== false,
      });
      previewState.sourceTurnCreatedAt = Number(turn?.createdAt) || previewState.sourceTurnCreatedAt;
    }
  }

  const shouldAutoOpen = options.autoOpen === true;
  if (!shouldAutoOpen || turn?.models?.main?.previewAutoOpened === true) {
    return;
  }

  const firstBlock = resolvePreviewBlock(previewBlocks, 0);
  if (!firstBlock?.markup) return;

  turn.models.main.previewAutoOpened = true;
  openHtmlPreviewForSource({
    markup: firstBlock.markup,
    language: firstBlock.language,
    topicId,
    turnId: currentTurnId,
    blockIndex: 0,
    turnCreatedAt: turn?.createdAt,
  });
}

export function reconcileHtmlPreviewWithTopic(topic) {
  if (!previewState.isOpen) return;

  const currentTopicId = String(topic?.id || "");
  const currentTurns = Array.isArray(topic?.turns) ? topic.turns : [];

  if (!currentTopicId) {
    closeHtmlPreview();
    return;
  }

  if (previewState.sourceTopicId && previewState.sourceTopicId !== currentTopicId) {
    closeHtmlPreview();
    return;
  }

  const sourceTurn = currentTurns.find(
    (item) => String(item?.id || "") === previewState.sourceTurnId
  ) || null;

  if (sourceTurn) {
    const sourceBlocks = extractPreviewBlocksFromMarkdown(
      sourceTurn?.models?.main?.content || ""
    );
    if (sourceBlocks.length > 0) {
      const matchedBlock = resolvePreviewBlock(
        sourceBlocks,
        previewState.sourceBlockIndex
      );
      if (matchedBlock?.markup) {
        applyPreviewContent(matchedBlock.markup, matchedBlock.language, {
          forceReload: false,
        });
        previewState.sourceTurnCreatedAt =
          Number(sourceTurn?.createdAt) || previewState.sourceTurnCreatedAt;
      }
      return;
    }

    if (String(sourceTurn?.models?.main?.status || "") === "loading") {
      return;
    }
  }

  const previewableTurns = currentTurns
    .map((item) => {
      const blocks = extractPreviewBlocksFromMarkdown(item?.models?.main?.content || "");
      if (!blocks.length) return null;
      return {
        turn: item,
        blocks,
      };
    })
    .filter(Boolean);

  if (!previewableTurns.length) {
    closeHtmlPreview();
    return;
  }

  const fallback = previewableTurns
    .slice()
    .sort((left, right) => {
      const base = previewState.sourceTurnCreatedAt || 0;
      const leftDelta = Math.abs((Number(left?.turn?.createdAt) || 0) - base);
      const rightDelta = Math.abs((Number(right?.turn?.createdAt) || 0) - base);
      if (leftDelta !== rightDelta) return leftDelta - rightDelta;
      return (Number(right?.turn?.createdAt) || 0) - (Number(left?.turn?.createdAt) || 0);
    })[0];

  if (!fallback?.turn || !fallback?.blocks?.[0]?.markup) {
    closeHtmlPreview();
    return;
  }

  openHtmlPreviewForSource({
    markup: fallback.blocks[0].markup,
    language: fallback.blocks[0].language,
    topicId: currentTopicId,
    turnId: fallback.turn.id,
    blockIndex: 0,
    turnCreatedAt: fallback.turn.createdAt,
    trigger: previewState.lastTrigger,
  });
}
