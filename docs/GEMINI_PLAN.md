# Gemini 提供商集成方案

## 背景

Prism 目前支持 OpenAI 和 Anthropic 两种提供商。用户希望新增 Google Gemini 作为第三个提供商，包括：
1. Gemini API 的端点适配（消息格式、流式响应、认证方式等）
2. 现有工具（Tavily/Exa 搜索、获取时间）通过 Gemini 的 function calling 格式正常工作
3. Gemini 内置工具支持（Google Search 联网搜索）

## Gemini API 与现有提供商的关键差异

| 维度 | OpenAI | Anthropic | **Gemini** |
|------|--------|-----------|------------|
| 端点 | 固定 URL | 固定 URL | **模型名嵌入 URL 路径** |
| 认证 | `Authorization: Bearer {key}` | `x-api-key: {key}` | **`x-goog-api-key: {key}`** |
| 角色名 | assistant | assistant | **model** |
| 消息格式 | `{role, content}` | `{role, content}` | **`{role, parts: [{text}]}`** |
| 系统提示 | messages 中 role=system | body.system | **body.system_instruction** |
| 图片格式 | image_url | base64 source | **inlineData** |
| 工具定义 | `{type:"function", function:{...}}` | - | **`{functionDeclarations:[{...}]}`** |
| 工具调用 | delta.tool_calls | - | **parts[].functionCall** |
| 工具结果 | role=tool + tool_call_id | - | **role=user + functionResponse** |
| 流式格式 | `data: {choices:[{delta}]}` | `data: {type, delta}` | **`data: {candidates:[{content:{parts}}]}`** |

---

## 实现步骤

### 第一步：后端核心 - ProviderConfig 增加 Gemini

**文件：`ai_service.py` 第 90-162 行**

1. `DEFAULT_URLS` 增加 gemini 默认地址：
   ```python
   "gemini": "https://generativelanguage.googleapis.com/v1beta"
   ```

2. `get_provider_mode()` 增加 gemini 识别：
   ```python
   if provider == "gemini": return "gemini"
   elif provider == "anthropic": return "anthropic"
   else: return "openai"
   ```

3. `get_api_url()` 对 Gemini 特殊处理：
   - Gemini 的 URL 需要在路径中嵌入模型名，格式为 `/models/{model}:streamGenerateContent?alt=sse`
   - 新增参数 `model` 用于 Gemini 拼接 URL
   - 对于用户自定义 URL（代理），只保留 base 部分，自动拼接 `/models/{model}:streamGenerateContent?alt=sse`

4. `build_headers()` 增加 Gemini 认证：
   ```python
   if provider_mode == "gemini":
       headers["x-goog-api-key"] = api_key
   ```

### 第二步：后端核心 - MessageBuilder 增加 Gemini 消息构建

**文件：`ai_service.py` MessageBuilder 类**

1. 新增 `_build_gemini_body()` 方法，处理：
   - `contents` 格式：`[{role: "user"/"model", parts: [{text: "..."}]}]`
   - `system_instruction`：`{parts: [{text: "..."}]}`（替代 OpenAI 的 role=system）
   - 思考模式：`generationConfig.thinkingConfig.thinkingBudget`（映射现有 reasoningEffort）
   - 工具定义转换（见第三步）
   - Gemini 内置工具（见第六步）

2. 新增 `_build_gemini_user_content()` 处理多模态：
   - 纯文本：`[{text: "..."}]`
   - 图片：`[{text: "..."}, {inlineData: {mimeType: "image/png", data: "base64..."}}]`

3. `convert_history_to_messages()` 增加 Gemini 分支：
   - role 从 `assistant` 改为 `model`
   - content 从字符串改为 `parts` 数组格式

4. `build_request_body()` 增加 gemini 分支调用 `_build_gemini_body()`

### 第三步：后端核心 - 工具定义格式转换

**文件：`ai_service.py` MessageBuilder 类**

新增 `_convert_tools_to_gemini()` 静态方法，将 `tools.json` 中的 OpenAI 格式转为 Gemini 格式：

```
# OpenAI 格式（tools.json）
[{"type": "function", "function": {"name": "...", "description": "...", "parameters": {...}}}]

# 转换为 Gemini 格式
[{"functionDeclarations": [{"name": "...", "description": "...", "parameters": {...}}]}]
```

### 第四步：后端核心 - StreamParser 增加 Gemini 解析

**文件：`ai_service.py` StreamParser 类**

新增 `parse_gemini_chunk()` 方法，解析 Gemini 的流式响应块：

- **文本内容**：`candidates[0].content.parts[].text`
- **思考内容**：`candidates[0].content.parts[]` 中 `thought: true` 的 text
- **工具调用**：`candidates[0].content.parts[].functionCall` → `{name, args}`
- **Token 统计**：`usageMetadata.totalTokenCount` 或 `candidatesTokenCount`
- **Google Search 结果**：`candidates[0].groundingMetadata`（搜索来源、查询词）
返回统一格式的 dict（与 OpenAI/Anthropic 解析器一致）。

