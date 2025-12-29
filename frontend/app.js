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
        B: { timer: null, inFlight: false, lastKey: '', lastFetchedAt: 0, models: [], datalistFillToken: 0, dropdownLimit: 120 },
        Title: { timer: null, inFlight: false, lastKey: '', lastFetchedAt: 0, models: [], datalistFillToken: 0, dropdownLimit: 120 }
    },
    chat: {
        topics: [],
        activeTopicId: null,
        saveTimer: null,
        isCreatingTopic: false,
        generatingTitleForTopicId: null
    },
    images: {
        selectedImages: [] // 存储当前选择的图片 { id, dataUrl, name, size }
    },
    prompts: {
        list: [],
        activeId: null,
        saveTimer: null
    },
    autoScroll: true // 是否自动跟随滚动
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
    maxToolRounds: document.getElementById('maxToolRounds'),

    // 话题标题自动生成
    enableAutoTitle: document.getElementById('enableAutoTitle'),
    titleGenerationBaseRadios: document.querySelectorAll('input[name="titleGenerationBase"]'),
    titleGenerationModel: document.getElementById('titleGenerationModel'),
    modelDropdownTitle: document.getElementById('modelDropdownTitle'),
    modelDropdownBtnTitle: document.getElementById('modelDropdownBtnTitle'),

    // 初始问候语
    enableGreeting: document.getElementById('enableGreeting'),
    greetingText: document.getElementById('greetingText'),

    // 输入相关
    promptInput: document.getElementById('promptInput'),
    sendBtn: document.getElementById('sendBtn'),
    imageInput: document.getElementById('imageInput'),
    imageUploadBtn: document.getElementById('imageUploadBtn'),
    imagePreviewContainer: document.getElementById('imagePreviewContainer'),
    enableTools: document.getElementById('enableTools'),
    toolsList: document.getElementById('toolsList'),
    refreshToolsBtn: document.getElementById('refreshToolsBtn'),

    // 话题
    newTopicBtn: document.getElementById('newTopicBtn'),
    topicList: document.getElementById('topicList'),
    chatMessages: document.getElementById('chatMessages'),
    scrollToBottomBtn: document.getElementById('scrollToBottomBtn'),

    // 模型A配置
    providerA: document.getElementById('providerA'),
    providerHintA: document.getElementById('providerHintA'),
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
    closePromptPreviewBtn: document.getElementById('closePromptPreviewBtn'),
    promptEditModal: document.getElementById('promptEditModal'),
    closePromptEditBtn: document.getElementById('closePromptEditBtn'),
    savePromptEditBtn: document.getElementById('savePromptEditBtn'),
    promptEditName: document.getElementById('promptEditName'),
    promptEditDescription: document.getElementById('promptEditDescription'),
    promptEditContent: document.getElementById('promptEditContent')
};

// 获取标题生成配置选中的基础配置值
function getTitleGenerationBase() {
    return document.querySelector('input[name="titleGenerationBase"]:checked')?.value || 'A';
}

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
    loadTools(); // 加载工具列表
    
    // 初始化时触发标题模型获取
    scheduleFetchModels('Title', 500);
});

