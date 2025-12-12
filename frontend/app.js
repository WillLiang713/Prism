// 全局状态管理
const state = {
    configA: {},
    configB: {},
    isRunning: false,
    abortControllers: { A: null, B: null },
    // CORS代理配置（可选）
    corsProxy: '' // 例如: 'https://cors-anywhere.herokuapp.com/'
};

// DOM元素引用
const elements = {
    // 配置相关
    toggleConfig: document.getElementById('toggleConfig'),
    configContent: document.getElementById('configContent'),
    saveConfig: document.getElementById('saveConfig'),
    clearConfig: document.getElementById('clearConfig'),

    // 输入相关
    promptInput: document.getElementById('promptInput'),
    sendBtn: document.getElementById('sendBtn'),
    stopBtn: document.getElementById('stopBtn'),
    clearBtn: document.getElementById('clearBtn'),

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

    // 输出相关
    modelNameA: document.getElementById('modelNameA'),
    statusA: document.getElementById('statusA'),
    thinkingSectionA: document.getElementById('thinkingSectionA'),
    thinkingContentA: document.getElementById('thinkingContentA'),
    responseA: document.getElementById('responseA'),
    tokenCountA: document.getElementById('tokenCountA'),
    timeCostA: document.getElementById('timeCostA'),

    modelNameB: document.getElementById('modelNameB'),
    statusB: document.getElementById('statusB'),
    thinkingSectionB: document.getElementById('thinkingSectionB'),
    thinkingContentB: document.getElementById('thinkingContentB'),
    responseB: document.getElementById('responseB'),
    tokenCountB: document.getElementById('tokenCountB'),
    timeCostB: document.getElementById('timeCostB')
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    autoDetectProxy();
    bindEvents();
    updateModelNames();
    initMarkdown();
});

// 初始化Markdown配置
function initMarkdown() {
    if (typeof marked !== 'undefined') {
        // 配置marked选项
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
}

// 渲染Markdown内容
function renderMarkdown(side, text) {
    const element = elements[`response${side}`];

    if (typeof marked !== 'undefined') {
        // 使用marked渲染markdown
        try {
            element.innerHTML = marked.parse(text);
        } catch (e) {
            console.error('Markdown渲染失败:', e);
            element.textContent = text;
        }
    } else {
        // 如果marked未加载，使用普通文本
        element.textContent = text;
    }
}

// 自动检测并配置代理
function autoDetectProxy() {
    // 如果通过HTTP服务器访问（而不是file://协议）
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        // 自动设置代理为当前服务器
        const serverUrl = `${window.location.protocol}//${window.location.host}/`;
        state.corsProxy = serverUrl;

        console.log(`自动检测到服务器模式，代理地址: ${serverUrl}`);
    }
}

// 绑定事件
function bindEvents() {
    elements.toggleConfig.addEventListener('click', toggleConfigPanel);
    elements.saveConfig.addEventListener('click', saveConfig);
    elements.clearConfig.addEventListener('click', clearConfig);
    elements.sendBtn.addEventListener('click', sendPrompt);
    elements.stopBtn.addEventListener('click', stopGeneration);
    elements.clearBtn.addEventListener('click', clearOutputs);

    // 监听提供商变化，更新API地址提示
    elements.providerA.addEventListener('change', () => updateApiUrlPlaceholder('A'));
    elements.providerB.addEventListener('change', () => updateApiUrlPlaceholder('B'));

    // 监听模型名称变化
    elements.modelA.addEventListener('input', updateModelNames);
    elements.modelB.addEventListener('input', updateModelNames);
}

// 切换配置面板
function toggleConfigPanel() {
    const isCollapsed = elements.configContent.classList.toggle('collapsed');
    elements.toggleConfig.textContent = isCollapsed ? '展开' : '收起';
}

// 更新API地址占位符
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

// 更新模型名称显示
function updateModelNames() {
    const modelA = elements.modelA.value || '未配置';
    const modelB = elements.modelB.value || '未配置';
    elements.modelNameA.textContent = modelA;
    elements.modelNameB.textContent = modelB;
}

