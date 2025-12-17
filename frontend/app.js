const STORAGE_KEYS = {
    config: 'aiPkConfig',
    topics: 'aiPkTopicsV1',
    activeTopicId: 'aiPkActiveTopicId',
    prompts: 'aiPkPromptsV1',
    activePromptId: 'aiPkActivePromptId'
};

const state = {
    isRunning: false,
    abortControllers: { A: null, B: null },
    modelFetch: {
        A: { timer: null, inFlight: false, lastKey: '', lastFetchedAt: 0, models: [], datalistFillToken: 0, dropdownLimit: 120 },
        B: { timer: null, inFlight: false, lastKey: '', lastFetchedAt: 0, models: [], datalistFillToken: 0, dropdownLimit: 120 }
    },
    chat: {
        topics: [],
        activeTopicId: null,
        saveTimer: null
    },
    images: {
        selectedImages: [] // 存储当前选择的图片 { id, dataUrl, name, size }
    },
    prompts: {
        list: [],
        activeId: null,
        saveTimer: null
    }
};

const elements = {
    // 配置相关
    saveConfig: document.getElementById('saveConfig'),
    clearConfig: document.getElementById('clearConfig'),
    configModal: document.getElementById('configModal'),
    openConfigBtn: document.getElementById('openConfigBtn'),
    closeConfigBtn: document.getElementById('closeConfigBtn'),

    // 联网搜索（Tavily）
    enableWebSearch: document.getElementById('enableWebSearch'),
    tavilyApiKey: document.getElementById('tavilyApiKey'),
    tavilyMaxResults: document.getElementById('tavilyMaxResults'),

    // 对话历史
    enableHistory: document.getElementById('enableHistory'),
    maxHistoryTurns: document.getElementById('maxHistoryTurns'),

    // 输入相关
    promptInput: document.getElementById('promptInput'),
    sendBtn: document.getElementById('sendBtn'),
    imageInput: document.getElementById('imageInput'),
    imageUploadBtn: document.getElementById('imageUploadBtn'),
    imagePreviewContainer: document.getElementById('imagePreviewContainer'),

    // 话题/历史
    newTopicBtn: document.getElementById('newTopicBtn'),
    topicList: document.getElementById('topicList'),
    historyList: document.getElementById('historyList'),
    chatMessages: document.getElementById('chatMessages'),
    scrollToBottomBtn: document.getElementById('scrollToBottomBtn'),

    // 模型A配置
    providerA: document.getElementById('providerA'),
    providerHintA: document.getElementById('providerHintA'),
    customFormatGroupA: document.getElementById('customFormatGroupA'),
    customFormatA: document.getElementById('customFormatA'),
    apiKeyA: document.getElementById('apiKeyA'),
    modelA: document.getElementById('modelA'),
    apiUrlA: document.getElementById('apiUrlA'),
    thinkingA: document.getElementById('thinkingA'),
    modelListA: document.getElementById('modelListA'),
    modelHintA: document.getElementById('modelHintA'),
    modelDropdownA: document.getElementById('modelDropdownA'),
    modelDropdownBtnA: document.getElementById('modelDropdownBtnA'),

    // 模型B配置
    providerB: document.getElementById('providerB'),
    providerHintB: document.getElementById('providerHintB'),
    customFormatGroupB: document.getElementById('customFormatGroupB'),
    customFormatB: document.getElementById('customFormatB'),
    apiKeyB: document.getElementById('apiKeyB'),
    modelB: document.getElementById('modelB'),
    apiUrlB: document.getElementById('apiUrlB'),
    thinkingB: document.getElementById('thinkingB'),
    modelListB: document.getElementById('modelListB'),
    modelHintB: document.getElementById('modelHintB'),
    modelDropdownB: document.getElementById('modelDropdownB'),
    modelDropdownBtnB: document.getElementById('modelDropdownBtnB'),

    // 头部状态
    modelNameA: document.getElementById('modelNameA'),
    modelNameB: document.getElementById('modelNameB'),
    statusA: document.getElementById('statusA'),
    statusB: document.getElementById('statusB'),
    tokenCountA: document.getElementById('tokenCountA'),
    tokenCountB: document.getElementById('tokenCountB'),
    timeCostA: document.getElementById('timeCostA'),
    timeCostB: document.getElementById('timeCostB'),

    // 提示词相关
    promptSelectorBtn: document.getElementById('promptSelectorBtn'),
    promptSelectorLabel: document.getElementById('promptSelectorLabel'),
    promptSelectorModal: document.getElementById('promptSelectorModal'),
    promptSelectorList: document.getElementById('promptSelectorList'),
    closePromptSelectorBtn: document.getElementById('closePromptSelectorBtn'),
    openPromptManagerBtn: document.getElementById('openPromptManagerBtn'),
    promptModal: document.getElementById('promptModal'),
    closePromptModalBtn: document.getElementById('closePromptModalBtn'),
    promptList: document.getElementById('promptList'),
    newPromptBtn: document.getElementById('newPromptBtn'),
    importPromptsBtn: document.getElementById('importPromptsBtn'),
    exportPromptsBtn: document.getElementById('exportPromptsBtn'),
    importPromptsInput: document.getElementById('importPromptsInput'),
    promptPreviewModal: document.getElementById('promptPreviewModal'),
    closePromptPreviewBtn: document.getElementById('closePromptPreviewBtn')
};

document.addEventListener('DOMContentLoaded', () => {
    initMarkdown();
    loadConfig();
    updateProviderUi('A');
    updateProviderUi('B');
    initChat();
    bindEvents();
    initPrompts();
    bindPromptEvents();
    renderPromptSelector();
    updateModelNames();
    setHeaderStatus('A', 'ready');
    setHeaderStatus('B', 'ready');
    setHeaderTokens('A', 0);
    setHeaderTokens('B', 0);
    setHeaderTime('A', 0);
    setHeaderTime('B', 0);
    setSendButtonMode('send');
    autoGrowPromptInput();
    renderAll();
});

function getProviderMode(config) {
    const provider = config?.provider || 'openai';
    if (provider === 'anthropic') return 'anthropic';
    if (provider === 'custom') {
        return (config?.customFormat || 'openai') === 'anthropic' ? 'anthropic' : 'openai';
    }
    return 'openai';
}

function createId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(ts) {
    try {
        return new Date(ts).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return '';
    }
}

function estimateTokensFromText(text) {
    if (!text) return 0;
    const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const asciiCount = Math.max(0, text.length - cjkCount);
    return Math.max(0, Math.ceil(cjkCount + asciiCount / 4));
}

function initMarkdown() {
    if (typeof marked === 'undefined') return;
    marked.setOptions({
        highlight: function(code, lang) {
            if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
                try {
                    return hljs.highlight(code, { language: lang }).value;
                } catch (e) {
                    console.error('代码高亮失败:', e);
                }
            }
            return code;
        },
        breaks: true,
        gfm: true
    });
}

function renderMarkdownToElement(element, text) {
    if (!element) return;
    if (typeof marked !== 'undefined') {
        try {
            element.innerHTML = marked.parse(text || '');
            enhanceRenderedMarkdown(element);
            return;
        } catch (e) {
            console.error('Markdown渲染失败:', e);
        }
    }
    element.textContent = text || '';
}

function enhanceRenderedMarkdown(root) {
    if (!root) return;
    addCopyButtonsToCodeBlocks(root);
}

function getLanguageFromCodeEl(codeEl) {
    const className = (codeEl?.className || '').toString();
    const m = className.match(/(?:^|\\s)(?:language|lang)-([\\w-]+)(?:\\s|$)/i);
    return m?.[1] || '';
}

async function copyTextToClipboard(text) {
    const content = (text ?? '').toString();
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
        const textarea = document.createElement('textarea');
        textarea.value = content;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.top = '-9999px';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return !!ok;
    } catch {
        return false;
    }
}

function createCopyButton(getText, options = {}) {
    const {
        className = 'message-copy-btn',
        label = '复制',
        loadingText = '复制…',
        successText = '已复制',
        errorText = '失败',
        resetDelayMs = 900,
        icon = false,
    } = options || {};

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;

    if (icon) {
        btn.classList.add('copy-icon-btn');
        btn.setAttribute('aria-label', label);
        btn.title = label;

        const mkSvg = (svgClass, inner) => {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('aria-hidden', 'true');
            svg.classList.add('icon', svgClass);
            svg.innerHTML = inner;
            return svg;
        };

        btn.appendChild(mkSvg('icon-copy', '<rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path>'));
        btn.appendChild(mkSvg('icon-check', '<path d="M20 6L9 17l-5-5"></path>'));
        btn.appendChild(mkSvg('icon-x', '<path d="M18 6L6 18M6 6l12 12"></path>'));
    } else {
        btn.textContent = label;
    }

    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const original = icon ? (btn.getAttribute('aria-label') || label) : btn.textContent;
        btn.disabled = true;
        if (icon) {
            btn.dataset.copyState = 'loading';
            btn.title = loadingText;
        } else {
            btn.textContent = loadingText;
        }

        const text = typeof getText === 'function' ? getText() : getText;
        const ok = await copyTextToClipboard(text);
        if (icon) {
            btn.dataset.copyState = ok ? 'success' : 'error';
            btn.title = ok ? successText : errorText;
        } else {
            btn.textContent = ok ? successText : errorText;
        }

        setTimeout(() => {
            btn.disabled = false;
            if (icon) {
                delete btn.dataset.copyState;
                btn.title = original;
            } else {
                btn.textContent = original;
            }
        }, resetDelayMs);
    });

    return btn;
}

function addCopyButtonsToCodeBlocks(root) {
    const codeBlocks = root.querySelectorAll('pre > code');
    for (const codeEl of codeBlocks) {
        const preEl = codeEl.parentElement;
        if (!preEl || preEl.tagName !== 'PRE') continue;
        if (preEl.closest('.code-block')) continue;

        const wrapper = document.createElement('div');
        wrapper.className = 'code-block';

        const toolbar = document.createElement('div');
        toolbar.className = 'code-toolbar';

        const lang = document.createElement('span');
        lang.className = 'code-lang';
        const language = getLanguageFromCodeEl(codeEl);
        lang.textContent = language ? language : 'code';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'code-copy-btn';
        btn.textContent = '复制';

        btn.addEventListener('click', async () => {
            const original = btn.textContent;
            btn.disabled = true;
            btn.textContent = '复制中...';
            const ok = await copyTextToClipboard(codeEl.textContent || '');
            btn.textContent = ok ? '已复制' : '复制失败';
            setTimeout(() => {
                btn.disabled = false;
                btn.textContent = original;
            }, 900);
        });

        toolbar.appendChild(lang);
        toolbar.appendChild(btn);

        const parent = preEl.parentNode;
        if (!parent) continue;
        parent.insertBefore(wrapper, preEl);
        wrapper.appendChild(toolbar);
        wrapper.appendChild(preEl);
    }
}