function getProviderMode(config) {
    const provider = config?.provider || 'openai';
    return provider === 'anthropic' ? 'anthropic' : 'openai';
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
            if (typeof hljs !== 'undefined') {
                try {
                    // 如果指定了语言且该语言已注册，则使用指定语言高亮
                    if (lang && hljs.getLanguage(lang)) {
                        return hljs.highlight(code, { language: lang }).value;
                    }
                    // 否则尝试自动检测语言
                    return hljs.highlightAuto(code).value;
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
    
    // 手动高亮所有代码块
    if (typeof hljs !== 'undefined') {
        const codeBlocks = root.querySelectorAll('pre code');
        codeBlocks.forEach(block => {
            try {
                // 获取语言类型
                const lang = getLanguageFromCodeEl(block);
                
                // 跳过不支持的语言（如 mermaid、plantuml 等需要特殊渲染的）
                const unsupportedLanguages = ['mermaid', 'plantuml', 'graphviz', 'dot'];
                if (unsupportedLanguages.includes(lang.toLowerCase())) {
                    return;
                }
                
                // 只高亮支持的语言
                if (!lang || hljs.getLanguage(lang)) {
                    hljs.highlightElement(block);
                }
            } catch (e) {
                console.error('手动高亮代码块失败:', e);
            }
        });
    }
    
    addCopyButtonsToCodeBlocks(root);
    // 为所有链接添加 target="_blank" 和 rel="noopener noreferrer"
    const links = root.querySelectorAll('a[href]');
    links.forEach(link => {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
    });
}

function getLanguageFromCodeEl(codeEl) {
    const className = (codeEl?.className || '').toString();
    const m = className.match(/(?:^|\s)(?:language|lang)-([\w-]+)(?:\s|$)/i);
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
        resetDelayMs = 1800,
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

        btn.appendChild(mkSvg('icon-copy', '<rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>'));
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
            // 成功状态直接消失，不恢复原状态
            if (icon && ok) {
                // 添加淡出类，但保持success状态显示对勾图标
                btn.classList.add('copy-btn-fade-out');
                setTimeout(() => {
                    btn.disabled = false;
                    btn.classList.remove('copy-btn-fade-out');
                    delete btn.dataset.copyState;
                    btn.title = original;
                }, 300);
            } else {
                // 错误状态或非图标按钮恢复原状态
                btn.disabled = false;
                if (icon) {
                    delete btn.dataset.copyState;
                    btn.title = original;
                } else {
                    btn.textContent = original;
                }
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

        const language = getLanguageFromCodeEl(codeEl);

        const lang = document.createElement('span');
        lang.className = 'code-lang';
        lang.textContent = language || 'text';
        toolbar.appendChild(lang);

        // 使用统一的createCopyButton函数创建复制按钮
        const btn = createCopyButton(
            () => codeEl.textContent || '',
            {
                label: '复制代码',
                icon: true,
                className: 'code-copy-btn'
            }
        );

        // 检查是否在 loading 状态的消息中，如果是则立即禁用按钮
        const message = root.closest('.assistant-message');
        if (message && message.classList.contains('loading')) {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        }

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
    
    // 刷新工具列表按钮
    elements.refreshToolsBtn?.addEventListener('click', loadTools);

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

    // 工具调用开关的label元素，阻止焦点转移
    const toolsLabel = elements.enableTools?.parentElement;
    if (toolsLabel) {
        toolsLabel.addEventListener('mousedown', (e) => {
            // 只阻止label本身的默认行为，不阻止checkbox的点击
            if (e.target === toolsLabel || e.target.classList.contains('switch-track') || e.target.classList.contains('switch-text') || e.target.tagName === 'svg' || e.target.tagName === 'path') {
                e.preventDefault();
            }
        });
    }

    elements.enableTools?.addEventListener('change', (e) => {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.config);
            const config = raw ? JSON.parse(raw) : {};
            config.tools = config.tools || {};
            config.tools.enabled = elements.enableTools ? !!elements.enableTools.checked : true;
            localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(config));
        } catch (e) {
            console.error('保存工具调用开关失败:', e);
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
        state.autoScroll = true;
        scrollToBottom(elements.chatMessages, true);
    });

    // 监听聊天消息区域的滚动事件，控制按钮显示和自动滚动状态
    elements.chatMessages?.addEventListener('scroll', () => {
        updateScrollToBottomButton();
        
        // 检测用户是否手动向上滚动（不在底部）
        if (!isNearBottom(elements.chatMessages)) {
            state.autoScroll = false;
        } else {
            // 如果用户滚回底部，重新启用自动滚动
            state.autoScroll = true;
        }
    });

    elements.newTopicBtn.addEventListener('click', () => {
        if (state.chat.isCreatingTopic) return; // 防止重复创建
        
        if (state.isRunning && !confirm('正在生成中，仍要新建话题并停止当前生成吗？')) return;
        
        // 检查当前话题是否为空（只有问候语或无消息）
        const currentTopic = getActiveTopic();
        if (currentTopic) {
            const hasRealContent = currentTopic.turns.some(turn => 
                !turn.isGreeting && turn.prompt?.trim()
            );
            
            if (!hasRealContent && currentTopic.turns.length <= 1) {
                // 当前话题为空，无需创建新话题
                elements.promptInput.focus();
                return;
            }
        }
        
        if (state.isRunning) stopGeneration();
        
        state.chat.isCreatingTopic = true;
        try {
            const topic = createTopic();
            setActiveTopic(topic.id);
            renderAll();
            elements.promptInput.focus();
        } finally {
            state.chat.isCreatingTopic = false;
        }
    });

    // 监听提供商变化，更新API地址提示 + 自动获取模型列表
    elements.providerA.addEventListener('change', () => {
        updateProviderUi('A');
        updateModelHint('A');
        scheduleFetchModels('A', 0);
        // 如果标题使用的是A的配置，也触发Title的模型获取
        if (getTitleGenerationBase() === 'A') {
            scheduleFetchModels('Title', 0);
        }
    });
    elements.providerB.addEventListener('change', () => {
        updateProviderUi('B');
        updateModelHint('B');
        scheduleFetchModels('B', 0);
        // 如果标题使用的是B的配置，也触发Title的模型获取
        if (getTitleGenerationBase() === 'B') {
            scheduleFetchModels('Title', 0);
        }
    });

    // 标题生成模型配置监听
    elements.titleGenerationBaseRadios?.forEach(radio => {
        radio.addEventListener('change', () => {
            scheduleFetchModels('Title', 200);
        });
    });

    elements.apiKeyA?.addEventListener('input', () => {
        updateModelHint('A');
        scheduleFetchModels('A', 400);
        // 如果标题使用的是A的配置，也触发Title的模型获取
        if (getTitleGenerationBase() === 'A') {
            scheduleFetchModels('Title', 400);
        }
    });
    elements.apiKeyB?.addEventListener('input', () => {
        updateModelHint('B');
        scheduleFetchModels('B', 400);
        // 如果标题使用的是B的配置，也触发Title的模型获取
        if (getTitleGenerationBase() === 'B') {
            scheduleFetchModels('Title', 400);
        }
    });
    elements.apiUrlA?.addEventListener('input', () => {
        updateModelHint('A');
        scheduleFetchModels('A', 500);
        // 如果标题使用的是A的配置，也触发Title的模型获取
        if (getTitleGenerationBase() === 'A') {
            scheduleFetchModels('Title', 500);
        }
    });
    elements.apiUrlB?.addEventListener('input', () => {
        updateModelHint('B');
        scheduleFetchModels('B', 500);
        // 如果标题使用的是B的配置，也触发Title的模型获取
        if (getTitleGenerationBase() === 'B') {
            scheduleFetchModels('Title', 500);
        }
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
    elements.titleGenerationModel?.addEventListener('input', () => {
        updateModelDropdownFilter('Title');
    });

    elements.modelDropdownBtnA?.addEventListener('click', () => toggleModelDropdown('A'));
    elements.modelDropdownBtnB?.addEventListener('click', () => toggleModelDropdown('B'));
    elements.modelDropdownBtnTitle?.addEventListener('click', () => toggleModelDropdown('Title'));
    elements.modelA?.addEventListener('focus', () => updateModelDropdownFilter('A'));
    elements.modelB?.addEventListener('focus', () => updateModelDropdownFilter('B'));
    elements.titleGenerationModel?.addEventListener('focus', () => updateModelDropdownFilter('Title'));

    document.addEventListener('mousedown', (e) => {
        const t = e.target;
        if (!(t instanceof Node)) return;
        if (t.closest?.('.model-picker')) return;
        closeModelDropdown('A');
        closeModelDropdown('B');
        closeModelDropdown('Title');
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

    if (hintEl) {
        if (provider === 'openai') {
            hintEl.textContent = 'OpenAI 兼容接口（Chat Completions 格式）；API地址可留空，默认使用官方接口。支持 DeepSeek、Qwen 等兼容服务。';
        } else if (provider === 'anthropic') {
            hintEl.textContent = 'Anthropic 兼容接口（Messages 格式）；API地址可留空，默认使用官方接口。支持兼容 Anthropic 格式的服务。';
        }
    }

    updateApiUrlPlaceholder(side);
    updateModelHint(side);
}

function updateApiUrlPlaceholder(side) {
    const providerEl = elements[`provider${side}`];
    const urlInput = elements[`apiUrl${side}`];
    if (!providerEl || !urlInput) return;
    
    const provider = providerEl.value;
    const placeholders = {
        openai: 'https://api.openai.com/v1/chat/completions',
        anthropic: 'https://api.anthropic.com/v1/messages'
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
    // 如果是标题模型，从选择的base配置中获取
    if (side === 'Title') {
        const base = getTitleGenerationBase();
        return {
            provider: elements[`provider${base}`]?.value || 'openai',
            apiKey: elements[`apiKey${base}`]?.value || '',
            apiUrl: elements[`apiUrl${base}`]?.value || ''
        };
    }
    
    return {
        provider: elements[`provider${side}`]?.value || 'openai',
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
    const apiKey = (config.apiKey || '').trim();

    if (!apiKey) {
        setModelHint(side, '提示：这里填写模型 ID；填写 API Key 后会自动获取可用模型列表（也可手动输入）。');
        return;
    }

    setModelHint(side, '提示：这里填写模型 ID；将自动获取可用模型列表（可下拉选择或直接输入）。');
}

function getCachedModelIds(side) {
    const slot = state.modelFetch[side];
    return Array.isArray(slot?.models) ? slot.models : [];
}

function getModelDropdownLimit(side) {
    const slot = state.modelFetch[side];
    if (!slot) return 120;
    return Math.max(40, Math.min(2000, Number(slot.dropdownLimit) || 120));
}

function resetModelDropdownLimit(side) {
    const slot = state.modelFetch[side];
    if (!slot) return;
    slot.dropdownLimit = 120;
}

function increaseModelDropdownLimit(side, delta = 200) {
    const slot = state.modelFetch[side];
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

    const slot = state.modelFetch[side];
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
            const input = side === 'Title' ? elements.titleGenerationModel : elements[`model${side}`];
            if (input) input.value = id;
            if (side !== 'Title') updateModelNames();
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
    const inputEl = side === 'Title' ? elements.titleGenerationModel : elements[`model${side}`];
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
    const inputEl = side === 'Title' ? elements.titleGenerationModel : elements[`model${side}`];
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
    const slot = state.modelFetch[side];
    if (!slot) return;

    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = setTimeout(() => {
        slot.timer = null;
        void fetchAndUpdateModels(side);
    }, Math.max(0, delayMs || 0));
}

async function fetchAndUpdateModels(side) {
    const slot = state.modelFetch[side];
    if (!slot || slot.inFlight) return;

    const config = getConfigFromForm(side);
    if (!(config.apiKey || '').trim()) {
        slot.models = [];
        closeModelDropdown(side);
        if (side !== 'Title') updateModelHint(side);
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
        if (side !== 'Title') {
            setModelHint(side, `已自动获取 ${ids.length} 个模型 ID（可下拉选择或直接输入）。`);
        }
        // 只在下拉框已经打开的情况下更新显示，不自动打开
        if (isModelDropdownOpen(side)) {
            const inputEl = side === 'Title' ? elements.titleGenerationModel : elements[`model${side}`];
            renderModelDropdown(side, inputEl?.value || '');
        }
        slot.lastKey = fetchKey;
        slot.lastFetchedAt = now;
    } catch (e) {
        console.warn(`模型${side}模型列表获取失败:`, e?.message || e);
        slot.models = [];
        closeModelDropdown(side);
        if (side !== 'Title') {
            setModelHint(side, '提示：这里填写模型 ID；自动获取失败，可手动输入。');
        }
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
        tools: {
            enabled: elements.enableTools ? !!elements.enableTools.checked : true
        },
        history: {
            enableHistory: !!elements.enableHistory?.checked,
            maxHistoryTurns: parseInt(elements.maxHistoryTurns?.value) || 10
        },
        autoTitle: {
            enabled: !!elements.enableAutoTitle?.checked,
            base: getTitleGenerationBase(),
            model: elements.titleGenerationModel?.value || ''
        },
        greeting: {
            enabled: !!elements.enableGreeting?.checked,
            text: elements.greetingText?.value || '你好，有什么需要帮助的？'
        },
        A: {
            provider: elements.providerA.value,
            apiKey: elements.apiKeyA.value,
            model: elements.modelA.value,
            apiUrl: elements.apiUrlA.value,
            thinking: elements.thinkingA.checked
        },
        B: {
            provider: elements.providerB.value,
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
    const config = saved ? JSON.parse(saved) : {};
    
    try {
        // 加载联网搜索配置 - 总是设置状态，默认关闭
        if (elements.enableWebSearch) {
            const webSearchEnabled = config.webSearch?.enabled === true;
            elements.enableWebSearch.checked = webSearchEnabled;
        }
        if (config.webSearch) {
            if (elements.tavilyApiKey) elements.tavilyApiKey.value = config.webSearch.tavilyApiKey || '';
            if (elements.tavilyMaxResults) elements.tavilyMaxResults.value = config.webSearch.maxResults || 5;
        }
        // 加载工具调用配置 - 总是设置状态，默认关闭
        if (elements.enableTools) {
            const toolsEnabled = config.tools?.enabled === true;
            elements.enableTools.checked = toolsEnabled;
        }
        // 加载对话历史配置（兼容旧的 timeContext 配置）
        const historyConfig = config.history || config.timeContext;
        if (historyConfig) {
            if (elements.enableHistory) elements.enableHistory.checked = historyConfig.enableHistory !== false;
            if (elements.maxHistoryTurns) elements.maxHistoryTurns.value = historyConfig.maxHistoryTurns || 10;
        }
        // 加载话题标题自动生成配置
        if (config.autoTitle) {
            if (elements.enableAutoTitle) elements.enableAutoTitle.checked = config.autoTitle.enabled !== false;
            const baseValue = config.autoTitle.base || 'A';
            const radioToCheck = document.querySelector(`input[name="titleGenerationBase"][value="${baseValue}"]`);
            if (radioToCheck) radioToCheck.checked = true;
            if (elements.titleGenerationModel) elements.titleGenerationModel.value = config.autoTitle.model || '';
        }
        // 加载初始问候语配置
        if (config.greeting) {
            if (elements.enableGreeting) elements.enableGreeting.checked = config.greeting.enabled !== false;
            if (elements.greetingText) elements.greetingText.value = config.greeting.text || '你好，有什么需要帮助的？';
        }
        if (config.A) {
            elements.providerA.value = config.A.provider || 'openai';
            elements.apiKeyA.value = config.A.apiKey || '';
            elements.modelA.value = config.A.model || '';
            elements.apiUrlA.value = config.A.apiUrl || '';
            elements.thinkingA.checked = !!config.A.thinking;
        }
        if (config.B) {
            elements.providerB.value = config.B.provider || 'openai';
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
    if (elements.enableTools) elements.enableTools.checked = false;
    if (elements.tavilyApiKey) elements.tavilyApiKey.value = '';
    if (elements.tavilyMaxResults) elements.tavilyMaxResults.value = 5;
    if (elements.enableHistory) elements.enableHistory.checked = true;
    if (elements.maxHistoryTurns) elements.maxHistoryTurns.value = 10;

    ['A', 'B'].forEach(side => {
        elements[`provider${side}`].value = 'openai';
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

    // 如果是标题生成，从基础配置获取
    if (side === 'Title') {
        const base = getTitleGenerationBase();
        const customModel = elements.titleGenerationModel?.value || '';
        return {
            provider: elements[`provider${base}`]?.value || 'openai',
            apiKey: elements[`apiKey${base}`]?.value || '',
            model: customModel || elements[`model${base}`]?.value || '',
            apiUrl: elements[`apiUrl${base}`]?.value || '',
            systemPrompt: '', // 标题生成不需要系统提示词
            thinking: false
        };
    }

    return {
        provider: elements[`provider${side}`]?.value || 'openai',
        apiKey: elements[`apiKey${side}`]?.value || '',
        model: elements[`model${side}`]?.value || '',
        apiUrl: elements[`apiUrl${side}`]?.value || '',
        systemPrompt: systemPrompt,
        thinking: elements[`thinking${side}`]?.checked || false
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

function createTopic(forceCreate = false) {
    // 检查是否已存在空的新话题（避免重复创建）
    if (!forceCreate) {
        const emptyNewTopic = state.chat.topics.find(t => 
            t.title === '新话题' && 
            t.turns.length <= 1 && // 只有问候语或无消息
            t.turns.every(turn => turn.isGreeting || !turn.prompt?.trim())
        );
        
        if (emptyNewTopic) {
            console.log('复用现有空话题:', emptyNewTopic.id);
            return emptyNewTopic;
        }
    }
    
    const now = Date.now();
    const topic = {
        id: createId(),
        title: '新话题',
        createdAt: now,
        updatedAt: now,
        turns: []
    };

    // 检查是否启用初始问候语
    let greetingEnabled = elements.enableGreeting ? elements.enableGreeting.checked : true;
    let greetingText = elements.greetingText ? elements.greetingText.value : '你好，有什么需要帮助的？';

    const saved = localStorage.getItem(STORAGE_KEYS.config);
    if (saved) {
        try {
            const config = JSON.parse(saved);
            if (config.greeting) {
                greetingEnabled = config.greeting.enabled !== false;
                greetingText = config.greeting.text || greetingText;
            }
        } catch (e) {
            console.error('加载问候语配置失败:', e);
        }
    }

    // 如果启用问候语，创建问候消息
    if (greetingEnabled) {
        const greetingTurn = {
            id: createId(),
            createdAt: now,
            prompt: '',
            images: [],
            webSearch: null,
            isGreeting: true, // 标记为问候消息
            greetingText: greetingText,
            models: {}
        };
        topic.turns.push(greetingTurn);
    }

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
        const isGeneratingTitle = state.chat.generatingTitleForTopicId === topic.id;
        item.className = `topic-item${topic.id === state.chat.activeTopicId ? ' active' : ''}${isGeneratingTitle ? ' generating-title' : ''}`;
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

    // 如果是问候消息，使用特殊的渲染方式
    if (turn.isGreeting) {
        turnEl.classList.add('greeting-turn');
        const greetingWrap = document.createElement('div');
        greetingWrap.className = 'greeting-wrap';

        const greetingBubble = document.createElement('div');
        greetingBubble.className = 'greeting-bubble';
        greetingBubble.textContent = turn.greetingText || '你好，有什么需要帮助的？';

        greetingWrap.appendChild(greetingBubble);
        turnEl.appendChild(greetingWrap);

        return { el: turnEl, cards: {}, webSearchEl: null };
    }

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



function createAssistantCard(side, turn) {
    const modelSnapshot = turn?.models?.[side]?.model || '';
    const contentSnapshot = turn?.models?.[side]?.content || '';
    const thinkingSnapshot = turn?.models?.[side]?.thinking || '';
    const thinkingTimeSnapshot = turn?.models?.[side]?.thinkingTime || 0;
    const tokenSnapshot = turn?.models?.[side]?.tokens;
    const timeSnapshot = turn?.models?.[side]?.timeCostSec;
    const statusSnapshot = turn?.models?.[side]?.status || 'ready';

    const message = document.createElement('div');
    message.className = `assistant-message assistant-${side.toLowerCase()}`;
    if (statusSnapshot === 'loading') {
        message.classList.add('loading');
    }

    // 头部：模型名称 + 状态
    const header = document.createElement('div');
    header.className = 'assistant-message-header';

    const modelName = document.createElement('span');
    modelName.className = 'assistant-model-name';
    modelName.textContent = modelSnapshot || (side === 'A' ? (elements.modelNameA.textContent || '未配置') : (elements.modelNameB.textContent || '未配置'));

    const statusEl = document.createElement('span');
    statusEl.className = 'status';
    applyStatus(statusEl, statusSnapshot);

    header.appendChild(modelName);
    header.appendChild(statusEl);

    // 内容区域
    const content = document.createElement('div');
    content.className = 'assistant-message-content';

    const thinkingSection = document.createElement('div');
    thinkingSection.className = 'thinking-section collapsed';
    thinkingSection.style.display = 'none';

    const thinkingHeader = document.createElement('div');
    thinkingHeader.className = 'thinking-header';
    const thinkingLabel = document.createElement('span');
    thinkingLabel.textContent = '思考过程';
    const thinkingTime = document.createElement('span');
    thinkingTime.className = 'thinking-time';
    if (thinkingTimeSnapshot > 0) {
        thinkingTime.textContent = `${thinkingTimeSnapshot.toFixed(1)}s`;
    }
    thinkingHeader.appendChild(thinkingLabel);
    thinkingHeader.appendChild(thinkingTime);
    thinkingHeader.addEventListener('click', () => {
        thinkingSection.dataset.userToggled = '1';
        thinkingSection.classList.toggle('collapsed');
        // 保存折叠状态到数据中
        const collapsed = thinkingSection.classList.contains('collapsed');
        if (turn?.models?.[side]) {
            turn.models[side].thinkingCollapsed = collapsed;
            scheduleSaveChat();
        }
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
        // 如果有保存的折叠状态，使用该状态；否则默认折叠
        const shouldCollapse = turn?.models?.[side]?.thinkingCollapsed !== false;
        if (shouldCollapse) {
            thinkingSection.classList.add('collapsed');
        } else {
            thinkingSection.classList.remove('collapsed');
        }
    }

    const responseSection = document.createElement('div');
    responseSection.className = 'response-section';
    const responseContent = document.createElement('div');
    responseContent.className = 'response-content';
    renderMarkdownToElement(responseContent, contentSnapshot);
    responseSection.appendChild(responseContent);

    content.appendChild(thinkingSection);
    content.appendChild(responseSection);

    // 底部：元数据 + 操作按钮
    const footer = document.createElement('div');
    footer.className = 'assistant-message-footer';

    const metaInfo = document.createElement('div');
    metaInfo.className = 'message-meta';

    const tokenEl = document.createElement('span');
    tokenEl.className = 'meta-item token-count';
    tokenEl.textContent = `${Number.isFinite(tokenSnapshot) ? tokenSnapshot : estimateTokensFromText(contentSnapshot)} tokens`;
    
    const timeEl = document.createElement('span');
    timeEl.className = 'meta-item time-cost';
    timeEl.textContent = `${Number.isFinite(timeSnapshot) ? timeSnapshot.toFixed(1) : '0.0'}s`;

    const speedEl = document.createElement('span');
    speedEl.className = 'meta-item token-speed';
    if (Number.isFinite(tokenSnapshot) && Number.isFinite(timeSnapshot) && timeSnapshot > 0) {
        const speed = tokenSnapshot / timeSnapshot;
        speedEl.textContent = `${speed.toFixed(1)} t/s`;
    } else {
        speedEl.textContent = '';
        speedEl.style.display = 'none';
    }

    metaInfo.appendChild(tokenEl);
    metaInfo.appendChild(timeEl);
    metaInfo.appendChild(speedEl);

    const actions = document.createElement('div');
    actions.className = 'message-actions';

    // 复制按钮
    const copyBtn = createCopyButton(
        () => turn?.models?.[side]?.content || '',
        {
            label: '复制',
            icon: true,
            className: 'action-btn copy-btn'
        }
    );

    actions.appendChild(copyBtn);

    footer.appendChild(metaInfo);
    footer.appendChild(actions);

    message.appendChild(header);
    message.appendChild(content);
    message.appendChild(footer);

    return {
        el: message,
        statusEl,
        modelNameEl: modelName,
        responseEl: responseContent,
        thinkingSectionEl: thinkingSection,
        thinkingContentEl: thinkingContent,
        thinkingTimeEl: thinkingTime,
        tokenEl,
        timeEl,
        speedEl,
        copyBtn,
        thinkingAutoCollapseTimer: null,
        turn: turn,
        side: side
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

    // 同步更新消息的loading状态类和复制按钮状态
    const message = statusEl.closest('.assistant-message');
    if (message) {
        const isLoading = status === 'loading';
        if (isLoading) {
            message.classList.add('loading');
        } else {
            message.classList.remove('loading');
        }
        
        // 禁用/启用消息的复制按钮
        const copyBtn = message.querySelector('.message-actions .action-btn.copy-btn');
        if (copyBtn) {
            copyBtn.disabled = isLoading;
            copyBtn.style.opacity = isLoading ? '0.5' : '';
            copyBtn.style.cursor = isLoading ? 'not-allowed' : '';
        }
        
        // 禁用/启用所有代码块的复制按钮
        const codeBlockCopyBtns = message.querySelectorAll('.code-copy-btn');
        codeBlockCopyBtns.forEach(btn => {
            btn.disabled = isLoading;
            btn.style.opacity = isLoading ? '0.5' : '';
            btn.style.cursor = isLoading ? 'not-allowed' : '';
        });
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
    const hasImages = state.images.selectedImages && state.images.selectedImages.length > 0;

    if (!prompt && !hasImages) {
        alert('请输入内容或上传图片');
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
        // 检查是否有空话题可以复用
        const emptyTopic = state.chat.topics.find(t => 
            t.turns.length === 0 || 
            (t.turns.length === 1 && t.turns[0].isGreeting)
        );
        
        if (emptyTopic) {
            topic = emptyTopic;
            setActiveTopic(topic.id);
        } else {
            topic = createTopic();
            setActiveTopic(topic.id);
        }
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
            status: 'loading',
            thinkingCollapsed: true // 默认折叠
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
            status: 'loading',
            thinkingCollapsed: true // 默认折叠
        };
    }

    topic.turns = Array.isArray(topic.turns) ? topic.turns : [];
    topic.turns.push(turn);
    topic.updatedAt = now;

    scheduleSaveChat();

    const createdEls = createTurnElement(turn);
    elements.chatMessages.appendChild(createdEls.el);
    renderTopicList();

    // 发送后立即滚动到底部，并启用自动滚动
    state.autoScroll = true;
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

    // 自动生成标题
    autoGenerateTitle();
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
        // 保存自动折叠的状态
        if (ui.turn && ui.side && ui.turn.models[ui.side]) {
            ui.turn.models[ui.side].thinkingCollapsed = true;
            scheduleSaveChat();
        }
    }, delayMs);
}

async function callModel(side, prompt, config, turn, ui, startTime) {
    setHeaderStatus(side, 'loading');
    applyStatus(ui.statusEl, 'loading');
    ui.modelNameEl.textContent = config.model || '未配置';

    const abortController = new AbortController();
    state.abortControllers[side] = abortController;

    let thinkingStartTime = null;
    let thinkingEndTime = null;

    const updateTime = () => {
        const elapsed = (Date.now() - startTime) / 1000;
        setHeaderTime(side, elapsed);
        ui.timeEl.textContent = `${elapsed.toFixed(1)}s`;
        turn.models[side].timeCostSec = elapsed;

        if (thinkingStartTime) {
            const end = thinkingEndTime || Date.now();
            const thinkingElapsed = (end - thinkingStartTime) / 1000;
            ui.thinkingTimeEl.textContent = `${thinkingElapsed.toFixed(1)}s`;
            turn.models[side].thinkingTime = thinkingElapsed;
        }

        // 实时更新速度
        const tokens = turn.models[side].tokens || estimateTokensFromText(turn.models[side].content);
        if (tokens > 0 && elapsed > 0.1) {
            const speed = tokens / elapsed;
            ui.speedEl.textContent = `${speed.toFixed(1)} t/s`;
            ui.speedEl.style.display = 'inline';
        }
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
            side: side,
            enableTools: elements.enableTools?.checked || false,
            maxToolRounds: parseInt(elements.maxToolRounds?.value) || 5,
            selectedTools: getSelectedTools()
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
                        if (!thinkingStartTime) thinkingStartTime = Date.now();
                        turn.models[side].thinking += chunk.data;
                        ui.thinkingSectionEl.style.display = 'block';
                        if (ui.thinkingSectionEl.dataset.userToggled !== '1') {
                            ui.thinkingSectionEl.classList.remove('collapsed');
                        }
                        renderMarkdownToElement(ui.thinkingContentEl, turn.models[side].thinking);
                        scheduleAutoCollapseThinking(ui);
                        scheduleSaveChat();
                        updateScrollToBottomButton();
                        // 首次收到思考内容时，移除loading类以显示body和footer
                        const message = ui.statusEl.closest('.assistant-message');
                        if (message && message.classList.contains('loading')) {
                            message.classList.remove('loading');
                        }
                        // 如果启用了自动滚动，则跟随内容滚动
                        if (state.autoScroll) {
                            scrollToBottom(elements.chatMessages, false);
                        }
                    } else if (chunk.type === 'content' && chunk.data) {
                        if (thinkingStartTime && !thinkingEndTime) thinkingEndTime = Date.now();
                        turn.models[side].content += chunk.data;
                        renderMarkdownToElement(ui.responseEl, turn.models[side].content);
                        const tokens = estimateTokensFromText(turn.models[side].content);
                        ui.tokenEl.textContent = `${tokens} tokens`;
                        setHeaderTokens(side, tokens);
                        scheduleSaveChat();
                        updateScrollToBottomButton();
                        // 首次收到内容时，移除loading类以显示body和footer
                        const message = ui.statusEl.closest('.assistant-message');
                        if (message && message.classList.contains('loading')) {
                            message.classList.remove('loading');
                        }
                        // 如果启用了自动滚动，则跟随内容滚动
                        if (state.autoScroll) {
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
            turn.models[side].thinkingCollapsed = true;
        }

        if (!Number.isFinite(turn.models[side].tokens)) {
            const tokens = estimateTokensFromText(turn.models[side].content);
            turn.models[side].tokens = tokens;
            ui.tokenEl.textContent = `${tokens} tokens`;
            setHeaderTokens(side, tokens);
            
            // 确保最终速度显示正确
            if (turn.models[side].timeCostSec > 0) {
                const speed = tokens / turn.models[side].timeCostSec;
                ui.speedEl.textContent = `${speed.toFixed(1)} t/s`;
                ui.speedEl.style.display = 'inline';
            }
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
        editBtn.addEventListener('click', () => openPromptEdit(prompt.id));

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

        item.appendChild(header);
        if (content) item.appendChild(content);
        item.appendChild(meta);

        elements.promptList.appendChild(item);
    }
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

    // 关闭编辑界面
    elements.closePromptEditBtn?.addEventListener('click', closePromptEdit);

    // 点击遮罩关闭编辑
    elements.promptEditModal?.addEventListener('click', (e) => {
        if (e.target === elements.promptEditModal) closePromptEdit();
    });

    // 保存编辑
    elements.savePromptEditBtn?.addEventListener('click', savePromptEdit);

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
            contentEl.textContent = '';
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

// 当前编辑的提示词ID
let editingPromptId = null;

// 打开提示词编辑弹框
function openPromptEdit(promptId) {
    if (!elements.promptEditModal) return;
    
    const prompt = state.prompts.list.find(p => p.id === promptId);
    if (!prompt) return;
    
    // 保存当前编辑的ID
    editingPromptId = promptId;
    
    // 填充表单
    if (elements.promptEditName) elements.promptEditName.value = prompt.name;
    if (elements.promptEditDescription) elements.promptEditDescription.value = prompt.description || '';
    if (elements.promptEditContent) elements.promptEditContent.value = prompt.content;
    
    // 显示模态框
    elements.promptEditModal.classList.add('open');
    elements.promptEditModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    
    // 聚焦到名称输入框
    setTimeout(() => {
        if (elements.promptEditName) elements.promptEditName.focus();
    }, 100);
}

// 关闭提示词编辑弹框
function closePromptEdit() {
    if (!elements.promptEditModal) return;
    elements.promptEditModal.classList.remove('open');
    elements.promptEditModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    editingPromptId = null;
}

// 保存编辑
function savePromptEdit() {
    if (!editingPromptId) return;
    
    const newName = elements.promptEditName?.value.trim();
    const newDescription = elements.promptEditDescription?.value.trim();
    const newContent = elements.promptEditContent?.value.trim();
    
    if (!newName) {
        alert('请输入提示词名称');
        return;
    }
    
    updatePrompt(editingPromptId, { 
        name: newName, 
        description: newDescription || '', 
        content: newContent 
    });
    
    renderPromptList();
    renderPromptSelector();
    closePromptEdit();
}
// ========== 工具管理功能 ==========

// 全局变量存储工具状态
let availableTools = [];
let selectedToolNames = [];

// 加载工具列表
async function loadTools() {
    try {
        const response = await fetch('/api/tools');
        const data = await response.json();
        availableTools = data.tools || [];
        
        // 从 localStorage 加载已选中的工具
        const saved = localStorage.getItem('selectedTools');
        if (saved) {
            selectedToolNames = JSON.parse(saved);
        } else {
            // 默认全部选中
            selectedToolNames = availableTools.map(t => t.function.name);
        }
        
        renderToolsList();
    } catch (error) {
        console.error('加载工具列表失败:', error);
        if (elements.toolsList) {
            elements.toolsList.innerHTML = '<div style="color: #f44336; padding: 12px; text-align: center;">加载失败</div>';
        }
    }
}

// 渲染工具列表
function renderToolsList() {
    if (!elements.toolsList) return;
    
    if (availableTools.length === 0) {
        elements.toolsList.innerHTML = '<div style="color: #999; padding: 12px; text-align: center;">暂无可用工具</div>';
        return;
    }
    
    const html = availableTools.map(tool => {
        const name = tool.function.name;
        const description = tool.function.description || '无描述';
        const isChecked = selectedToolNames.includes(name);
        
        return `
            <label style="display: flex; align-items: flex-start; padding: 8px; cursor: pointer; border-bottom: 1px solid #eee;">
                <input type="checkbox" 
                       data-tool-name="${name}" 
                       ${isChecked ? 'checked' : ''}
                       style="margin-top: 2px; margin-right: 8px; flex-shrink: 0;">
                <div style="flex: 1; min-width: 0;">
                    <div style="font-weight: 500; color: #333;">${name}</div>
                    <div style="font-size: 12px; color: #666; margin-top: 2px;">${description}</div>
                </div>
            </label>
        `;
    }).join('');
    
    elements.toolsList.innerHTML = html;
    
    // 绑定复选框事件
    const checkboxes = elements.toolsList.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        cb.addEventListener('change', handleToolToggle);
    });
}

// 处理工具开关切换
function handleToolToggle(event) {
    const toolName = event.target.getAttribute('data-tool-name');
    
    if (event.target.checked) {
        if (!selectedToolNames.includes(toolName)) {
            selectedToolNames.push(toolName);
        }
    } else {
        selectedToolNames = selectedToolNames.filter(name => name !== toolName);
    }
    
    // 保存到 localStorage
    localStorage.setItem('selectedTools', JSON.stringify(selectedToolNames));
}

// 获取选中的工具名称列表
function getSelectedTools() {
    return selectedToolNames;
}

// ========== 话题标题自动生成功能 ==========

/**
 * 为话题生成标题
 * @param {string} topicId - 话题ID
 * @param {string} modelSide - 使用哪个模型生成标题 ('A' 或 'B')
 * @returns {Promise<string>} 生成的标题
 */
async function generateTopicTitle(topicId, configOrSide = 'A') {
    const topic = state.chat.topics.find(t => t.id === topicId);
    if (!topic) {
        throw new Error('话题不存在');
    }

    // 标记正在生成标题
    state.chat.generatingTitleForTopicId = topicId;
    renderTopicList();

    // 检查模型配置 - 支持传入配置对象或字符串
    const config = typeof configOrSide === 'string' ? getConfig(configOrSide) : configOrSide;
    if (!config.apiKey || !config.model) {
        throw new Error('标题生成配置不完整（需要 API Key 和模型名称）');
    }

    // 构建对话历史（最多取前6轮）
    const messages = [];
    const turns = topic.turns.filter(t => !t.isGreeting).slice(0, 3); // 取前3轮对话
    
    for (const turn of turns) {
        if (turn.prompt) {
            messages.push({
                role: 'user',
                content: turn.prompt.slice(0, 200) // 限制长度
            });
        }
        
        // 取第一个有效的助手回复
        if (turn.models.A?.content) {
            messages.push({
                role: 'assistant',
                content: turn.models.A.content.slice(0, 200)
            });
        } else if (turn.models.B?.content) {
            messages.push({
                role: 'assistant',
                content: turn.models.B.content.slice(0, 200)
            });
        }
    }

    if (messages.length === 0) {
        throw new Error('话题中没有有效的对话内容');
    }

    // 调用后端API生成标题
    const response = await fetch('/api/topics/generate-title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            provider: config.provider,
            apiKey: config.apiKey,
            model: config.model,
            apiUrl: config.apiUrl || null,
            messages: messages
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        state.chat.generatingTitleForTopicId = null;
        renderTopicList();
        throw new Error(errorData.detail || `生成失败: ${response.status}`);
    }

    const data = await response.json();
    state.chat.generatingTitleForTopicId = null;
    renderTopicList();
    return data.title || '新对话';
}

/**
 * 自动为当前话题生成标题（在发送消息后调用）
 */
async function autoGenerateTitle() {
    const topic = getActiveTopic();
    if (!topic) return;

    // 检查是否启用自动生成标题
    const saved = localStorage.getItem(STORAGE_KEYS.config);
    let autoTitleEnabled = true;
    let baseModel = 'A';
    let customModel = '';
    
    if (saved) {
        try {
            const config = JSON.parse(saved);
            if (config.autoTitle) {
                autoTitleEnabled = config.autoTitle.enabled !== false;
                baseModel = config.autoTitle.base || 'A';
                customModel = config.autoTitle.model || '';
            }
        } catch (e) {
            console.error('加载自动标题配置失败:', e);
        }
    }

    if (!autoTitleEnabled) return;

    // 只在标题为"新话题"且有实际对话时才自动生成
    if (!topic.title.startsWith('新话题')) return;

    const realTurns = topic.turns.filter(t => !t.isGreeting && t.prompt);
    if (realTurns.length < 1) return;

    // 直接从 Title 配置获取（会自动从选择的基础配置中继承）
    const titleConfig = getConfig('Title');
    if (!titleConfig.apiKey || !titleConfig.model) {
        console.warn('标题生成配置不完整，无法生成标题');
        return;
    }

    try {
        // 延迟生成标题，等待对话完成
        setTimeout(async () => {
            try {
                const title = await generateTopicTitle(topic.id, titleConfig);
                if (title && title !== '新对话') {
                    topic.title = title;
                    topic.updatedAt = Date.now();
                    scheduleSaveChat();
                    renderTopicList();
                }
            } catch (error) {
                console.warn('自动生成标题失败:', error.message);
                // 静默失败，不影响用户体验
            }
        }, 500); // 等待0.5秒后生成标题
    } catch (error) {
        console.warn('自动生成标题失败:', error.message);
    }
}


