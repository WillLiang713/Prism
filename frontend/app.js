const STORAGE_KEYS = {
    config: 'aiPkConfig',
    topics: 'aiPkTopicsV1',
    activeTopicId: 'aiPkActiveTopicId'
};

const state = {
    isRunning: false,
    abortControllers: { A: null, B: null },
    chat: {
        topics: [],
        activeTopicId: null,
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

    // 输入相关
    promptInput: document.getElementById('promptInput'),
    sendBtn: document.getElementById('sendBtn'),

    // 话题/历史
    newTopicBtn: document.getElementById('newTopicBtn'),
    deleteTopicBtn: document.getElementById('deleteTopicBtn'),
    topicList: document.getElementById('topicList'),
    historyList: document.getElementById('historyList'),
    chatMessages: document.getElementById('chatMessages'),

    // 模型A配置
    providerA: document.getElementById('providerA'),
    apiKeyA: document.getElementById('apiKeyA'),
    modelA: document.getElementById('modelA'),
    apiUrlA: document.getElementById('apiUrlA'),
    systemPromptA: document.getElementById('systemPromptA'),
    thinkingA: document.getElementById('thinkingA'),

    // 模型B配置
    providerB: document.getElementById('providerB'),
    apiKeyB: document.getElementById('apiKeyB'),
    modelB: document.getElementById('modelB'),
    apiUrlB: document.getElementById('apiUrlB'),
    systemPromptB: document.getElementById('systemPromptB'),
    thinkingB: document.getElementById('thinkingB'),

    // 头部状态
    modelNameA: document.getElementById('modelNameA'),
    modelNameB: document.getElementById('modelNameB'),
    statusA: document.getElementById('statusA'),
    statusB: document.getElementById('statusB'),
    tokenCountA: document.getElementById('tokenCountA'),
    tokenCountB: document.getElementById('tokenCountB'),
    timeCostA: document.getElementById('timeCostA'),
    timeCostB: document.getElementById('timeCostB')
};

document.addEventListener('DOMContentLoaded', () => {
    initMarkdown();
    loadConfig();
    initChat();
    bindEvents();
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
            return;
        } catch (e) {
            console.error('Markdown渲染失败:', e);
        }
    }
    element.textContent = text || '';
}

function getProxyPrefix() {
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        return `${window.location.protocol}//${window.location.host}/`;
    }
    return '';
}

function bindEvents() {
    elements.saveConfig.addEventListener('click', saveConfig);
    elements.clearConfig.addEventListener('click', clearConfig);

    elements.openConfigBtn?.addEventListener('click', openConfigModal);
    elements.closeConfigBtn?.addEventListener('click', closeConfigModal);
    elements.configModal?.addEventListener('click', (e) => {
        if (e.target === elements.configModal) closeConfigModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeConfigModal();
    });

    elements.sendBtn.addEventListener('click', onSendButtonClick);

    elements.newTopicBtn.addEventListener('click', () => {
        if (state.isRunning && !confirm('正在生成中，仍要新建话题并停止当前生成吗？')) return;
        if (state.isRunning) stopGeneration();
        const topic = createTopic();
        setActiveTopic(topic.id);
        renderAll();
        elements.promptInput.focus();
    });

    elements.deleteTopicBtn.addEventListener('click', () => {
        const topic = getActiveTopic();
        if (!topic) return;
        if (state.isRunning && !confirm('正在生成中，仍要删除话题并停止当前生成吗？')) return;
        if (!confirm(`确定要删除话题「${topic.title}」吗？此操作不可恢复。`)) return;
        if (state.isRunning) stopGeneration();
        deleteTopic(topic.id);
        renderAll();
    });

    // 监听提供商变化，更新API地址提示
    elements.providerA.addEventListener('change', () => updateApiUrlPlaceholder('A'));
    elements.providerB.addEventListener('change', () => updateApiUrlPlaceholder('B'));

    // 监听模型名称变化
    elements.modelA.addEventListener('input', updateModelNames);
    elements.modelB.addEventListener('input', updateModelNames);

    // Enter 发送（Shift+Enter 换行）
    elements.promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            if (!state.isRunning) sendPrompt();
        }
    });

    elements.promptInput.addEventListener('input', autoGrowPromptInput);
}