function truncateText(text, maxLen) {
    const s = (text || '').toString();
    if (!maxLen || maxLen <= 0) return s;
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen) + '…';
}

// ========== 图片处理函数 ==========

// 将图片文件读取为base64 data URL
function readImageAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type.startsWith('image/')) {
            reject(new Error('不是有效的图片文件'));
            return;
        }

        // 限制图片大小为10MB
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            reject(new Error('图片大小不能超过10MB'));
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.readAsDataURL(file);
    });
}

// 添加图片到状态
async function addImages(files) {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    for (const file of fileArray) {
        try {
            const dataUrl = await readImageAsDataUrl(file);
            const image = {
                id: createId(),
                dataUrl,
                name: file.name,
                size: file.size,
                type: file.type
            };
            state.images.selectedImages.push(image);
        } catch (e) {
            console.error('添加图片失败:', e);
            alert(`添加图片失败: ${e.message}`);
        }
    }

    renderImagePreviews();
}

// 从状态中移除图片
function removeImage(imageId) {
    state.images.selectedImages = state.images.selectedImages.filter(img => img.id !== imageId);
    renderImagePreviews();
}

// 清空所有图片
function clearImages() {
    state.images.selectedImages = [];
    renderImagePreviews();
}

// 渲染图片预览
function renderImagePreviews() {
    const container = elements.imagePreviewContainer;
    if (!container) return;

    const images = state.images.selectedImages;

    if (images.length === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    container.style.display = 'flex';
    container.innerHTML = '';

    for (const image of images) {
        const preview = document.createElement('div');
        preview.className = 'image-preview-item';
        preview.dataset.imageId = image.id;

        const img = document.createElement('img');
        img.src = image.dataUrl;
        img.alt = image.name;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'image-preview-remove';
        removeBtn.title = '移除图片';
        removeBtn.innerHTML = '×';
        removeBtn.addEventListener('click', () => removeImage(image.id));

        preview.appendChild(img);
        preview.appendChild(removeBtn);
        container.appendChild(preview);
    }
}

function renderWebSearchSection(container, webSearch) {
    if (!container) return;
    container.innerHTML = '';
    if (!webSearch) return;

    const header = document.createElement('div');
    header.className = 'web-search-header';

    const title = document.createElement('span');
    title.className = 'web-search-title';
    title.textContent = '联网搜索';

    const status = document.createElement('span');
    status.className = `web-search-status ${webSearch.status || 'ready'}`;

    // 添加spinner元素
    const spinner = document.createElement('span');
    spinner.className = 'web-search-status-spinner';
    status.appendChild(spinner);

    // 添加状态文本
    const statusText = document.createElement('span');
    statusText.textContent =
        webSearch.status === 'loading' ? '搜索中' :
        webSearch.status === 'error' ? '搜索失败' :
        '联网搜索';
    status.appendChild(statusText);

    header.appendChild(status);
    header.appendChild(title);

    const body = document.createElement('div');
    body.className = 'web-search-body';

    if (webSearch.status === 'loading') {
        const hint = document.createElement('div');
        hint.className = 'web-search-hint';
        hint.textContent = '搜索中…';
        body.appendChild(hint);
    } else if (webSearch.status === 'error') {
        const err = document.createElement('div');
        err.className = 'web-search-error';
        err.textContent = webSearch.error || '联网搜索失败';
        body.appendChild(err);
    } else {
        if (webSearch.answer) {
            const ans = document.createElement('div');
            ans.className = 'web-search-answer';
            ans.textContent = truncateText(webSearch.answer, 600);
            body.appendChild(ans);
        }

        const results = Array.isArray(webSearch.results) ? webSearch.results : [];
        if (results.length) {
            const list = document.createElement('ol');
            list.className = 'web-search-results';
            results.forEach((r) => {
                const item = document.createElement('li');
                const link = document.createElement('a');
                link.href = r.url || '#';
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = r.title || r.url || '(无标题)';
                item.appendChild(link);

                const snippet = document.createElement('div');
                snippet.className = 'web-search-snippet';
                snippet.textContent = truncateText(r.content || r.snippet || '', 260);
                if (snippet.textContent) item.appendChild(snippet);

                list.appendChild(item);
            });
            body.appendChild(list);
        } else {
            const empty = document.createElement('div');
            empty.className = 'web-search-hint';
            empty.textContent = '未返回结果。';
            body.appendChild(empty);
        }
    }

    // 绑定折叠/展开事件
    header.addEventListener('click', () => {
        container.classList.toggle('collapsed');
        container.classList.toggle('expanded');
        // 用户手动操作后，标记为已手动操作，取消自动折叠
        container.dataset.userToggled = '1';
    });

    container.appendChild(header);
    container.appendChild(body);

    // 默认折叠状态
    container.classList.add('collapsed');
    container.classList.remove('expanded');
}

function buildPromptWithWebSearch(originalPrompt, webSearch) {
    const results = Array.isArray(webSearch?.results) ? webSearch.results : [];
    const lines = [];
    lines.push('你将获得一些联网搜索结果。请优先基于这些结果作答，并在回答末尾给出参考链接列表。');

    if (webSearch?.answer) lines.push(`搜索摘要：${truncateText(webSearch.answer, 1200)}`);

    if (results.length) {
        // 传递所有搜索结果给AI，不再限制为5条
        const formatted = results.map((r, i) => {
            const title = (r.title || '').trim();
            const url = (r.url || '').trim();
            const snippet = truncateText((r.content || r.snippet || '').trim(), 800);
            return [
                `[${i + 1}] ${title || url || '(无标题)'}`,
                url ? `URL: ${url}` : '',
                snippet ? `摘要: ${snippet}` : ''
            ].filter(Boolean).join('\n');
        });
        lines.push('搜索结果：\n' + formatted.join('\n\n'));
    }

    lines.push('用户问题：' + originalPrompt);
    return lines.join('\n\n');
}

async function tavilySearch(query, apiKey, maxResults = 5) {
    if (window.location.protocol === 'file:') {
        throw new Error('当前是 file:// 打开页面，无法调用本地接口；请用 python server.py 方式访问 http://localhost:3000');
    }

    const resp = await fetch('/api/tavily/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            api_key: apiKey,
            query,
            search_depth: 'basic',
            max_results: Math.max(1, Math.min(20, maxResults || 5)),
            include_answer: true,
            include_raw_content: false,
            include_images: false
        })
    });

    if (!resp.ok) {
        let detail = '';
        try {
            const json = await resp.json();
            detail = typeof json?.detail === 'string' ? json.detail : JSON.stringify(json);
        } catch {
            detail = await resp.text();
        }
        throw new Error(`Tavily HTTP ${resp.status}: ${detail || resp.statusText}`);
    }

    return resp.json();
}

function bindEvents() {
    elements.saveConfig.addEventListener('click', saveConfig);
    elements.clearConfig.addEventListener('click', clearConfig);

    // 联网搜索开关的label元素，阻止焦点转移
    const webSearchLabel = elements.enableWebSearch?.parentElement;
    if (webSearchLabel) {
        webSearchLabel.addEventListener('mousedown', (e) => {
            // 只阻止label本身的默认行为，不阻止checkbox的点击
            if (e.target === webSearchLabel || e.target.classList.contains('switch-track') || e.target.classList.contains('switch-text') || e.target.tagName === 'svg' || e.target.tagName === 'path') {
                e.preventDefault();
            }
        });
    }

    elements.enableWebSearch?.addEventListener('change', (e) => {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.config);
            const config = raw ? JSON.parse(raw) : {};
            config.webSearch = config.webSearch || {};
            config.webSearch.enabled = !!elements.enableWebSearch.checked;
            localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(config));
        } catch (e) {
            console.error('保存联网搜索开关失败:', e);
        }
    });

    elements.openConfigBtn?.addEventListener('click', openConfigModal);
    elements.closeConfigBtn?.addEventListener('click', closeConfigModal);
    elements.configModal?.addEventListener('click', (e) => {
        if (e.target === elements.configModal) closeConfigModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeConfigModal();
    });

    elements.sendBtn.addEventListener('click', onSendButtonClick);

    // 滚动到底部按钮
    elements.scrollToBottomBtn?.addEventListener('click', () => {
        scrollToBottom(elements.chatMessages, true);
    });

    // 监听聊天消息区域的滚动事件，控制按钮显示
    elements.chatMessages?.addEventListener('scroll', () => {
        updateScrollToBottomButton();
    });

    elements.newTopicBtn.addEventListener('click', () => {
        if (state.isRunning && !confirm('正在生成中，仍要新建话题并停止当前生成吗？')) return;
        if (state.isRunning) stopGeneration();
        const topic = createTopic();
        setActiveTopic(topic.id);
        renderAll();
        elements.promptInput.focus();
    });

    // 监听提供商变化，更新API地址提示 + 自动获取模型列表
    elements.providerA.addEventListener('change', () => {
        updateProviderUi('A');
        updateModelHint('A');
        scheduleFetchModels('A', 0);
    });
    elements.providerB.addEventListener('change', () => {
        updateProviderUi('B');
        updateModelHint('B');
        scheduleFetchModels('B', 0);
    });
    elements.customFormatA?.addEventListener('change', () => {
        updateApiUrlPlaceholder('A');
        updateModelHint('A');
        scheduleFetchModels('A', 200);
    });
    elements.customFormatB?.addEventListener('change', () => {
        updateApiUrlPlaceholder('B');
        updateModelHint('B');
        scheduleFetchModels('B', 200);
    });

    elements.apiKeyA?.addEventListener('input', () => {
        updateModelHint('A');
        scheduleFetchModels('A', 400);
    });
    elements.apiKeyB?.addEventListener('input', () => {
        updateModelHint('B');
        scheduleFetchModels('B', 400);
    });
    elements.apiUrlA?.addEventListener('input', () => {
        updateModelHint('A');
        scheduleFetchModels('A', 500);
    });
    elements.apiUrlB?.addEventListener('input', () => {
        updateModelHint('B');
        scheduleFetchModels('B', 500);
    });

    // 监听模型名称变化
    elements.modelA.addEventListener('input', () => {
        updateModelNames();
        updateModelDropdownFilter('A');
    });
    elements.modelB.addEventListener('input', () => {
        updateModelNames();
        updateModelDropdownFilter('B');
    });

    elements.modelDropdownBtnA?.addEventListener('click', () => toggleModelDropdown('A'));
    elements.modelDropdownBtnB?.addEventListener('click', () => toggleModelDropdown('B'));
    elements.modelA?.addEventListener('focus', () => updateModelDropdownFilter('A'));
    elements.modelB?.addEventListener('focus', () => updateModelDropdownFilter('B'));

    document.addEventListener('mousedown', (e) => {
        const t = e.target;
        if (!(t instanceof Node)) return;
        if (t.closest?.('.model-picker')) return;
        closeModelDropdown('A');
        closeModelDropdown('B');
    });

    // Enter 发送（Shift+Enter 换行）
    elements.promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            if (!state.isRunning) sendPrompt();
        }
    });

    elements.promptInput.addEventListener('input', autoGrowPromptInput);

    // 图片上传按钮点击事件
    elements.imageUploadBtn?.addEventListener('mousedown', (e) => {
        e.preventDefault(); // 阻止按钮获得焦点，避免触发输入框容器的选中效果
    });
    elements.imageUploadBtn?.addEventListener('click', () => {
        elements.imageInput?.click();
    });

    // 文件选择事件
    elements.imageInput?.addEventListener('change', (e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            addImages(files);
        }
        // 清空input，允许重复选择同一文件
        e.target.value = '';
    });

    // 粘贴图片事件
    elements.promptInput?.addEventListener('paste', async (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        const imageFiles = [];
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) imageFiles.push(file);
            }
        }

        if (imageFiles.length > 0) {
            e.preventDefault();
            await addImages(imageFiles);
        }
    });
}