### 第五步：后端核心 - chat_stream() 增加 Gemini 流式处理

**文件：`ai_service.py` AIService.chat_stream()**

1. **首轮请求**：与 OpenAI/Anthropic 类似，但使用 Gemini URL 和请求格式

2. **流式解析**：调用 `StreamParser.parse_gemini_chunk()`

3. **工具调用循环**：Gemini 的多轮工具调用与 OpenAI 不同：
   - 模型返回 `functionCall` → 执行工具 → 构建下一轮消息
   - 下一轮消息格式：在 `contents` 中追加 model 的 functionCall 消息和 user 的 functionResponse 消息
   - `functionResponse` 格式：`{role: "user", parts: [{functionResponse: {name, response: {content: result}}}]}`

4. **Google Search grounding 结果提取**：
   - 从 `groundingMetadata.groundingChunks` 提取来源链接
   - 转换为现有的 `sources` 和 `web_search` 事件格式发送到前端
   - 从 `groundingMetadata.webSearchQueries` 提取搜索查询词

### 第六步：ChatRequest 数据模型扩展

**文件：`ai_service.py` ChatRequest 类**

新增字段：
```python
enableGoogleSearch: bool = False      # 启用 Gemini 内置 Google Search
```

### 第七步：后端 - server.py 适配

**文件：`server.py`**

1. **模型列表接口** (`list_models`)：
   - Gemini 模型列表 URL：`{base}/models`（不是 `{base}/v1/models`）
   - 认证头：`x-goog-api-key: {key}`
   - 响应解析：从 `models[]` 数组中提取 `name` 字段，去掉 `models/` 前缀
   - `build_models_base_url()` 对 Gemini 特殊处理

2. **生成标题接口** (`generate_topic_title`)：
   - Gemini 请求格式：contents + system_instruction
   - Gemini 非流式响应：`candidates[0].content.parts[0].text`
   - URL 格式：`{base}/models/{model}:generateContent`
   - 认证头：`x-goog-api-key`

### 第八步：前端 - HTML 增加 Gemini 选项

**文件：`frontend/index.html`**

1. 提供商选择器增加：
   ```html
   <option value="gemini">Google Gemini</option>
   ```

2. 联网服务选择器增加（仅 Gemini 可见）：
   ```html
   <option value="gemini_search">Google Search（Gemini 内置）</option>
   ```

### 第九步：前端 - app.js 适配

**文件：`frontend/app.js`**

1. `getProviderMode()` 增加：`provider === "gemini" ? "gemini" : ...`

2. `updateProviderUi()` 增加 Gemini 提示文本

3. `updateApiUrlPlaceholder()` 增加：
   ```javascript
   gemini: "https://generativelanguage.googleapis.com/v1beta"
   ```

4. `normalizeBaseUrlForModels()` 对 Gemini 特殊处理：
   - Gemini URL 不包含 `/v1/chat/completions` 或 `/v1/messages`
   - 提取 base URL（去除 `/models/xxx:generateContent` 后缀）

5. 提供商切换时动态显隐 Gemini 专属控件：
   - 当 provider=gemini 时，显示 Google Search 内置联网选项
   - 当 provider 不是 gemini 时，隐藏该控件，并自动切回 tavily/exa

6. `sendPrompt()` 请求体增加 Gemini 内置工具字段：
   ```javascript
   enableGoogleSearch: provider === "gemini" && webSearchProvider === "gemini_search" && enableWebSearch,
   ```

---

## 需要修改的文件清单

| 文件 | 改动内容 |
|------|---------|
| `ai_service.py` | ProviderConfig + MessageBuilder + StreamParser + chat_stream |
| `server.py` | list_models + generate_topic_title + build_models_base_url |
| `frontend/index.html` | 提供商选项 + 联网服务选项 |
| `frontend/app.js` | providerMode + URL 处理 + UI 切换 + 请求体 + 响应解析 + 渲染 |

## 不需要改动的文件

- `tools.json` - 格式不变，转换逻辑在 Python 代码中
- `tools.py` - 工具执行逻辑不变
- `src-tauri/` - CSP 不需要改（前端通过 localhost 后端转发请求，不直接访问 Gemini API）

## 验证方案

1. **基础对话测试**：选择 Gemini 提供商，输入 API Key，发送普通文本消息，验证流式响应正常
2. **多模态测试**：上传图片并提问，验证图片被正确发送和识别
3. **模型列表测试**：验证可以自动获取 Gemini 可用模型列表
4. **现有工具测试**：开启联网（Tavily/Exa），验证 Gemini 能正确调用搜索工具并返回结果
5. **Google Search 测试**：选择"Google Search（Gemini 内置）"，验证联网搜索和来源展示
6. **思考模式测试**：调整思考强度，验证 Gemini 2.5 模型的思考内容正常展示
7. **历史对话测试**：验证多轮对话历史正确传递给 Gemini
8. **标题生成测试**：验证对话标题自动生成功能在 Gemini 下正常工作