// 保存配置到localStorage
function saveConfig() {
    const config = {
        corsProxy: state.corsProxy,
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

    localStorage.setItem('aiPkConfig', JSON.stringify(config));
    alert('配置已保存');
}

// 从localStorage加载配置
function loadConfig() {
    const saved = localStorage.getItem('aiPkConfig');
    if (!saved) return;

    try {
        const config = JSON.parse(saved);

        // 加载CORS代理配置
        if (config.corsProxy !== undefined) {
            state.corsProxy = config.corsProxy;
        }

        // 加载模型A配置
        if (config.A) {
            elements.providerA.value = config.A.provider || 'openai';
            elements.apiKeyA.value = config.A.apiKey || '';
            elements.modelA.value = config.A.model || '';
            elements.apiUrlA.value = config.A.apiUrl || '';
            elements.systemPromptA.value = config.A.systemPrompt || '';
            elements.thinkingA.checked = config.A.thinking || false;
        }

        // 加载模型B配置
        if (config.B) {
            elements.providerB.value = config.B.provider || 'openai';
            elements.apiKeyB.value = config.B.apiKey || '';
            elements.modelB.value = config.B.model || '';
            elements.apiUrlB.value = config.B.apiUrl || '';
            elements.systemPromptB.value = config.B.systemPrompt || '';
            elements.thinkingB.checked = config.B.thinking || false;
        }

        updateModelNames();
    } catch (e) {
        console.error('加载配置失败:', e);
    }
}

// 清除配置
function clearConfig() {
    if (!confirm('确定要清除所有配置吗？')) return;

    localStorage.removeItem('aiPkConfig');

    // 重置CORS代理
    state.corsProxy = '';

    // 重置表单
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

// 清空输出
function clearOutputs() {
    ['A', 'B'].forEach(side => {
        elements[`response${side}`].textContent = '';
        elements[`thinkingContent${side}`].textContent = '';
        elements[`thinkingSection${side}`].style.display = 'none';
        elements[`tokenCount${side}`].textContent = '0 tokens';
        elements[`timeCost${side}`].textContent = '0ms';
        updateStatus(side, 'ready', '就绪');
    });
}

// 更新状态显示
function updateStatus(side, statusClass, statusText) {
    const statusEl = elements[`status${side}`];
    statusEl.className = `status ${statusClass}`;
    statusEl.textContent = statusText;
}

// 发送提示词
async function sendPrompt() {
    const prompt = elements.promptInput.value.trim();
    if (!prompt) {
        alert('请输入提示词');
        return;
    }

    // 验证配置
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

    // 清空之前的输出
    clearOutputs();

    // 更新UI状态
    state.isRunning = true;
    elements.sendBtn.disabled = true;
    elements.stopBtn.disabled = false;

    // 同时调用两个模型
    const startTime = Date.now();

    Promise.all([
        callModel('A', prompt, configA, startTime),
        callModel('B', prompt, configB, startTime)
    ]).finally(() => {
        state.isRunning = false;
        elements.sendBtn.disabled = false;
        elements.stopBtn.disabled = true;
    });
}

// 停止生成
function stopGeneration() {
    ['A', 'B'].forEach(side => {
        if (state.abortControllers[side]) {
            state.abortControllers[side].abort();
            state.abortControllers[side] = null;
            updateStatus(side, 'ready', '已停止');
        }
    });

    state.isRunning = false;
    elements.sendBtn.disabled = false;
    elements.stopBtn.disabled = true;
}

// 获取配置
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

// 调用模型API
async function callModel(side, prompt, config, startTime) {
    updateStatus(side, 'loading', '生成中...');

    // 创建AbortController用于取消请求
    const abortController = new AbortController();
    state.abortControllers[side] = abortController;

    try {
        // 根据提供商构建请求
        const { url, headers, body } = buildRequest(config, prompt);

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: abortController.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // 处理流式响应
        await handleStreamResponse(side, response, config, startTime);

        updateStatus(side, 'complete', '完成');
    } catch (error) {
        if (error.name === 'AbortError') {
            updateStatus(side, 'ready', '已停止');
        } else {
            console.error(`模型${side}错误:`, error);
            updateStatus(side, 'error', '错误');
            elements[`response${side}`].textContent = `错误: ${error.message}`;
        }
    } finally {
        state.abortControllers[side] = null;
    }
}

// 构建API请求
function buildRequest(config, prompt) {
    const { provider, apiKey, model, apiUrl, systemPrompt, thinking } = config;

    // 确定API地址
    let url = apiUrl;

    // 如果用户填入了自定义API地址，优先使用
    if (!url) {
        // 没有自定义地址时，使用默认地址
        url = provider === 'anthropic'
            ? 'https://api.anthropic.com/v1/messages'
            : 'https://api.openai.com/v1/chat/completions';
    }

    // 如果配置了CORS代理，添加代理前缀
    if (state.corsProxy) {
        url = state.corsProxy + url;
    }

    // 构建请求头
    const headers = {
        'Content-Type': 'application/json'
    };

    if (provider === 'anthropic') {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
    } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    // 构建请求体
    let body;
    if (provider === 'anthropic') {
        body = {
            model: model,
            messages: [{ role: 'user', content: prompt }],
            stream: true,
            max_tokens: 4096
        };

        // 添加系统提示词（Anthropic格式）
        if (systemPrompt && systemPrompt.trim()) {
            body.system = systemPrompt.trim();
        }

        // 如果启用思考模式，添加thinking参数
        if (thinking) {
            body.thinking = {
                type: 'enabled',
                budget_tokens: 2000
            };
        }
    } else {
        // OpenAI格式
        const messages = [];

        // 添加系统提示词（OpenAI格式）
        if (systemPrompt && systemPrompt.trim()) {
            messages.push({ role: 'system', content: systemPrompt.trim() });
        }

        // 添加用户消息
        messages.push({ role: 'user', content: prompt });

        body = {
            model: model,
            messages: messages,
            stream: true
        };

        // OpenAI的思考模式（如果支持）
        if (thinking && model.includes('o1')) {
            // o1系列模型的特殊处理
            body.reasoning_effort = 'high';
        }
    }

    return { url, headers, body };
}

// 处理流式响应
async function handleStreamResponse(side, response, config, startTime) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = '';
    let thinkingText = '';
    let responseText = '';
    let tokenCount = 0;
    let chunkCount = 0;

    console.log(`[${side}] 开始处理流式响应`);

    // 显示思考区域（如果启用）
    if (config.thinking) {
        elements[`thinkingSection${side}`].style.display = 'block';
    }

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            console.log(`[${side}] 流式响应结束，共收到 ${chunkCount} 个数据块`);
            break;
        }

        chunkCount++;
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        if (chunkCount <= 3) {
            console.log(`[${side}] 收到数据块 ${chunkCount}:`, chunk.substring(0, 100));
        }

        // 按行处理SSE数据
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留不完整的行

        for (const line of lines) {
            if (!line.trim() || line.startsWith(':')) continue;

            if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;

                try {
                    const json = JSON.parse(data);

                    // 根据提供商解析响应
                    if (config.provider === 'anthropic') {
                        const result = parseAnthropicChunk(json);
                        if (result.thinking) {
                            thinkingText += result.thinking;
                            elements[`thinkingContent${side}`].textContent = thinkingText;
                        }
                        if (result.content) {
                            responseText += result.content;
                            renderMarkdown(side, responseText);
                        }
                        if (result.tokens) {
                            tokenCount = result.tokens;
                        }
                    } else {
                        // OpenAI格式
                        const result = parseOpenAIChunk(json);
                        if (result.content) {
                            responseText += result.content;
                            renderMarkdown(side, responseText);
                        }
                        if (result.tokens) {
                            tokenCount = result.tokens;
                        }
                    }

                    // 更新统计信息
                    const elapsed = Date.now() - startTime;
                    elements[`tokenCount${side}`].textContent = `${tokenCount} tokens`;
                    elements[`timeCost${side}`].textContent = `${elapsed}ms`;

                } catch (e) {
                    console.error('解析JSON失败:', e, data);
                }
            }
        }
    }
}

// 解析Anthropic响应块
function parseAnthropicChunk(chunk) {
    const result = { thinking: '', content: '', tokens: 0 };

    if (chunk.type === 'content_block_delta') {
        const delta = chunk.delta;
        if (delta.type === 'thinking_delta') {
            result.thinking = delta.thinking || '';
        } else if (delta.type === 'text_delta') {
            result.content = delta.text || '';
        }
    } else if (chunk.type === 'message_delta') {
        if (chunk.usage) {
            result.tokens = chunk.usage.output_tokens || 0;
        }
    }

    return result;
}

// 解析OpenAI响应块
function parseOpenAIChunk(chunk) {
    const result = { content: '', tokens: 0 };

    if (chunk.choices && chunk.choices[0]) {
        const delta = chunk.choices[0].delta;
        if (delta.content) {
            result.content = delta.content;
        }
    }

    if (chunk.usage) {
        result.tokens = chunk.usage.completion_tokens || 0;
    }

    return result;
}