function openConfigModal() {
    if (!elements.configModal) return;
    elements.configModal.classList.add('open');
    elements.configModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    updateModelHint('A');
    updateModelHint('B');
    scheduleFetchModels('A', 0);
    scheduleFetchModels('B', 0);
}

function closeConfigModal() {
    if (!elements.configModal) return;
    elements.configModal.classList.remove('open');
    elements.configModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    closeModelDropdown('A');
    closeModelDropdown('B');
}

function autoGrowPromptInput() {
    const el = elements.promptInput;
    if (!el) return;

    const maxHeight = 160; // 与 CSS max-height 保持一致
    el.style.height = '0px';
    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function setSendButtonMode(mode) {
    if (!elements.sendBtn) return;
    const nextMode = mode === 'stop' ? 'stop' : 'send';
    elements.sendBtn.dataset.mode = nextMode;
    if (nextMode === 'stop') {
        elements.sendBtn.title = '停止生成';
        elements.sendBtn.setAttribute('aria-label', '停止生成');
    } else {
        elements.sendBtn.title = '发送';
        elements.sendBtn.setAttribute('aria-label', '发送');
    }
}

function onSendButtonClick() {
    if (state.isRunning) stopGeneration();
    else sendPrompt();
}

// 更新滚动到底部按钮的显示状态
function updateScrollToBottomButton() {
    if (!elements.chatMessages || !elements.scrollToBottomBtn) return;

    const { scrollTop, scrollHeight, clientHeight } = elements.chatMessages;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 100;

    // 如果接近底部，隐藏按钮；否则显示按钮
    elements.scrollToBottomBtn.style.display = nearBottom ? 'none' : 'flex';
}

function updateProviderUi(side) {
    const provider = elements[`provider${side}`]?.value || 'openai';
    const hintEl = elements[`providerHint${side}`];
    const urlInput = elements[`apiUrl${side}`];
    const customGroup = elements[`customFormatGroup${side}`];

    if (customGroup) customGroup.style.display = provider === 'custom' ? 'block' : 'none';
    if (urlInput) {
        if (provider === 'custom') urlInput.setAttribute('required', 'required');
        else urlInput.removeAttribute('required');
    }

    if (hintEl) {
        if (provider === 'openai') {
            hintEl.textContent = 'OpenAI 官方接口（Chat Completions 格式）；API地址可留空，默认使用 https://api.openai.com/v1/chat/completions。';
        } else if (provider === 'anthropic') {
            hintEl.textContent = 'Anthropic 官方接口（Messages 格式）；API地址可留空，默认使用 https://api.anthropic.com/v1/messages。';
        } else {
            hintEl.textContent = '自定义第三方/自建接口：必须填写 API地址，并选择接口格式（OpenAI 兼容或 Anthropic 兼容）。';
        }
    }

    updateApiUrlPlaceholder(side);
    updateModelHint(side);
}

function updateApiUrlPlaceholder(side) {
    const provider = elements[`provider${side}`].value;
    const urlInput = elements[`apiUrl${side}`];
    const customFormat = elements[`customFormat${side}`]?.value || 'openai';

    const customPlaceholder = customFormat === 'anthropic'
        ? 'https://api.example.com/v1/messages'
        : 'https://api.example.com/v1/chat/completions';
    const placeholders = {
        openai: 'https://api.openai.com/v1/chat/completions',
        anthropic: 'https://api.anthropic.com/v1/messages',
        custom: customPlaceholder
    };
    urlInput.placeholder = placeholders[provider] || '';
}

function updateModelNames() {
    const modelA = elements.modelA.value || '';
    const modelB = elements.modelB.value || '';

    // 更新模型名称（未配置时不显示任何内容）
    elements.modelNameA.textContent = modelA || '';
    elements.modelNameB.textContent = modelB || '';

    // 根据配置状态添加/移除样式类
    const chipA = elements.modelNameA.closest('.model-chip');
    const chipB = elements.modelNameB.closest('.model-chip');

    if (chipA) {
        if (modelA) {
            chipA.classList.remove('unconfigured');
        } else {
            chipA.classList.add('unconfigured');
        }
    }

    if (chipB) {
        if (modelB) {
            chipB.classList.remove('unconfigured');
        } else {
            chipB.classList.add('unconfigured');
        }
    }
}

function getConfigFromForm(side) {
    return {
        provider: elements[`provider${side}`]?.value || 'openai',
        customFormat: elements[`customFormat${side}`]?.value || 'openai',
        apiKey: elements[`apiKey${side}`]?.value || '',
        apiUrl: elements[`apiUrl${side}`]?.value || ''
    };
}

function setModelHint(side, text) {
    const el = elements[`modelHint${side}`];
    if (!el) return;
    el.textContent = text || '';
}

function updateModelHint(side) {
    const config = getConfigFromForm(side);
    const provider = (config.provider || 'openai').toString();
    const apiKey = (config.apiKey || '').trim();
    const apiUrl = (config.apiUrl || '').trim();

    if (provider === 'custom' && !apiUrl) {
        setModelHint(side, '提示：这里填写模型 ID；自定义提供商需先填写 API 地址，之后会自动获取可用模型列表（也可手动输入）。');
        return;
    }

    if (provider !== 'custom' && !apiKey) {
        setModelHint(side, '提示：这里填写模型 ID；填写 API Key 后会自动获取可用模型列表（也可手动输入）。');
        return;
    }

    setModelHint(side, '提示：这里填写模型 ID；将自动获取可用模型列表（可下拉选择或直接输入）。');
}

function getCachedModelIds(side) {
    const slot = state.modelFetch[side === 'A' ? 'A' : 'B'];
    return Array.isArray(slot?.models) ? slot.models : [];
}

function getModelDropdownLimit(side) {
    const slot = state.modelFetch[side === 'A' ? 'A' : 'B'];
    if (!slot) return 120;
    return Math.max(40, Math.min(2000, Number(slot.dropdownLimit) || 120));
}

function resetModelDropdownLimit(side) {
    const slot = state.modelFetch[side === 'A' ? 'A' : 'B'];
    if (!slot) return;
    slot.dropdownLimit = 120;
}

function increaseModelDropdownLimit(side, delta = 200) {
    const slot = state.modelFetch[side === 'A' ? 'A' : 'B'];
    if (!slot) return;
    slot.dropdownLimit = getModelDropdownLimit(side) + Math.max(40, Number(delta) || 200);
}

function isModelDropdownOpen(side) {
    const el = elements[`modelDropdown${side}`];
    return !!el && !el.hidden;
}

function setModelDropdownButtonState(side, isOpen) {
    const btn = elements[`modelDropdownBtn${side}`];
    if (!btn) return;
    btn.classList.toggle('open', !!isOpen);
    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function closeModelDropdown(side) {
    const el = elements[`modelDropdown${side}`];
    if (!el) return;
    el.onscroll = null;
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '';
    setModelDropdownButtonState(side, false);
}

function renderModelDropdown(side, filterText) {
    const dropdownEl = elements[`modelDropdown${side}`];
    if (!dropdownEl) return;

    const slot = state.modelFetch[side === 'A' ? 'A' : 'B'];
    const isLoading = !!slot?.inFlight;
    const all = getCachedModelIds(side);
    const q = (filterText || '').toString().trim().toLowerCase();
    const models = q ? all.filter(m => m.toLowerCase().includes(q)) : all;
    const limit = getModelDropdownLimit(side);

    dropdownEl.innerHTML = '';
    if (!models.length) {
        const empty = document.createElement('div');
        empty.className = 'model-dropdown-empty';
        empty.textContent = all.length
            ? '没有匹配的模型，请继续输入过滤或手动输入。'
            : (isLoading ? '正在获取模型列表…' : '暂无模型列表：请先填写 API Key/地址后自动获取。');
        dropdownEl.appendChild(empty);
        return;
    }

    const shown = models.slice(0, limit);
    for (const id of shown) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'model-dropdown-item';
        btn.textContent = id;
        btn.dataset.value = id;
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', () => {
            const input = elements[`model${side}`];
            if (input) input.value = id;
            updateModelNames();
            closeModelDropdown(side);
        });
        dropdownEl.appendChild(btn);
    }

    if (models.length > shown.length) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'model-dropdown-item';
        more.style.fontFamily = 'inherit';
        more.textContent = `加载更多（已显示 ${shown.length}/${models.length}）`;
        more.addEventListener('mousedown', (e) => e.preventDefault());
        more.addEventListener('click', () => {
            increaseModelDropdownLimit(side, 240);
            renderModelDropdown(side, filterText);
        });
        dropdownEl.appendChild(more);
    }
}

function openModelDropdown(side) {
    const dropdownEl = elements[`modelDropdown${side}`];
    const inputEl = elements[`model${side}`];
    if (!dropdownEl || !inputEl) return;

    renderModelDropdown(side, inputEl.value);
    dropdownEl.hidden = false;
    dropdownEl.setAttribute('aria-hidden', 'false');
    setModelDropdownButtonState(side, true);

    dropdownEl.onscroll = () => {
        const remaining = dropdownEl.scrollHeight - dropdownEl.scrollTop - dropdownEl.clientHeight;
        if (remaining > 40) return;
        const all = getCachedModelIds(side);
        const q = (inputEl.value || '').toString().trim().toLowerCase();
        const models = q ? all.filter(m => m.toLowerCase().includes(q)) : all;
        if (getModelDropdownLimit(side) >= models.length) return;
        increaseModelDropdownLimit(side, 240);
        renderModelDropdown(side, inputEl.value);
    };
}

