import { isDesktopRuntime } from "./state.js";
import { openHtmlPreview, openHtmlPreviewForSource } from "./html-preview.js";
import { openImagePreview } from "./dialog.js";

export function initMarkdown() {
  if (typeof marked === "undefined") return;
  marked.setOptions({
    highlight: MARKDOWN_HIGHLIGHTER,
    breaks: true,
    gfm: true,
  });
}

const MARKDOWN_HIGHLIGHTER = function (code, lang) {
  if (typeof hljs !== "undefined") {
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch (e) {
      console.error("代码高亮失败:", e);
    }
  }
  return code;
};

export function renderMarkdownToElement(element, text, options = {}) {
  if (!element) return;
  const skipCodeHighlight = options?.skipCodeHighlight === true;
  if (typeof marked !== "undefined") {
    try {
      element.innerHTML = marked.parse(text || "", {
        highlight: skipCodeHighlight ? null : MARKDOWN_HIGHLIGHTER,
      });
      enhanceRenderedMarkdown(element, options);
      return;
    } catch (e) {
      console.error("Markdown渲染失败:", e);
    }
  }
  element.textContent = text || "";
}

export function enhanceRenderedMarkdown(root, options = {}) {
  if (!root) return;
  const skipCodeHighlight = options?.skipCodeHighlight === true;

  // 手动高亮所有代码块
  if (!skipCodeHighlight && typeof hljs !== "undefined") {
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
  bindMarkdownImagePreview(root);
  // 为所有链接添加 target="_blank" 和 rel="noopener noreferrer"
  const links = root.querySelectorAll("a[href]");
  links.forEach((link) => {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
    bindExternalLinkHandler(link);
  });
}

function bindExternalLinkHandler(link) {
  if (!link || link.dataset.desktopExternalBound === "1") return;

  link.addEventListener("click", async (event) => {
    if (!isDesktopRuntime()) return;
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const href = String(link.href || "").trim();
    if (!isSupportedExternalHref(href)) return;

    event.preventDefault();
    event.stopPropagation();

    const opened = await openExternalHref(href);
    if (!opened) {
      console.error("打开外部链接失败:", href);
    }
  });

  link.dataset.desktopExternalBound = "1";
}

function bindMarkdownImagePreview(root) {
  const images = root.querySelectorAll("img");
  images.forEach((img) => {
    if (!(img instanceof HTMLImageElement)) return;
    if (img.dataset.markdownPreviewBound === "1") return;

    img.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openImagePreview({
        src: img.currentSrc || img.src,
        alt: img.alt || "图片预览",
        trigger: img,
      });
    });

    img.dataset.markdownPreviewBound = "1";
  });
}

function isSupportedExternalHref(href) {
  if (!href) return false;

  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol);
  } catch {
    return false;
  }
}

async function openExternalHref(href) {
  const invoke =
    window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== "function") return false;

  try {
    await invoke("plugin:shell|open", { path: href });
    return true;
  } catch (error) {
    console.error("调用桌面外部链接能力失败:", error);
    return false;
  }
}

export function getLanguageFromCodeEl(codeEl) {
  const className = (codeEl?.className || "").toString();
  const m = className.match(/(?:^|\s)(?:language|lang)-([\w-]+)(?:\s|$)/i);
  return m?.[1] || "";
}

function normalizeMarkupLanguage(language, sourceText = "") {
  const normalizedLanguage = String(language || "").trim().toLowerCase();
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

function createPreviewButton(getMarkup, language = "html", sourceMeta = null) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "code-preview-btn";
  btn.setAttribute("aria-label", "预览 HTML 代码");
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M2.5 12s3.6-6.5 9.5-6.5S21.5 12 21.5 12s-3.6 6.5-9.5 6.5S2.5 12 2.5 12z"></path>
      <circle cx="12" cy="12" r="2.7"></circle>
    </svg>
  `;

  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const markup = typeof getMarkup === "function" ? getMarkup() : getMarkup;
    if (sourceMeta?.turnId) {
      openHtmlPreviewForSource({
        markup,
        language,
        topicId: sourceMeta.topicId,
        turnId: sourceMeta.turnId,
        blockIndex: sourceMeta.blockIndex,
        trigger: btn,
      });
      return;
    }
    openHtmlPreview({
      markup,
      language,
      trigger: btn,
    });
  });

  return btn;
}

export async function copyTextToClipboard(text) {
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

export function createCopyButton(getText, options = {}) {
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
    } else {
      btn.textContent = loadingText;
    }

    const text = typeof getText === "function" ? getText() : getText;
    const ok = await copyTextToClipboard(text);
    if (icon) {
      btn.dataset.copyState = ok ? "success" : "error";
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
        }, 300);
      } else {
        // 错误状态或非图标按钮恢复原状态
        btn.disabled = false;
        if (icon) {
          delete btn.dataset.copyState;
        } else {
          btn.textContent = original;
        }
      }
    }, resetDelayMs);
  });

  return btn;
}

export function addCopyButtonsToCodeBlocks(root) {
  const codeBlocks = root.querySelectorAll("pre > code");
  const previewContextEl = root.closest(".response-content");
  const topicId = String(previewContextEl?.dataset?.topicId || "");
  const turnId = String(previewContextEl?.dataset?.turnId || "");
  const turnCreatedAt = Number(previewContextEl?.dataset?.turnCreatedAt || 0);
  let previewBlockIndex = 0;
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

    const actions = document.createElement("div");
    actions.className = "code-actions";

    const previewLanguage = normalizeMarkupLanguage(
      language,
      codeEl.textContent || ""
    );
    if (previewLanguage) {
      const sourceMeta = turnId
        ? {
            topicId,
            turnId,
            blockIndex: previewBlockIndex,
            turnCreatedAt,
          }
        : null;
      const previewBtn = createPreviewButton(
        () => codeEl.textContent || "",
        previewLanguage,
        sourceMeta
      );
      actions.appendChild(previewBtn);
      previewBlockIndex += 1;
    }

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
      const previewBtn = actions.querySelector(".code-preview-btn");
      if (previewBtn) {
        previewBtn.disabled = true;
      }
    }

    actions.appendChild(btn);
    toolbar.appendChild(actions);

    const parent = preEl.parentNode;
    if (!parent) continue;
    parent.insertBefore(wrapper, preEl);
    wrapper.appendChild(toolbar);
    wrapper.appendChild(preEl);
  }
}