function openConfigModal() {
    if (!elements.configModal) return;
    elements.configModal.classList.add('open');
    elements.configModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closeConfigModal() {
    if (!elements.configModal) return;
    elements.configModal.classList.remove('open');
    elements.configModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
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

function updateApiUrlPlaceholder(side) {
    const provider = elements[`provider${side}`].value;
    const urlInput = elements[`apiUrl${side}`];
    const placeholders = {
        openai: 'https://api.openai.com/v1/chat/completions',
        anthropic: 'https://api.anthropic.com/v1/messages',
        custom: '输入自定义API地址'
    };
    urlInput.placeholder = placeholders[provider] || '';
}

function updateModelNames() {
    const modelA = elements.modelA.value || '未配置';
    const modelB = elements.modelB.value || '未配置';
    elements.modelNameA.textContent = modelA;
    elements.modelNameB.textContent = modelB;
}

function saveConfig() {
    const config = {
        A: {
            provider: elements.providerA.value,
            apiKey: elements.apiKeyA.value,
            model: elements.modelA.value,
            apiUrl: elements.apiUrlA.value,
            systemPrompt: elements.systemPromptA.value,
            thinking: elements.thinkingA.checked
        },
        B: {
            provider: elements.providerB.value,
            apiKey: elements.apiKeyB.value,
            model: elements.modelB.value,
            apiUrl: elements.apiUrlB.value,
            systemPrompt: elements.systemPromptB.value,
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
        if (config.A) {
            elements.providerA.value = config.A.provider || 'openai';
            elements.apiKeyA.value = config.A.apiKey || '';
            elements.modelA.value = config.A.model || '';
            elements.apiUrlA.value = config.A.apiUrl || '';
            elements.systemPromptA.value = config.A.systemPrompt || '';
            elements.thinkingA.checked = !!config.A.thinking;
        }
        if (config.B) {
            elements.providerB.value = config.B.provider || 'openai';
            elements.apiKeyB.value = config.B.apiKey || '';
            elements.modelB.value = config.B.model || '';
            elements.apiUrlB.value = config.B.apiUrl || '';
            elements.systemPromptB.value = config.B.systemPrompt || '';
            elements.thinkingB.checked = !!config.B.thinking;
        }
    } catch (e) {
        console.error('加载配置失败:', e);
    }
}

function clearConfig() {
    if (!confirm('确定要清除所有配置吗？')) return;
    localStorage.removeItem(STORAGE_KEYS.config);

    ['A', 'B'].forEach(side => {
        elements[`provider${side}`].value = 'openai';
        elements[`apiKey${side}`].value = '';
        elements[`model${side}`].value = '';
        elements[`apiUrl${side}`].value = '';
        elements[`systemPrompt${side}`].value = '';
        elements[`thinking${side}`].checked = false;
    });

    updateModelNames();
    alert('配置已清除');
}

function getConfig(side) {
    return {
        provider: elements[`provider${side}`].value,
        apiKey: elements[`apiKey${side}`].value,
        model: elements[`model${side}`].value,
        apiUrl: elements[`apiUrl${side}`].value,
        systemPrompt: elements[`systemPrompt${side}`].value,
        thinking: elements[`thinking${side}`].checked
    };
}

function initChat() {
    const topicsRaw = localStorage.getItem(STORAGE_KEYS.topics);
    const activeRaw = localStorage.getItem(STORAGE_KEYS.activeTopicId);

    if (topicsRaw) {
        try {
            const parsed = JSON.parse(topicsRaw);
            if (Array.isArray(parsed)) state.chat.topics = parsed;
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
    const idx = state.chat.topics.length + 1;
    const now = Date.now();
    const topic = {
        id: createId(),
        title: `新话题 ${idx}`,
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
    elements.topicList.innerHTML = '';

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

        item.appendChild(title);
        item.appendChild(meta);

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

function isNearBottom(container, thresholdPx = 120) {
    if (!container) return true;
    const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
    return remaining <= thresholdPx;
}

function scrollToBottom(container) {
    if (!container) return;
    container.scrollTop = container.scrollHeight;
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
    scrollToBottom(elements.chatMessages);
}

function createTurnElement(turn) {
    const turnEl = document.createElement('div');
    turnEl.className = 'turn';
    turnEl.dataset.turnId = turn.id;

    const userBubble = document.createElement('div');
    userBubble.className = 'user-bubble';
    userBubble.textContent = turn.prompt || '';

    const assistants = document.createElement('div');
    assistants.className = 'turn-assistants';

    const aCard = createAssistantCard('A', turn);
    const bCard = createAssistantCard('B', turn);
    assistants.appendChild(aCard.el);
    assistants.appendChild(bCard.el);

    turnEl.appendChild(userBubble);
    turnEl.appendChild(assistants);

    return { el: turnEl, cards: { A: aCard, B: bCard } };
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

    const badge = document.createElement('span');
    badge.className = 'model-badge';
    badge.textContent = side;

    const modelName = document.createElement('span');
    modelName.className = 'model-name';
    modelName.textContent = modelSnapshot || (side === 'A' ? (elements.modelNameA.textContent || '未配置') : (elements.modelNameB.textContent || '未配置'));

    const statusEl = document.createElement('span');
    statusEl.className = 'status';
    applyStatus(statusEl, statusSnapshot);

    header.appendChild(badge);
    header.appendChild(modelName);
    header.appendChild(statusEl);

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
    thinkingHeader.addEventListener('click', () => thinkingSection.classList.toggle('collapsed'));

    const thinkingContent = document.createElement('div');
    thinkingContent.className = 'thinking-content';
    thinkingContent.textContent = thinkingSnapshot || '';

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
        timeEl
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

    if (!configA.apiKey || !configA.model) {
        alert('请先配置模型A');
        return;
    }
    if (!configB.apiKey || !configB.model) {
        alert('请先配置模型B');
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
        models: {
            A: { provider: configA.provider, model: configA.model, thinking: '', content: '', tokens: null, timeCostSec: null, status: 'loading' },
            B: { provider: configB.provider, model: configB.model, thinking: '', content: '', tokens: null, timeCostSec: null, status: 'loading' }
        }
    };

    topic.turns = Array.isArray(topic.turns) ? topic.turns : [];
    topic.turns.push(turn);
    topic.updatedAt = now;

    if ((topic.title || '').startsWith('新话题') && topic.turns.length === 1) {
        const t = prompt.slice(0, 18).trim();
        if (t) topic.title = t;
    }

    scheduleSaveChat();

    const nearBottom = isNearBottom(elements.chatMessages);
    const createdEls = createTurnElement(turn);
    elements.chatMessages.appendChild(createdEls.el);
    renderTopicList();
    renderHistoryList();
    if (nearBottom) scrollToBottom(elements.chatMessages);

    elements.promptInput.value = '';
    autoGrowPromptInput();
    elements.promptInput.focus();

    setHeaderStatus('A', 'loading');
    setHeaderStatus('B', 'loading');
    setHeaderTokens('A', 0);
    setHeaderTokens('B', 0);
    setHeaderTime('A', 0);
    setHeaderTime('B', 0);
    setSendButtonMode('stop');

    state.isRunning = true;
    // 发送/停止合并：生成中保持按钮可点击，用于停止

    const startA = Date.now();
    const startB = Date.now();

    await Promise.allSettled([
        callModel('A', prompt, configA, turn, createdEls.cards.A, startA),
        callModel('B', prompt, configB, turn, createdEls.cards.B, startB)
    ]);

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
        }
        setHeaderStatus(side, 'stopped');
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
        const { url, headers, body } = buildRequest(config, prompt);
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: abortController.signal
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

        await handleStreamResponse(side, response, config, {
            onThinkingDelta: (delta) => {
                if (!delta) return;
                turn.models[side].thinking += delta;
                ui.thinkingSectionEl.style.display = 'block';
                ui.thinkingSectionEl.classList.remove('collapsed');
                ui.thinkingContentEl.textContent = turn.models[side].thinking;
                scheduleSaveChat();
            },
            onContentDelta: (delta) => {
                if (!delta) return;
                const nearBottom = isNearBottom(elements.chatMessages);
                turn.models[side].content += delta;
                renderMarkdownToElement(ui.responseEl, turn.models[side].content);
                const tokens = estimateTokensFromText(turn.models[side].content);
                ui.tokenEl.textContent = `${tokens} tokens`;
                setHeaderTokens(side, tokens);
                scheduleSaveChat();
                if (nearBottom) scrollToBottom(elements.chatMessages);
            },
            onTokens: (tokens) => {
                if (!Number.isFinite(tokens) || tokens < 0) return;
                turn.models[side].tokens = tokens;
                ui.tokenEl.textContent = `${tokens} tokens`;
                setHeaderTokens(side, tokens);
                scheduleSaveChat();
            }
        });

        updateTime();
        turn.models[side].status = 'complete';
        applyStatus(ui.statusEl, 'complete');
        setHeaderStatus(side, 'complete');

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
        state.abortControllers[side] = null;
    }
}

function buildRequest(config, prompt) {
    const { provider, apiKey, model, apiUrl, systemPrompt, thinking } = config;

    let url = apiUrl;
    if (!url) {
        url = provider === 'anthropic'
            ? 'https://api.anthropic.com/v1/messages'
            : 'https://api.openai.com/v1/chat/completions';
    }

    const proxyPrefix = getProxyPrefix();
    const isAbsoluteUrl = url.startsWith('http://') || url.startsWith('https://');
    if (proxyPrefix && isAbsoluteUrl && !url.startsWith(proxyPrefix)) url = proxyPrefix + url;

    const headers = { 'Content-Type': 'application/json' };
    if (provider === 'anthropic') {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
    } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    let body;
    if (provider === 'anthropic') {
        body = {
            model,
            messages: [{ role: 'user', content: prompt }],
            stream: true,
            max_tokens: 4096
        };
        if (systemPrompt && systemPrompt.trim()) body.system = systemPrompt.trim();
        if (thinking) body.thinking = { type: 'enabled', budget_tokens: 2000 };
    } else {
        const messages = [];
        if (systemPrompt && systemPrompt.trim()) messages.push({ role: 'system', content: systemPrompt.trim() });
        messages.push({ role: 'user', content: prompt });
        body = { model, messages, stream: true };

        const modelLower = (model || '').toLowerCase();
        body.stream_options = body.stream_options || { include_usage: true };
        if (thinking && modelLower.includes('o1')) body.reasoning_effort = 'high';
        if (thinking && modelLower.includes('qwen')) body.enable_thinking = true;
        if (thinking && modelLower.includes('deepseek')) body.thinking = { type: 'enabled' };
    }

    return { url, headers, body };
}

async function handleStreamResponse(side, response, config, handlers) {
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

            let json;
            try {
                json = JSON.parse(data);
            } catch (e) {
                console.error(`[${side}] 解析JSON失败:`, e, data);
                continue;
            }

            if (config.provider === 'anthropic') {
                const result = parseAnthropicChunk(json);
                if (result.thinking) handlers?.onThinkingDelta?.(result.thinking);
                if (result.content) handlers?.onContentDelta?.(result.content);
                if (Number.isFinite(result.tokens) && result.tokens >= 0) handlers?.onTokens?.(result.tokens);
            } else {
                const result = parseOpenAIChunk(json);
                if (result.thinking) handlers?.onThinkingDelta?.(result.thinking);
                if (result.content) handlers?.onContentDelta?.(result.content);
                if (Number.isFinite(result.tokens) && result.tokens >= 0) handlers?.onTokens?.(result.tokens);
            }
        }
    }
}

function parseAnthropicChunk(chunk) {
    const result = { thinking: '', content: '', tokens: null };
    if (chunk.type === 'content_block_delta') {
        const delta = chunk.delta;
        if (delta.type === 'thinking_delta') result.thinking = delta.thinking || '';
        else if (delta.type === 'text_delta') result.content = delta.text || '';
    } else if (chunk.type === 'message_delta') {
        if (chunk.usage) result.tokens = chunk.usage.output_tokens || 0;
    }
    return result;
}

function parseOpenAIChunk(chunk) {
    const result = { thinking: '', content: '', tokens: null };

    if (chunk.choices && chunk.choices[0]) {
        const delta = chunk.choices[0].delta;
        if (delta && typeof delta === 'object') {
            if (typeof delta.reasoning_content === 'string') result.thinking = delta.reasoning_content;
            else if (typeof delta.thinking === 'string') result.thinking = delta.thinking;
            else if (typeof delta.reasoning === 'string') result.thinking = delta.reasoning;
        }
        if (delta?.content) result.content = delta.content;
    }

    if (chunk.usage) {
        result.tokens =
            chunk.usage.completion_tokens ||
            chunk.usage.output_tokens ||
            chunk.usage.total_tokens ||
            0;
    }

    return result;
}