function toggleModelDropdown(side) {
    if (isModelDropdownOpen(side)) closeModelDropdown(side);
    else openModelDropdown(side);
}

function updateModelDropdownFilter(side) {
    const dropdownEl = elements[`modelDropdown${side}`];
    const inputEl = elements[`model${side}`];
    if (!dropdownEl || !inputEl) return;

    if (!isModelDropdownOpen(side)) {
        const models = getCachedModelIds(side);
        if (models.length) openModelDropdown(side);
        return;
    }

    resetModelDropdownLimit(side);
    renderModelDropdown(side, inputEl.value);
}

function normalizeBaseUrlForModels(config) {
    const providerMode = getProviderMode(config);
    let url = (config?.apiUrl || '').trim();
    if (!url) {
        return providerMode === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1';
    }

    try {
        const u = new URL(url);
        const path = u.pathname || '';
        const v1Index = path.indexOf('/v1');
        if (v1Index >= 0) {
            return `${u.origin}${path.slice(0, v1Index + 3)}`;
        }
        return u.origin;
    } catch {
        return '';
    }
}

async function fetchModelsOnce(config) {
    const resp = await fetch('/api/models/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            provider: config?.provider || 'openai',
            customFormat: config?.customFormat || 'openai',
            apiKey: config?.apiKey || '',
            apiUrl: config?.apiUrl || ''
        })
    });

    let json = null;
    try {
        json = await resp.json();
    } catch {
        json = null;
    }

    if (!resp.ok) {
        const detail =
            (typeof json?.detail === 'string' && json.detail) ? json.detail :
            (typeof json?.error === 'string' && json.error) ? json.error :
            resp.statusText;
        throw new Error(`获取模型列表失败（${resp.status || 0}）：${detail || '未知错误'}`);
    }

    const ids = Array.isArray(json?.models) ? json.models : [];
    if (!ids.length) throw new Error('获取到的模型列表为空');
    return ids;
}

function scheduleFetchModels(side, delayMs = 400) {
    const key = side === 'A' ? 'A' : 'B';
    const slot = state.modelFetch[key];
    if (!slot) return;

    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = setTimeout(() => {
        slot.timer = null;
        void fetchAndUpdateModels(key);
    }, Math.max(0, delayMs || 0));
}

async function fetchAndUpdateModels(side) {
    const key = side === 'A' ? 'A' : 'B';
    const slot = state.modelFetch[key];
    if (!slot || slot.inFlight) return;

    const config = getConfigFromForm(key);
    if (config.provider !== 'custom' && !(config.apiKey || '').trim()) {
        slot.models = [];
        closeModelDropdown(key);
        updateModelHint(key);
        slot.lastKey = '';
        slot.lastFetchedAt = 0;
        return;
    }
    const base = normalizeBaseUrlForModels(config);
    const providerMode = getProviderMode(config);
    const hasKey = !!(config.apiKey || '').trim();
    const fetchKey = `${providerMode}|${base}|${hasKey ? 'k' : '-'}`;

    const now = Date.now();
    if (slot.lastKey === fetchKey && now - slot.lastFetchedAt < 60_000) return;

    slot.inFlight = true;
    try {
        const ids = await fetchModelsOnce(config);
        slot.models = ids;
        setModelHint(key, `已自动获取 ${ids.length} 个模型 ID（可下拉选择或直接输入）。`);
        // 只在下拉框已经打开的情况下更新显示，不自动打开
        if (isModelDropdownOpen(key)) {
            renderModelDropdown(key, elements[`model${key}`]?.value || '');
        }
        slot.lastKey = fetchKey;
        slot.lastFetchedAt = now;
    } catch (e) {
        console.warn(`模型${key}模型列表获取失败:`, e?.message || e);
        slot.models = [];
        closeModelDropdown(key);
        setModelHint(key, '提示：这里填写模型 ID；自动获取失败，可手动输入。');
    } finally {
        slot.inFlight = false;
    }
}

function saveConfig() {
    const config = {
        webSearch: {
            enabled: !!elements.enableWebSearch?.checked,
            tavilyApiKey: elements.tavilyApiKey?.value || '',
            maxResults: parseInt(elements.tavilyMaxResults?.value) || 5
        },
        history: {
            enableHistory: !!elements.enableHistory?.checked,
            maxHistoryTurns: parseInt(elements.maxHistoryTurns?.value) || 10
        },
        A: {
            provider: elements.providerA.value,
            customFormat: elements.customFormatA?.value || 'openai',
            apiKey: elements.apiKeyA.value,
            model: elements.modelA.value,
            apiUrl: elements.apiUrlA.value,
            thinking: elements.thinkingA.checked
        },
        B: {
            provider: elements.providerB.value,
            customFormat: elements.customFormatB?.value || 'openai',
            apiKey: elements.apiKeyB.value,
            model: elements.modelB.value,
            apiUrl: elements.apiUrlB.value,
            thinking: elements.thinkingB.checked
        }
    };

    localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(config));
    alert('配置已保存');
    closeConfigModal();
}

function loadConfig() {
    const saved = localStorage.getItem(STORAGE_KEYS.config);
    if (!saved) return;
    try {
        const config = JSON.parse(saved);
        if (config.webSearch) {
            if (elements.enableWebSearch) elements.enableWebSearch.checked = !!config.webSearch.enabled;
            if (elements.tavilyApiKey) elements.tavilyApiKey.value = config.webSearch.tavilyApiKey || '';
            if (elements.tavilyMaxResults) elements.tavilyMaxResults.value = config.webSearch.maxResults || 5;
        }
        // 加载对话历史配置（兼容旧的 timeContext 配置）
        const historyConfig = config.history || config.timeContext;
        if (historyConfig) {
            if (elements.enableHistory) elements.enableHistory.checked = historyConfig.enableHistory !== false;
            if (elements.maxHistoryTurns) elements.maxHistoryTurns.value = historyConfig.maxHistoryTurns || 10;
        }
        if (config.A) {
            elements.providerA.value = config.A.provider || 'openai';
            if (elements.customFormatA) elements.customFormatA.value = config.A.customFormat || 'openai';
            elements.apiKeyA.value = config.A.apiKey || '';
            elements.modelA.value = config.A.model || '';
            elements.apiUrlA.value = config.A.apiUrl || '';
            elements.thinkingA.checked = !!config.A.thinking;
        }
        if (config.B) {
            elements.providerB.value = config.B.provider || 'openai';
            if (elements.customFormatB) elements.customFormatB.value = config.B.customFormat || 'openai';
            elements.apiKeyB.value = config.B.apiKey || '';
            elements.modelB.value = config.B.model || '';
            elements.apiUrlB.value = config.B.apiUrl || '';
            elements.thinkingB.checked = !!config.B.thinking;
        }
    } catch (e) {
        console.error('加载配置失败:', e);
    }
}

function clearConfig() {
    if (!confirm('确定要清除所有配置吗？')) return;
    localStorage.removeItem(STORAGE_KEYS.config);

    if (elements.enableWebSearch) elements.enableWebSearch.checked = false;
    if (elements.tavilyApiKey) elements.tavilyApiKey.value = '';
    if (elements.tavilyMaxResults) elements.tavilyMaxResults.value = 5;
    if (elements.enableHistory) elements.enableHistory.checked = true;
    if (elements.maxHistoryTurns) elements.maxHistoryTurns.value = 10;

    ['A', 'B'].forEach(side => {
        elements[`provider${side}`].value = 'openai';
        if (elements[`customFormat${side}`]) elements[`customFormat${side}`].value = 'openai';
        elements[`apiKey${side}`].value = '';
        elements[`model${side}`].value = '';
        elements[`apiUrl${side}`].value = '';
        elements[`thinking${side}`].checked = false;
    });

    updateProviderUi('A');
    updateProviderUi('B');
    updateModelNames();
    alert('配置已清除');
}

function getConfig(side) {
    // 获取当前选中的提示词内容
    let systemPrompt = '';
    if (state.prompts.activeId) {
        const activePrompt = state.prompts.list.find(p => p.id === state.prompts.activeId);
        if (activePrompt) {
            systemPrompt = activePrompt.content;
        }
    }

    return {
        provider: elements[`provider${side}`].value,
        customFormat: elements[`customFormat${side}`]?.value || 'openai',
        apiKey: elements[`apiKey${side}`].value,
        model: elements[`model${side}`].value,
        apiUrl: elements[`apiUrl${side}`].value,
        systemPrompt: systemPrompt,
        thinking: elements[`thinking${side}`].checked
    };
}

function getWebSearchConfig() {
    const maxResults = parseInt(elements.tavilyMaxResults?.value);
    return {
        enabled: !!elements.enableWebSearch?.checked,
        tavilyApiKey: (elements.tavilyApiKey?.value || '').trim(),
        maxResults: (maxResults >= 1 && maxResults <= 20) ? maxResults : 5
    };
}

function getMaxHistoryTurns() {
    const value = parseInt(elements.maxHistoryTurns?.value);
    return (value >= 1 && value <= 50) ? value : 10;
}

function isHistoryEnabled() {
    return !!elements.enableHistory?.checked;
}

function initChat() {
    const topicsRaw = localStorage.getItem(STORAGE_KEYS.topics);
    const activeRaw = localStorage.getItem(STORAGE_KEYS.activeTopicId);

    if (topicsRaw) {
        try {
            const parsed = JSON.parse(topicsRaw);
            if (Array.isArray(parsed)) {
                state.chat.topics = parsed;
                for (const topic of state.chat.topics) {
                    if (typeof topic?.title === 'string' && /^新话题\s*\d+$/.test(topic.title.trim())) {
                        topic.title = '新话题';
                    }
                }
            }
        } catch (e) {
            console.error('加载话题失败:', e);
        }
    }

    if (activeRaw && state.chat.topics.some(t => t.id === activeRaw)) {
        state.chat.activeTopicId = activeRaw;
    }

    if (!state.chat.topics.length) {
        const topic = createTopic();
        state.chat.activeTopicId = topic.id;
        saveChatState();
    }

    if (!state.chat.activeTopicId) {
        state.chat.activeTopicId = state.chat.topics[0].id;
    }
}

function scheduleSaveChat() {
    if (state.chat.saveTimer) clearTimeout(state.chat.saveTimer);
    state.chat.saveTimer = setTimeout(() => {
        state.chat.saveTimer = null;
        saveChatState();
    }, 500);
}

function saveChatState() {
    try {
        localStorage.setItem(STORAGE_KEYS.topics, JSON.stringify(state.chat.topics));
        if (state.chat.activeTopicId) localStorage.setItem(STORAGE_KEYS.activeTopicId, state.chat.activeTopicId);
    } catch (e) {
        console.error('保存话题失败:', e);
    }
}

function createTopic() {
    const now = Date.now();
    const topic = {
        id: createId(),
        title: '新话题',
        createdAt: now,
        updatedAt: now,
        turns: []
    };
    state.chat.topics.unshift(topic);
    scheduleSaveChat();
    return topic;
}

function deleteTopic(topicId) {
    const before = state.chat.topics.length;
    state.chat.topics = state.chat.topics.filter(t => t.id !== topicId);
    if (!state.chat.topics.length) {
        const topic = createTopic();
        state.chat.activeTopicId = topic.id;
    } else if (state.chat.activeTopicId === topicId) {
        state.chat.activeTopicId = state.chat.topics[0].id;
    }
    if (before !== state.chat.topics.length) scheduleSaveChat();
}

function getActiveTopic() {
    return state.chat.topics.find(t => t.id === state.chat.activeTopicId) || null;
}

function setActiveTopic(topicId) {
    state.chat.activeTopicId = topicId;
    localStorage.setItem(STORAGE_KEYS.activeTopicId, topicId);
}

function renderAll() {
    renderTopicList();
    renderHistoryList();
    renderChatMessages();
}

function renderTopicList() {
    if (!elements.topicList) return;

    // 保存新建按钮
    const newTopicBtn = elements.topicList.querySelector('.topic-new-btn');

    // 清空列表
    elements.topicList.innerHTML = '';

    // 重新添加新建按钮
    if (newTopicBtn) {
        elements.topicList.appendChild(newTopicBtn);
    }

    const topics = [...state.chat.topics].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    for (const topic of topics) {
        const item = document.createElement('div');
        item.className = `topic-item${topic.id === state.chat.activeTopicId ? ' active' : ''}`;
        item.dataset.topicId = topic.id;

        const title = document.createElement('div');
        title.className = 'topic-title';
        title.textContent = topic.title || '未命名话题';

        const meta = document.createElement('div');
        meta.className = 'topic-meta';
        meta.textContent = `${topic.turns?.length || 0} 条 · ${formatTime(topic.updatedAt || topic.createdAt)}`;

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'topic-delete-btn';
        deleteBtn.textContent = '删除';
        deleteBtn.title = '删除该话题';
        deleteBtn.setAttribute('aria-label', `删除话题：${topic.title || '未命名话题'}`);
        deleteBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (state.isRunning && !confirm('正在生成中，仍要删除话题并停止当前生成吗？')) return;
            if (!confirm(`确定要删除话题「${topic.title || '未命名话题'}」吗？此操作不可恢复。`)) return;
            if (state.isRunning) stopGeneration();
            deleteTopic(topic.id);
            renderAll();
        });

        const footer = document.createElement('div');
        footer.className = 'topic-footer';
        footer.appendChild(meta);
        footer.appendChild(deleteBtn);

        item.appendChild(title);
        item.appendChild(footer);

        item.addEventListener('click', () => {
            if (state.isRunning && !confirm('正在生成中，仍要切换话题并停止当前生成吗？')) return;
            if (state.isRunning) stopGeneration();
            setActiveTopic(topic.id);
            renderAll();
        });

        item.addEventListener('dblclick', (e) => {
            e.preventDefault();
            const next = prompt('重命名话题', topic.title || '');
            if (next === null) return;
            topic.title = (next || '').trim() || topic.title || '未命名话题';
            topic.updatedAt = Date.now();
            scheduleSaveChat();
            renderTopicList();
        });

        elements.topicList.appendChild(item);
    }
}

function renderHistoryList() {
    if (!elements.historyList) return;
    elements.historyList.innerHTML = '';

    const topic = getActiveTopic();
    if (!topic || !Array.isArray(topic.turns) || !topic.turns.length) return;

    for (const turn of topic.turns) {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.dataset.turnId = turn.id;

        const text = document.createElement('div');
        text.className = 'history-text';
        text.textContent = (turn.prompt || '').slice(0, 60) || '(空)';

        const time = document.createElement('div');
        time.className = 'history-time';
        time.textContent = formatTime(turn.createdAt);

        item.appendChild(text);
        item.appendChild(time);

        item.addEventListener('click', () => scrollToTurn(turn.id));
        elements.historyList.appendChild(item);
    }
}

function scrollToTurn(turnId) {
    const el = elements.chatMessages?.querySelector(`.turn[data-turn-id="${turnId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function isNearBottom(container, thresholdPx = 150) {
    if (!container) return true;
    const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
    // 增加阈值到 150px，并且考虑浮点数误差
    return remaining <= thresholdPx || remaining < 1;
}

function scrollToBottom(container, smooth = false) {
    if (!container) return;
    if (smooth) {
        container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth'
        });
    } else {
        container.scrollTop = container.scrollHeight;
    }
}

function renderChatMessages() {
    if (!elements.chatMessages) return;
    elements.chatMessages.innerHTML = '';

    const topic = getActiveTopic();
    if (!topic || !Array.isArray(topic.turns) || !topic.turns.length) return;

    for (const turn of topic.turns) {
        const { el } = createTurnElement(turn);
        elements.chatMessages.appendChild(el);
    }
    updateScrollToBottomButton();
}

function createTurnElement(turn) {
    const turnEl = document.createElement('div');
    turnEl.className = 'turn';
    turnEl.dataset.turnId = turn.id;

    const userWrap = document.createElement('div');
    userWrap.className = 'user-bubble-wrap';

    const userBubble = document.createElement('div');
    userBubble.className = 'user-bubble';

    // 如果有图片，先显示图片
    if (turn.images && turn.images.length > 0) {
        const imagesContainer = document.createElement('div');
        imagesContainer.className = 'user-images';

        for (const image of turn.images) {
            const imgWrapper = document.createElement('div');
            imgWrapper.className = 'user-image-item';

            const img = document.createElement('img');
            img.src = image.dataUrl;
            img.alt = image.name || '用户上传的图片';
            img.loading = 'lazy';

            imgWrapper.appendChild(img);
            imagesContainer.appendChild(imgWrapper);
        }

        userBubble.appendChild(imagesContainer);
    }

    // 显示文本消息
    if (turn.prompt) {
        const textContent = document.createElement('div');
        textContent.className = 'user-text';
        textContent.textContent = turn.prompt;
        userBubble.appendChild(textContent);
    }

    const userCopyBtn = createCopyButton(() => turn.prompt || '', { label: '复制', icon: true });
    userCopyBtn.classList.add('user-copy-btn');

    userWrap.appendChild(userCopyBtn);
    userWrap.appendChild(userBubble);

    let webSearchEl = null;
    if (turn.webSearch) {
        webSearchEl = document.createElement('div');
        webSearchEl.className = 'web-search';
        renderWebSearchSection(webSearchEl, turn.webSearch);
    }

    const assistants = document.createElement('div');
    assistants.className = 'turn-assistants';

    // 只渲染已配置的模型卡片
    const cards = {};
    if (turn.models.A) {
        const aCard = createAssistantCard('A', turn);
        assistants.appendChild(aCard.el);
        cards.A = aCard;
    }
    if (turn.models.B) {
        const bCard = createAssistantCard('B', turn);
        assistants.appendChild(bCard.el);
        cards.B = bCard;
    }

    // 根据配置数量添加CSS类，用于自适应布局
    const configCount = (turn.models.A ? 1 : 0) + (turn.models.B ? 1 : 0);
    if (configCount === 1) {
        assistants.classList.add('single-model');
    } else if (configCount === 2) {
        assistants.classList.add('dual-model');
    }

    turnEl.appendChild(userWrap);
    if (webSearchEl) turnEl.appendChild(webSearchEl);
    turnEl.appendChild(assistants);

    return { el: turnEl, cards, webSearchEl };
}

/**
 * 打开全屏预览模态层
 * @param {HTMLElement} cardEl - 卡片DOM元素
 * @param {string} side - 'a' 或 'b'
 * @param {Object} turn - 当前turn对象
 */
function openFullscreenPreview(cardEl, side, turn) {
    // 防止重复打开
    if (document.querySelector('.fullscreen-modal')) {
        return;
    }

    // 保存原位置信息
    const placeholder = document.createElement('div');
    placeholder.className = 'fullscreen-placeholder';
    placeholder.style.display = 'none';
    cardEl.parentNode.insertBefore(placeholder, cardEl);

    // 创建模态层结构
    const modal = document.createElement('div');
    modal.className = 'fullscreen-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const overlay = document.createElement('div');
    overlay.className = 'fullscreen-overlay';

    const container = document.createElement('div');
    container.className = 'fullscreen-container';

    // 将卡片移动到全屏容器（而非克隆）
    cardEl.classList.add('fullscreen-card');
    container.appendChild(cardEl);

    // 在卡片的header中添加关闭按钮
    const headerActions = cardEl.querySelector('.assistant-card-header-actions');
    if (headerActions) {
        // 创建关闭按钮
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'card-action-btn fullscreen-close-btn';
        closeBtn.setAttribute('aria-label', '关闭全屏');
        closeBtn.title = '关闭全屏';
        closeBtn.innerHTML = `
            <svg viewBox="0 0 24 24" class="icon" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12"></path>
            </svg>
        `;

        // 将关闭按钮添加到header-actions的最后
        headerActions.appendChild(closeBtn);

        // 保存关闭按钮的引用，用于后续绑定事件
        container._closeBtn = closeBtn;
    }

    modal.appendChild(overlay);
    modal.appendChild(container);
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    // 关闭函数
    const closeModal = () => {
        // 移除添加的关闭按钮
        const closeBtn = container._closeBtn;
        if (closeBtn && closeBtn.parentNode) {
            closeBtn.remove();
        }

        // 将卡片移回原位置
        cardEl.classList.remove('fullscreen-card');
        placeholder.parentNode.insertBefore(cardEl, placeholder);
        placeholder.remove();

        // 移除模态层
        modal.remove();
        document.body.style.overflow = '';

        // 移除事件监听
        document.removeEventListener('keydown', handleEscape);
    };

    // 绑定关闭事件
    const closeBtn = container._closeBtn;
    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
        // 焦点管理
        closeBtn.focus();
    }
    overlay.addEventListener('click', closeModal);

    // ESC键关闭
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    };
    document.addEventListener('keydown', handleEscape);
}

function createAssistantCard(side, turn) {
    const modelSnapshot = turn?.models?.[side]?.model || '';
    const contentSnapshot = turn?.models?.[side]?.content || '';
    const thinkingSnapshot = turn?.models?.[side]?.thinking || '';
    const tokenSnapshot = turn?.models?.[side]?.tokens;
    const timeSnapshot = turn?.models?.[side]?.timeCostSec;
    const statusSnapshot = turn?.models?.[side]?.status || 'ready';

    const card = document.createElement('div');
    card.className = `assistant-card assistant-${side.toLowerCase()}`;

    const header = document.createElement('div');
    header.className = 'assistant-card-header';

    const chip = document.createElement('div');
    chip.className = `model-chip model-chip-${side.toLowerCase()}`;

    const chipDot = document.createElement('span');
    chipDot.className = 'chip-dot';

    const chipLabel = document.createElement('span');
    chipLabel.className = 'chip-label';
    chipLabel.textContent = side;

    const loadingSpinner = document.createElement('span');
    loadingSpinner.className = 'chip-loading-spinner';

    const modelName = document.createElement('span');
    modelName.className = 'chip-id';
    modelName.textContent = modelSnapshot || (side === 'A' ? (elements.modelNameA.textContent || '未配置') : (elements.modelNameB.textContent || '未配置'));

    const statusEl = document.createElement('span');
    statusEl.className = 'status';
    applyStatus(statusEl, statusSnapshot);

    chip.appendChild(chipDot);
    chip.appendChild(chipLabel);
    chip.appendChild(loadingSpinner);
    chip.appendChild(modelName);
    chip.appendChild(statusEl);
    header.appendChild(chip);

    // 创建按钮容器
    const headerActions = document.createElement('div');
    headerActions.className = 'assistant-card-header-actions';

    // 复制按钮（复用现有createCopyButton函数）
    const copyBtn = createCopyButton(
        () => turn?.models?.[side]?.content || '',
        {
            label: '复制回答',
            icon: true,
            className: 'card-action-btn'
        }
    );

    // 全屏预览按钮
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.type = 'button';
    fullscreenBtn.className = 'card-action-btn fullscreen-btn';
    fullscreenBtn.setAttribute('aria-label', '全屏预览');
    fullscreenBtn.title = '全屏预览';
    fullscreenBtn.innerHTML = `
        <svg viewBox="0 0 24 24" class="icon" aria-hidden="true">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
        </svg>
    `;

    fullscreenBtn.addEventListener('click', () => {
        openFullscreenPreview(card, side, turn);
    });

    headerActions.appendChild(copyBtn);
    headerActions.appendChild(fullscreenBtn);
    header.appendChild(headerActions);

    const body = document.createElement('div');
    body.className = 'assistant-card-body';

    const thinkingSection = document.createElement('div');
    thinkingSection.className = 'thinking-section collapsed';
    thinkingSection.style.display = 'none';

    const thinkingHeader = document.createElement('div');
    thinkingHeader.className = 'thinking-header';
    const thinkingLabel = document.createElement('span');
    thinkingLabel.textContent = '思考过程';
    const thinkingTime = document.createElement('span');
    thinkingTime.className = 'thinking-time';
    thinkingHeader.appendChild(thinkingLabel);
    thinkingHeader.appendChild(thinkingTime);
    thinkingHeader.addEventListener('click', () => {
        thinkingSection.dataset.userToggled = '1';
        thinkingSection.classList.toggle('collapsed');
    });

    const thinkingContent = document.createElement('div');
    thinkingContent.className = 'thinking-content';
    if (thinkingSnapshot) {
        renderMarkdownToElement(thinkingContent, thinkingSnapshot);
    }

    thinkingSection.appendChild(thinkingHeader);
    thinkingSection.appendChild(thinkingContent);

    if (thinkingSnapshot) {
        thinkingSection.style.display = 'block';
        thinkingSection.classList.remove('collapsed');
    }

    const responseSection = document.createElement('div');
    responseSection.className = 'response-section';
    const responseContent = document.createElement('div');
    responseContent.className = 'response-content';
    renderMarkdownToElement(responseContent, contentSnapshot);
    responseSection.appendChild(responseContent);

    body.appendChild(thinkingSection);
    body.appendChild(responseSection);

    const footer = document.createElement('div');
    footer.className = 'assistant-card-footer';
    const tokenEl = document.createElement('span');
    tokenEl.className = 'token-count';
    tokenEl.textContent = `${Number.isFinite(tokenSnapshot) ? tokenSnapshot : estimateTokensFromText(contentSnapshot)} tokens`;
    const timeEl = document.createElement('span');
    timeEl.className = 'time-cost';
    timeEl.textContent = `${Number.isFinite(timeSnapshot) ? timeSnapshot.toFixed(1) : '0.0'}s`;
    footer.appendChild(tokenEl);
    footer.appendChild(timeEl);

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(footer);

    return {
        el: card,
        statusEl,
        modelNameEl: modelName,
        responseEl: responseContent,
        thinkingSectionEl: thinkingSection,
        thinkingContentEl: thinkingContent,
        thinkingTimeEl: thinkingTime,
        tokenEl,
        timeEl,
        thinkingAutoCollapseTimer: null
    };
}

function applyStatus(statusEl, status) {
    const map = {
        ready: { cls: 'ready', text: '就绪' },
        loading: { cls: 'loading', text: '生成中...' },
        complete: { cls: 'complete', text: '完成' },
        error: { cls: 'error', text: '错误' },
        stopped: { cls: 'ready', text: '已停止' }
    };
    const next = map[status] || map.ready;
    statusEl.className = `status ${next.cls}`;
    statusEl.textContent = next.text;

    // 同步更新卡片的loading状态类
    const card = statusEl.closest('.assistant-card');
    if (card) {
        if (status === 'loading') {
            card.classList.add('loading');
        } else {
            card.classList.remove('loading');
        }
    }
}

function setHeaderStatus(side, status) {
    const statusEl = elements[`status${side}`];
    if (!statusEl) return;
    applyStatus(statusEl, status);
}

function setHeaderTokens(side, tokens) {
    const el = elements[`tokenCount${side}`];
    if (!el) return;
    el.textContent = `${Math.max(0, Math.floor(tokens || 0))} tokens`;
}

function setHeaderTime(side, sec) {
    const el = elements[`timeCost${side}`];
    if (!el) return;
    el.textContent = `${Math.max(0, sec || 0).toFixed(1)}s`;
}

async function sendPrompt() {
    if (state.isRunning) return;

    const prompt = (elements.promptInput.value || '').trim();
    if (!prompt) {
        alert('请输入提示词');
        return;
    }

    const configA = getConfig('A');
    const configB = getConfig('B');
    const webSearchConfig = getWebSearchConfig();

    // 检查至少配置一个模型
    const hasA = !!(configA.apiKey && configA.model);
    const hasB = !!(configB.apiKey && configB.model);

    if (!hasA && !hasB) {
        alert('请至少配置一个模型');
        return;
    }

    const now = Date.now();
    let topic = getActiveTopic();
    if (!topic) {
        topic = createTopic();
        setActiveTopic(topic.id);
    }

    const turn = {
        id: createId(),
        createdAt: now,
        prompt,
        images: [...state.images.selectedImages], // 保存当前选择的图片
        webSearch: webSearchConfig.enabled ? { status: 'loading', query: prompt, results: [], answer: '', error: '' } : null,
        models: {}
    };

    // 只为已配置的模型初始化数据
    if (hasA) {
        turn.models.A = {
            provider: configA.provider,
            model: configA.model,
            thinking: '',
            content: '',
            tokens: null,
            timeCostSec: null,
            status: 'loading'
        };
    }
    if (hasB) {
        turn.models.B = {
            provider: configB.provider,
            model: configB.model,
            thinking: '',
            content: '',
            tokens: null,
            timeCostSec: null,
            status: 'loading'
        };
    }

    topic.turns = Array.isArray(topic.turns) ? topic.turns : [];
    topic.turns.push(turn);
    topic.updatedAt = now;

    if ((topic.title || '').startsWith('新话题') && topic.turns.length === 1) {
        const t = prompt.slice(0, 18).trim();
        if (t) topic.title = t;
    }

    scheduleSaveChat();

    const createdEls = createTurnElement(turn);
    elements.chatMessages.appendChild(createdEls.el);
    renderTopicList();
    renderHistoryList();

    // 发送后立即滚动到底部
    scrollToBottom(elements.chatMessages, false);

    elements.promptInput.value = '';
    autoGrowPromptInput();
    clearImages(); // 清空已选择的图片
    elements.promptInput.focus();

    // 只为已配置的模型设置状态
    if (hasA) {
        setHeaderStatus('A', 'loading');
        setHeaderTokens('A', 0);
        setHeaderTime('A', 0);
    }
    if (hasB) {
        setHeaderStatus('B', 'loading');
        setHeaderTokens('B', 0);
        setHeaderTime('B', 0);
    }
    setSendButtonMode('stop');

    state.isRunning = true;
    // 发送/停止合并：生成中保持按钮可点击，用于停止

    let promptForModels = prompt;
    if (turn.webSearch) {
        if (!webSearchConfig.tavilyApiKey) {
            turn.webSearch.status = 'error';
            turn.webSearch.error = '已启用联网搜索，但未填写 Tavily API Key。';
            renderWebSearchSection(createdEls.webSearchEl, turn.webSearch);
            scheduleSaveChat();
        } else {
            try {
                const data = await tavilySearch(prompt, webSearchConfig.tavilyApiKey, webSearchConfig.maxResults);
                turn.webSearch.status = 'ready';
                turn.webSearch.answer = data?.answer || '';
                turn.webSearch.results = Array.isArray(data?.results) ? data.results : [];
                renderWebSearchSection(createdEls.webSearchEl, turn.webSearch);
                scheduleSaveChat();
                if (turn.webSearch.results?.length || turn.webSearch.answer) {
                    promptForModels = buildPromptWithWebSearch(prompt, turn.webSearch);
                }
            } catch (e) {
                turn.webSearch.status = 'error';
                turn.webSearch.error = e?.message || '联网搜索失败';
                renderWebSearchSection(createdEls.webSearchEl, turn.webSearch);
                scheduleSaveChat();
            }
        }
    }

    // 动态构建调用列表
    const calls = [];
    if (hasA && createdEls.cards.A) {
        calls.push(callModel('A', promptForModels, configA, turn, createdEls.cards.A, Date.now()));
    }
    if (hasB && createdEls.cards.B) {
        calls.push(callModel('B', promptForModels, configB, turn, createdEls.cards.B, Date.now()));
    }

    await Promise.allSettled(calls);

    state.isRunning = false;
    setSendButtonMode('send');
    scheduleSaveChat();
}

function stopGeneration() {
    ['A', 'B'].forEach(side => {
        const ctrl = state.abortControllers[side];
        if (ctrl) {
            ctrl.abort();
            state.abortControllers[side] = null;
            setHeaderStatus(side, 'stopped'); // 只在有控制器时设置状态
        }
    });

    state.isRunning = false;
    setSendButtonMode('send');
}

function clearActiveTopicMessages() {
    const topic = getActiveTopic();
    if (!topic) return;
    if (state.isRunning && !confirm('正在生成中，仍要清空当前话题并停止生成吗？')) return;
    if (!confirm('确定要清空当前话题的所有消息吗？')) return;
    if (state.isRunning) stopGeneration();

    topic.turns = [];
    topic.updatedAt = Date.now();
    scheduleSaveChat();
    renderAll();
}

function scheduleAutoCollapseThinking(ui, delayMs = 900) {
    if (!ui?.thinkingSectionEl) return;
    if (ui.thinkingSectionEl.dataset.userToggled === '1') return;

    if (ui.thinkingAutoCollapseTimer) clearTimeout(ui.thinkingAutoCollapseTimer);
    ui.thinkingAutoCollapseTimer = setTimeout(() => {
        ui.thinkingAutoCollapseTimer = null;
        if (!ui?.thinkingSectionEl) return;
        if (ui.thinkingSectionEl.dataset.userToggled === '1') return;
        ui.thinkingSectionEl.classList.add('collapsed');
    }, delayMs);
}

async function callModel(side, prompt, config, turn, ui, startTime) {
    setHeaderStatus(side, 'loading');
    applyStatus(ui.statusEl, 'loading');
    ui.modelNameEl.textContent = config.model || '未配置';

    const abortController = new AbortController();
    state.abortControllers[side] = abortController;

    const updateTime = () => {
        const elapsed = (Date.now() - startTime) / 1000;
        setHeaderTime(side, elapsed);
        ui.timeEl.textContent = `${elapsed.toFixed(1)}s`;
        turn.models[side].timeCostSec = elapsed;
    };

    let timeTimer = setInterval(updateTime, 200);

    try {
        const images = turn?.images || [];

        // 获取历史turns（不包含当前turn）
        const topic = getActiveTopic();
        const currentTurnIndex = topic?.turns?.findIndex(t => t.id === turn.id) ?? -1;
        const historyTurns = currentTurnIndex > 0 ? topic.turns.slice(0, currentTurnIndex) : [];

        // 构建请求体（发送到后端）
        const requestBody = {
            provider: config.provider,
            customFormat: config.customFormat || 'openai',
            apiKey: config.apiKey,
            model: config.model,
            apiUrl: config.apiUrl || null,
            prompt: prompt,
            images: images,
            systemPrompt: config.systemPrompt || null,
            thinking: config.thinking || false,
            enableHistory: isHistoryEnabled(),
            maxHistoryTurns: getMaxHistoryTurns(),
            historyTurns: historyTurns,
            side: side
        };

        // 调用后端接口
        const response = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: abortController.signal
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

        // 处理流式响应
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim() || line.startsWith(':')) continue;
                if (!line.startsWith('data: ')) continue;

                const data = line.slice(6);
                if (data === '[DONE]') continue;

                try {
                    const chunk = JSON.parse(data);

                    if (chunk.type === 'thinking' && chunk.data) {
                        turn.models[side].thinking += chunk.data;
                        ui.thinkingSectionEl.style.display = 'block';
                        if (ui.thinkingSectionEl.dataset.userToggled !== '1') {
                            ui.thinkingSectionEl.classList.remove('collapsed');
                        }
                        renderMarkdownToElement(ui.thinkingContentEl, turn.models[side].thinking);
                        scheduleAutoCollapseThinking(ui);
                        scheduleSaveChat();
                        updateScrollToBottomButton();
                        // 如果用户在底部附近，自动滚动跟随
                        if (isNearBottom(elements.chatMessages)) {
                            scrollToBottom(elements.chatMessages, false);
                        }
                    } else if (chunk.type === 'content' && chunk.data) {
                        turn.models[side].content += chunk.data;
                        renderMarkdownToElement(ui.responseEl, turn.models[side].content);
                        const tokens = estimateTokensFromText(turn.models[side].content);
                        ui.tokenEl.textContent = `${tokens} tokens`;
                        setHeaderTokens(side, tokens);
                        scheduleSaveChat();
                        updateScrollToBottomButton();
                        // 如果用户在底部附近，自动滚动跟随
                        if (isNearBottom(elements.chatMessages)) {
                            scrollToBottom(elements.chatMessages, false);
                        }
                    } else if (chunk.type === 'tokens' && Number.isFinite(chunk.data)) {
                        turn.models[side].tokens = chunk.data;
                        ui.tokenEl.textContent = `${chunk.data} tokens`;
                        setHeaderTokens(side, chunk.data);
                        scheduleSaveChat();
                    } else if (chunk.type === 'error') {
                        throw new Error(chunk.data);
                    }
                } catch (e) {
                    if (e.message && e.message !== data) {
                        throw e;
                    }
                    console.error(`解析响应失败:`, e, data);
                }
            }
        }

        updateTime();
        turn.models[side].status = 'complete';
        applyStatus(ui.statusEl, 'complete');
        setHeaderStatus(side, 'complete');

        if (turn.models[side].thinking && ui?.thinkingSectionEl?.dataset?.userToggled !== '1') {
            ui.thinkingSectionEl.classList.add('collapsed');
        }

        if (!Number.isFinite(turn.models[side].tokens)) {
            const tokens = estimateTokensFromText(turn.models[side].content);
            turn.models[side].tokens = tokens;
            ui.tokenEl.textContent = `${tokens} tokens`;
            setHeaderTokens(side, tokens);
        }
    } catch (error) {
        if (error?.name === 'AbortError') {
            turn.models[side].status = 'stopped';
            applyStatus(ui.statusEl, 'stopped');
            setHeaderStatus(side, 'stopped');
        } else {
            console.error(`模型${side}错误:`, error);
            turn.models[side].status = 'error';
            turn.models[side].content = `错误: ${error.message}`;
            renderMarkdownToElement(ui.responseEl, turn.models[side].content);
            applyStatus(ui.statusEl, 'error');
            setHeaderStatus(side, 'error');
        }
    } finally {
        if (timeTimer) clearInterval(timeTimer);
        timeTimer = null;
        if (ui?.thinkingAutoCollapseTimer) {
            clearTimeout(ui.thinkingAutoCollapseTimer);
            ui.thinkingAutoCollapseTimer = null;
        }
        state.abortControllers[side] = null;
    }
}

// ========== 提示词管理功能 ==========

// 初始化提示词数据
function initPrompts() {
    const raw = localStorage.getItem(STORAGE_KEYS.prompts);
    const activeRaw = localStorage.getItem(STORAGE_KEYS.activePromptId);

    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                state.prompts.list = parsed;
            }
        } catch (e) {
            console.error('加载提示词失败:', e);
        }
    }

    if (activeRaw && state.prompts.list.some(p => p.id === activeRaw)) {
        state.prompts.activeId = activeRaw;
    }
}

// 防抖保存提示词
function scheduleSavePrompts() {
    if (state.prompts.saveTimer) clearTimeout(state.prompts.saveTimer);
    state.prompts.saveTimer = setTimeout(() => {
        state.prompts.saveTimer = null;
        savePromptsState();
    }, 500);
}

// 保存提示词状态到localStorage
function savePromptsState() {
    try {
        localStorage.setItem(STORAGE_KEYS.prompts, JSON.stringify(state.prompts.list));
        if (state.prompts.activeId) {
            localStorage.setItem(STORAGE_KEYS.activePromptId, state.prompts.activeId);
        } else {
            localStorage.removeItem(STORAGE_KEYS.activePromptId);
        }
    } catch (e) {
        console.error('保存提示词失败:', e);
    }
}

// 创建新提示词
function createPrompt(name = '新提示词', content = '', description = '') {
    const now = Date.now();
    const prompt = {
        id: createId(),
        name: name || '新提示词',
        description: description || '',
        content: content || '',
        createdAt: now,
        updatedAt: now
    };
    state.prompts.list.unshift(prompt);
    scheduleSavePrompts();
    return prompt;
}

// 更新提示词
function updatePrompt(promptId, updates) {
    const prompt = state.prompts.list.find(p => p.id === promptId);
    if (!prompt) return false;

    if (updates.name !== undefined) prompt.name = updates.name;
    if (updates.description !== undefined) prompt.description = updates.description;
    if (updates.content !== undefined) prompt.content = updates.content;
    prompt.updatedAt = Date.now();

    scheduleSavePrompts();
    return true;
}

// 删除提示词
function deletePrompt(promptId) {
    const before = state.prompts.list.length;
    state.prompts.list = state.prompts.list.filter(p => p.id !== promptId);

    // 如果删除的是当前选中的提示词，清除选中状态
    if (state.prompts.activeId === promptId) {
        state.prompts.activeId = null;
        localStorage.removeItem(STORAGE_KEYS.activePromptId);
    }

    if (before !== state.prompts.list.length) {
        scheduleSavePrompts();
        return true;
    }
    return false;
}

// 应用提示词到模型A和B
function applyPrompt(promptId) {
    if (!promptId) {
        // 清除提示词
        state.prompts.activeId = null;
        localStorage.removeItem(STORAGE_KEYS.activePromptId);
        renderPromptSelector();
        return;
    }

    const prompt = state.prompts.list.find(p => p.id === promptId);
    if (!prompt) return;

    // 更新选中状态
    state.prompts.activeId = promptId;
    localStorage.setItem(STORAGE_KEYS.activePromptId, promptId);

    // 更新UI
    renderPromptSelector();
}

// 渲染提示词选择器（更新按钮文本）
function renderPromptSelector() {
    if (!elements.promptSelectorLabel) return;

    if (!state.prompts.activeId) {
        elements.promptSelectorLabel.textContent = '默认';
        return;
    }

    const prompt = state.prompts.list.find(p => p.id === state.prompts.activeId);
    elements.promptSelectorLabel.textContent = prompt ? prompt.name : '默认';
}

// 渲染提示词管理列表
function renderPromptList() {
    if (!elements.promptList) return;

    elements.promptList.innerHTML = '';

    if (state.prompts.list.length === 0) {
        const empty = document.createElement('div');
        empty.style.textAlign = 'center';
        empty.style.color = '#999';
        empty.style.padding = '40px 20px';
        empty.textContent = '暂无提示词，点击"新建"创建第一个提示词';
        elements.promptList.appendChild(empty);
        return;
    }

    for (const prompt of state.prompts.list) {
        const item = document.createElement('div');
        item.className = 'prompt-item';
        item.dataset.promptId = prompt.id;

        // 头部
        const header = document.createElement('div');
        header.className = 'prompt-item-header';
        const name = document.createElement('div');
        name.className = 'prompt-item-name';
        name.textContent = prompt.name;

        const actions = document.createElement('div');
        actions.className = 'prompt-item-actions';

        const previewBtn = document.createElement('button');
        previewBtn.type = 'button';
        previewBtn.className = 'prompt-item-btn';
        previewBtn.textContent = '预览';
        previewBtn.addEventListener('click', () => openPromptPreview(prompt));

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'prompt-item-btn';
        editBtn.textContent = '编辑';
        editBtn.addEventListener('click', () => enterEditMode(prompt.id));

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'prompt-item-btn delete';
        deleteBtn.textContent = '删除';
        deleteBtn.addEventListener('click', () => {
            if (confirm(`确定要删除提示词「${prompt.name}」吗？`)) {
                deletePrompt(prompt.id);
                renderPromptList();
                renderPromptSelector();
            }
        });

        actions.appendChild(previewBtn);
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        header.appendChild(name);
        header.appendChild(actions);

        // 描述（仅在有描述时显示）
        let content = null;
        if (prompt.description && prompt.description.trim()) {
            content = document.createElement('div');
            content.className = 'prompt-item-content';
            content.textContent = prompt.description;
        }

        // 元信息
        const meta = document.createElement('div');
        meta.className = 'prompt-item-meta';
        meta.textContent = `创建于 ${formatTime(prompt.createdAt)}`;
        if (prompt.updatedAt !== prompt.createdAt) {
            meta.textContent += ` · 更新于 ${formatTime(prompt.updatedAt)}`;
        }

        // 编辑表单（默认隐藏）
        const editForm = document.createElement('div');
        editForm.className = 'prompt-item-edit-form';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = '提示词名称';
        nameInput.value = prompt.name;

        const descriptionInput = document.createElement('input');
        descriptionInput.type = 'text';
        descriptionInput.placeholder = '提示词描述（可选）';
        descriptionInput.value = prompt.description || '';

        const contentTextarea = document.createElement('textarea');
        contentTextarea.placeholder = '提示词内容';
        contentTextarea.value = prompt.content;

        const editActions = document.createElement('div');
        editActions.className = 'prompt-item-edit-actions';

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'btn btn-primary btn-small';
        saveBtn.textContent = '保存';
        saveBtn.addEventListener('click', () => {
            const newName = nameInput.value.trim();
            const newDescription = descriptionInput.value.trim();
            const newContent = contentTextarea.value.trim();

            if (!newName) {
                alert('请输入提示词名称');
                return;
            }

            updatePrompt(prompt.id, { name: newName, description: newDescription, content: newContent });
            exitEditMode(prompt.id);
            renderPromptList();
            renderPromptSelector();
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn-secondary btn-small';
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', () => exitEditMode(prompt.id));

        editActions.appendChild(saveBtn);
        editActions.appendChild(cancelBtn);

        editForm.appendChild(nameInput);
        editForm.appendChild(descriptionInput);
        editForm.appendChild(contentTextarea);
        editForm.appendChild(editActions);

        item.appendChild(header);
        if (content) item.appendChild(content);
        item.appendChild(meta);
        item.appendChild(editForm);

        elements.promptList.appendChild(item);
    }
}

// 进入编辑模式
function enterEditMode(promptId) {
    const item = elements.promptList?.querySelector(`[data-prompt-id="${promptId}"]`);
    if (!item) return;
    item.classList.add('editing');
}

// 退出编辑模式
function exitEditMode(promptId) {
    const item = elements.promptList?.querySelector(`[data-prompt-id="${promptId}"]`);
    if (!item) return;
    item.classList.remove('editing');
}

// 打开提示词管理弹窗
function openPromptModal() {
    if (!elements.promptModal) return;
    elements.promptModal.classList.add('open');
    elements.promptModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    renderPromptList();
}

// 关闭提示词管理弹窗
function closePromptModal() {
    if (!elements.promptModal) return;
    elements.promptModal.classList.remove('open');
    elements.promptModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

// 打开提示词选择弹窗
function openPromptSelectorModal() {
    if (!elements.promptSelectorModal) return;
    elements.promptSelectorModal.classList.add('open');
    elements.promptSelectorModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    renderPromptSelectorList();
}

// 关闭提示词选择弹窗
function closePromptSelectorModal() {
    if (!elements.promptSelectorModal) return;
    elements.promptSelectorModal.classList.remove('open');
    elements.promptSelectorModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

// 渲染提示词选择列表
function renderPromptSelectorList() {
    if (!elements.promptSelectorList) return;

    elements.promptSelectorList.innerHTML = '';

    // 添加默认选项
    const defaultItem = document.createElement('div');
    defaultItem.className = 'prompt-selector-item prompt-selector-item-default';
    if (!state.prompts.activeId) {
        defaultItem.classList.add('active');
    }

    const defaultName = document.createElement('div');
    defaultName.className = 'prompt-selector-item-name';
    defaultName.textContent = '默认';
    defaultItem.appendChild(defaultName);

    const defaultDesc = document.createElement('div');
    defaultDesc.className = 'prompt-selector-item-desc';
    defaultDesc.textContent = '使用系统默认的提示词配置';
    defaultItem.appendChild(defaultDesc);

    defaultItem.addEventListener('click', () => {
        applyPrompt(null);
        closePromptSelectorModal();
    });

    elements.promptSelectorList.appendChild(defaultItem);

    // 添加自定义提示词
    for (const prompt of state.prompts.list) {
        const item = document.createElement('div');
        item.className = 'prompt-selector-item';
        if (prompt.id === state.prompts.activeId) {
            item.classList.add('active');
        }

        const name = document.createElement('div');
        name.className = 'prompt-selector-item-name';
        name.textContent = prompt.name;
        item.appendChild(name);

        if (prompt.description) {
            const desc = document.createElement('div');
            desc.className = 'prompt-selector-item-desc';
            desc.textContent = prompt.description;
            item.appendChild(desc);
        }

        item.addEventListener('click', () => {
            applyPrompt(prompt.id);
            closePromptSelectorModal();
        });

        elements.promptSelectorList.appendChild(item);
    }
}

// 导出提示词为JSON文件
function exportPrompts() {
    // 构建导出对象
    const exportData = {
        version: 1,
        exportedAt: Date.now(),
        prompts: state.prompts.list
    };

    // 创建JSON字符串
    const jsonStr = JSON.stringify(exportData, null, 2);

    // 创建Blob对象
    const blob = new Blob([jsonStr], { type: 'application/json' });

    // 生成文件名（prompts_20231215_143022.json）
    const now = new Date();
    const filename = `prompts_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}.json`;

    // 创建下载链接
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    // 清理URL对象
    URL.revokeObjectURL(url);
}

// 导入提示词
function importPrompts() {
    // 触发文件选择器
    elements.importPromptsInput.click();
}

// 绑定提示词相关事件
function bindPromptEvents() {
    // 打开提示词选择弹窗
    elements.promptSelectorBtn?.addEventListener('click', openPromptSelectorModal);

    // 关闭提示词选择弹窗
    elements.closePromptSelectorBtn?.addEventListener('click', closePromptSelectorModal);

    // 点击遮罩关闭选择弹窗
    elements.promptSelectorModal?.addEventListener('click', (e) => {
        if (e.target === elements.promptSelectorModal) closePromptSelectorModal();
    });

    // 打开管理界面
    elements.openPromptManagerBtn?.addEventListener('click', openPromptModal);

    // 关闭管理界面
    elements.closePromptModalBtn?.addEventListener('click', closePromptModal);

    // 点击遮罩关闭
    elements.promptModal?.addEventListener('click', (e) => {
        if (e.target === elements.promptModal) closePromptModal();
    });

    // 关闭预览界面
    elements.closePromptPreviewBtn?.addEventListener('click', closePromptPreview);

    // 点击遮罩关闭预览
    elements.promptPreviewModal?.addEventListener('click', (e) => {
        if (e.target === elements.promptPreviewModal) closePromptPreview();
    });

    // 新建提示词
    elements.newPromptBtn?.addEventListener('click', () => {
        const name = prompt('请输入提示词名称', '新提示词');
        if (name === null) return;

        const trimmedName = name.trim();
        if (!trimmedName) {
            alert('提示词名称不能为空');
            return;
        }

        createPrompt(trimmedName, '');
        renderPromptList();
        renderPromptSelector();
    });

    // 导出提示词
    elements.exportPromptsBtn?.addEventListener('click', exportPrompts);

    // 导入提示词
    elements.importPromptsBtn?.addEventListener('click', importPrompts);

    // 文件选择事件
    elements.importPromptsInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();

        reader.onload = (event) => {
            try {
                // 解析JSON
                const data = JSON.parse(event.target.result);

                // 验证格式
                if (!data.version || !Array.isArray(data.prompts)) {
                    alert('无效的提示词文件格式');
                    return;
                }

                // 导入提示词（重新生成ID）
                let importCount = 0;
                for (const item of data.prompts) {
                    if (!item.name) continue; // 跳过无效项

                    const prompt = {
                        id: createId(), // 重新生成ID避免冲突
                        name: item.name,
                        description: item.description || '',
                        content: item.content || '',
                        createdAt: item.createdAt || Date.now(),
                        updatedAt: item.updatedAt || Date.now()
                    };

                    state.prompts.list.unshift(prompt); // 添加到列表开头
                    importCount++;
                }

                // 保存并刷新UI
                scheduleSavePrompts();
                renderPromptList();
                renderPromptSelector();

                alert(`成功导入 ${importCount} 个提示词`);

            } catch (err) {
                console.error('导入失败:', err);
                alert('导入失败：文件格式错误或内容无效');
            }
        };

        reader.onerror = () => {
            alert('读取文件失败');
        };

        reader.readAsText(file);

        // 清空input，允许重复选择同一文件
        e.target.value = '';
    });
}

// 打开提示词预览
function openPromptPreview(prompt) {
    if (!elements.promptPreviewModal) return;

    // 设置标题
    const titleEl = document.getElementById('promptPreviewTitle');
    if (titleEl) titleEl.textContent = prompt.name;

    // 渲染内容
    const contentEl = document.getElementById('promptPreviewContent');
    if (contentEl) {
        if (prompt.content) {
            renderMarkdownToElement(contentEl, prompt.content);
        } else {
            contentEl.textContent = '(空)';
        }
    }

    // 显示模态框
    elements.promptPreviewModal.classList.add('open');
    elements.promptPreviewModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

// 关闭提示词预览
function closePromptPreview() {
    if (!elements.promptPreviewModal) return;
    elements.promptPreviewModal.classList.remove('open');
    elements.promptPreviewModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}
