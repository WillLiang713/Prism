# Responses 端点与内置网页搜索集成方案

## 背景

Prism 当前已经具备以下能力：

1. 后端支持 OpenAI 兼容与 Anthropic 兼容的流式聊天。
2. 现有主链路基于 `chat/completions` 与 `messages` 端点构建。
3. 前端已经具备工具调用展示、联网搜索卡片展示、来源列表展示。
4. 本地工具层已经支持 `tavily_search`、`exa_search`、`get_current_time`。

本次目标不是简单替换 URL，而是新增一条基于 OpenAI `Responses API` 的完整链路，并让它能够使用 OpenAI 内置网页搜索工具，同时尽量复用现有前端展示层，避免推翻现有 `chat/completions` 方案。

---

## 当前仓库现状

### 后端现状

- 路由入口：
  - `routes/chat.py` 提供 `/api/chat/stream`
  - `routes/models.py` 提供 `/api/models/list`
- 核心服务：
  - `ai/chat_service.py` 负责主流式请求、工具调用循环、SSE 转发
  - `ai/providers.py` 负责 provider 模式识别、请求头构建、请求体构建
  - `ai/stream_parser.py` 负责 OpenAI/Anthropic SSE 解析，以及搜索来源抽取
- 数据模型：
  - `ai/models.py` 中的 `ChatRequest` 目前围绕 `chat/completions` 设计

### 前端现状

- `frontend/js/conversation.js` 当前固定调用 `/api/chat/stream`
- `frontend/js/web-search.js` 已具备以下能力：
  - 渲染联网搜索卡片
  - 把搜索事件挂接到工具事件中
  - 渲染来源状态、来源面板
- 前端目前已经认识的流式 chunk 类型包括：
  - `thinking`
  - `content`
  - `tokens`
  - `tool`
  - `sources`
  - `web_search`
  - `error`

### 结论

前端已经有一套稳定的“标准展示协议”，所以新增 `Responses API` 时，最稳妥的方式不是让前端直接理解 OpenAI 原始事件，而是在后端增加一层“协议转换”，把 `Responses API` 的流式事件转换为前端已经支持的标准 chunk。

---

## Responses API 与现有链路的关键差异

| 维度 | 现有 OpenAI 兼容链路 | Responses API |
|------|----------------------|---------------|
| 端点 | `/v1/chat/completions` | `/v1/responses` |
| 输入结构 | `messages` | `input` |
| 输出流事件 | `choices[].delta` | 独立事件流，如文本增量、工具事件、完成事件 |
| 工具调用 | `tools` + `tool_calls` | `tools` + `response.output[*]` / streaming events |
| 内置网页搜索 | 依赖本地 Tavily/Exa 工具 | 使用 OpenAI 内置 `web_search_preview` |
| 前端兼容性 | 已完整支持 | 需要后端做协议映射 |

### 关键判断

`Responses API` 不适合直接塞进现有 `/api/chat/stream` 逻辑中混写。更合适的方案是：

1. 新增独立后端路由，例如 `/api/responses/stream`
2. 新增独立服务入口，例如 `AIService.responses_stream()`
3. 前端通过配置选择使用旧链路还是新链路
4. 两条链路最终都输出同一种前端 chunk 格式

---

## 总体实施思路

### 核心原则

1. 保留现有 `/api/chat/stream` 不动，避免引入回归。
2. 新增 `Responses API` 独立链路，逐步接入。
3. 前端尽量只增加“端点模式切换”和少量请求参数分流。
4. 搜索展示层复用现有 `web_search` / `sources` 事件，不重写 UI。
5. 第一阶段优先支持 OpenAI 官方 `Responses API + 内置网页搜索`。
6. 暂不把本地函数工具和 Responses 内置工具混在第一版一起做，避免复杂度失控。

---

## 实现步骤

### 第一步：扩展请求模型，增加“端点模式”

**文件：`ai/models.py`**

目标：让前后端能够明确区分当前请求走哪条协议链路。

建议新增字段：

```python
endpointMode: str = "chat_completions"   # chat_completions | responses
enableBuiltinWebSearch: bool = False
```

说明：

- `endpointMode` 用来决定后端走现有 `chat_stream()` 还是新增的 `responses_stream()`
- `enableBuiltinWebSearch` 用来表达“Responses 模式下是否启用 OpenAI 内置网页搜索”
- 这一步只扩展数据结构，不改变现有行为

---

### 第二步：新增 Responses 路由

**文件：新增 `routes/responses.py`**

新增路由：

```python
POST /api/responses/stream
```

行为要求：

1. 接收与 `ChatRequest` 兼容的新请求体
2. 调用 `AIService.responses_stream(request)`
3. 返回 `text/event-stream`
4. 保持与现有 `/api/chat/stream` 一致的 SSE 响应头

同时需要修改：

- `server.py` 注册新 router

这样可以把新旧能力物理隔离，后续排查问题时也更清晰。

---

### 第三步：ProviderConfig 增加 Responses 端点识别

**文件：`ai/providers.py`**

当前 `ProviderConfig.get_api_url()` 主要围绕：

- `/v1/chat/completions`
- `/v1/messages`

需要扩展为支持：

- `/v1/responses`

建议改造点：

1. `get_api_url()` 增加可选参数，例如 `endpoint_mode`
2. 当 `endpoint_mode == "responses"` 时：
   - 默认地址使用 `https://api.openai.com/v1/responses`
   - 若用户只填了 base URL，则自动补齐 `/v1/responses`
   - 若用户填的是 `/chat/completions`，可尝试安全转换到同域 `/responses`
3. 保留 Anthropic 旧逻辑，不受影响

同时前端/模型列表相关的 URL 归一化逻辑也要补上 `/responses` 的识别，避免地址处理时出现误判。

---

### 第四步：新增 Responses 请求体构造器

**文件：`ai/providers.py`**

目标：把现有 Prism 请求结构转换成 OpenAI `Responses API` 需要的请求体。

建议新增：

- `MessageBuilder.build_responses_request_body(...)`
- 或新增 `_build_openai_responses_body(...)`

转换重点：

1. 系统提示词转换
   - 保留现有默认系统提示词机制
   - 转换到 Responses 所需字段

2. 历史对话转换
   - 把 `historyTurns` 转成 `input` 所需结构
   - 用户轮次、助手轮次都要保留

3. 当前输入转换
   - 文本转为标准输入项
   - 图片输入需要确认 Responses API 对 image 输入的格式后再接入
   - 第一版可以先优先保证文本链路

4. 流式开关
   - 打开 streaming

5. 内置网页搜索工具
   - 当 `enableBuiltinWebSearch` 为 `true` 时，在 `tools` 中加入：
     - `web_search_preview`
     - 或当时官方推荐版本化名字

第一阶段建议：

- `Responses` 模式先只支持 OpenAI 官方内置网页搜索
- 不在第一版混入 `tavily_search/exa_search/get_current_time` 这类本地函数工具

---

### 第五步：新增 Responses 流式解析器

**文件：`ai/stream_parser.py`**

当前解析器已经支持：

- OpenAI `chat.completions`
- Anthropic `messages`

需要新增：

- `parse_responses_chunk()` 或类似方法

解析目标不是完全暴露 OpenAI 原始事件，而是转成 Prism 前端已经认识的统一结构。

建议映射关系：

1. 文本增量
   - OpenAI Responses 文本 delta
   - 转为：
   ```python
   {"content": "..."}
   ```

2. 推理增量
   - 若模型返回 reasoning 相关事件
   - 转为：
   ```python
   {"thinking": "..."}
   ```

3. token 信息
   - 从 completed 事件或 usage 字段中提取
   - 转为：
   ```python
   {"tokens": ...}
   ```

4. 网页搜索工具事件
   - 从内置网页搜索相关事件中提取“开始 / 完成 / 查询词 / 结果”
   - 转为 Prism 现有的：
   - `tool`
   - `web_search`
   - `sources`

5. 错误事件
   - 转为：
   ```python
   {"type": "error", "data": "..."}
   ```

---

### 第六步：新增 Responses 服务主流程

**文件：`ai/chat_service.py`**

建议新增：

- `AIService.responses_stream(request)`

职责：

1. 判断当前 provider 是否允许走 Responses
   - 第一版只支持 OpenAI
   - Anthropic 保持旧链路

2. 构建 Responses API URL

3. 构建请求头
   - `Authorization: Bearer ...`

4. 构建 Responses 请求体

5. 发起流式请求

6. 逐条读取 OpenAI 的 SSE 事件

7. 把原始事件转换为前端已支持的标准 chunk：
   - `thinking`
   - `content`
   - `tokens`
   - `tool`
   - `web_search`
   - `sources`
   - `error`

8. 流结束时补发最终 token / 结束状态

这一层的关键不是“透传”，而是“标准化”。

---

### 第七步：适配内置网页搜索结果抽取

**文件：`ai/stream_parser.py` 与 `ai/chat_service.py`**

目标：让 OpenAI 内置网页搜索的结果，复用当前前端现成展示能力。

现有前端已经支持两类展示：

1. 工具调用列表中的搜索卡片
2. 助手回答下方的来源列表

因此后端应继续输出这两类事件：

#### 1. `web_search`

建议统一格式：

```json
{
  "status": "ready",
  "round": 1,
  "name": "web_search_preview",
  "query": "用户查询词",
  "answer": "搜索摘要",
  "totalResults": 5,
  "results": [
    {
      "title": "标题",
      "url": "https://...",
      "content": "摘要"
    }
  ]
}
```

这样可以直接复用 `frontend/js/web-search.js` 的渲染逻辑。

#### 2. `sources`

建议统一格式：

```json
[
  {
    "title": "标题",
    "url": "https://..."
  }
]
```

这样可以直接复用现有的来源状态条与来源面板。

#### 3. `tool`

为了让工具调用区域显示“搜索开始/完成”，建议补发：

```json
{"status":"start","round":1,"name":"web_search_preview","arguments":{"query":"..."}}
{"status":"success","round":1,"name":"web_search_preview","resultSummary":"返回 5 条结果"}
```

这样前端现有 `renderToolEvents()` 基本不用改。

---

### 第八步：前端配置层增加“接口模式”

**文件：`frontend/index.html`、`frontend/js/config.js`**

新增配置项：

- 接口模式：
  - `Chat Completions`
  - `Responses`

建议行为：

1. 默认仍为 `Chat Completions`
2. 当切换到 `Responses` 时：
   - 提示这是 OpenAI 新接口
   - 提示并非所有 OpenAI 兼容服务都支持
3. 若启用 `Responses`：
   - Web Search 开关解释切换为“使用内置网页搜索”
   - 不再强调 Tavily / Exa

这一层是给用户明确预期，避免“OpenAI 兼容站点不支持 `/responses`”时误解为系统异常。

---

### 第九步：前端请求分流

**文件：`frontend/js/conversation.js`**

当前 `callModel()` 固定请求：

```javascript
/api/chat/stream
```

需要调整为：

1. 读取配置中的 `endpointMode`
2. 当 `endpointMode === "responses"` 时：
   - 请求 `/api/responses/stream`
   - 请求体附带 `endpointMode: "responses"`
   - 请求体附带 `enableBuiltinWebSearch`
3. 当 `endpointMode === "chat_completions"` 时：
   - 保持原逻辑

同时建议调整请求体策略：

#### 旧模式

- `selectedTools` 继续使用：
  - `tavily_search`
  - `exa_search`
  - `get_current_time`

#### Responses 模式

- 第一版先不传本地工具定义
- 改为只传：
  - `enableBuiltinWebSearch`

这样能降低复杂度，也避免模型同时面对“内置搜索工具”和“本地搜索工具”时发生冲突。

---

### 第十步：模型列表与地址归一化补充兼容

**文件：`routes/models.py`、`frontend/js/models.js`**

虽然模型列表接口本身仍然是 `/v1/models`，但地址归一化逻辑当前只显式识别：

- `/chat/completions`
- `/messages`
- `/models`

建议补上：

- `/responses`

这样当用户在配置中填写的是：

- `https://api.openai.com/v1/responses`
- 或某个代理的 `/responses`

前后端都能正确提取 base URL 去请求 `/models`。

---

### 第十一步：错误处理与兼容性策略

**涉及文件：`ai/chat_service.py`、`frontend/js/conversation.js`**

必须明确处理以下场景：

1. 用户选择了 `Responses`，但 provider 不是 OpenAI
   - 后端直接返回清晰错误

2. 用户使用的是 OpenAI 兼容地址，但该服务不支持 `/responses`
   - 后端应返回明确报错，例如：
   - `当前服务不支持 Responses API 或内置网页搜索`

3. 用户启用了内置网页搜索，但模型本身不支持该工具
   - 后端应透出原始 API 错误摘要

4. 搜索事件里没有完整来源信息
   - 允许只展示 `content`
   - 不强制生成 `sources`

---

## 第一阶段建议范围

为了尽快落地，建议第一阶段只做以下范围：

1. 新增 `/api/responses/stream`
2. 支持 OpenAI 官方 `Responses API`
3. 支持纯文本输入
4. 支持内置网页搜索
5. 搜索结果复用现有 `tool/web_search/sources` 展示
6. 保持现有 `/api/chat/stream` 全部行为不变

### 第一阶段暂不做

1. Responses 模式下混用本地函数工具
2. Responses 模式下的复杂多模态图片输入
3. 自动把来源引用内嵌到正文
4. 多 provider 共用 Responses 语义

---

## 第二阶段可选增强

当第一阶段稳定后，可以继续考虑：

1. `Responses API + 本地函数工具` 混合模式
2. 图片输入在 Responses 模式下的适配
3. 更精细的搜索过程展示
4. 更好的引用与来源编号映射
5. 根据模型能力动态控制是否显示“内置网页搜索”选项

---

## 需要修改的文件清单

| 文件 | 改动内容 |
|------|---------|
| `ai/models.py` | 扩展 `ChatRequest`，增加 `endpointMode`、`enableBuiltinWebSearch` |
| `routes/responses.py` | 新增 Responses 流式路由 |
| `server.py` | 注册新 router |
| `ai/providers.py` | 增加 `/responses` URL 处理与 Responses 请求体构造 |
| `ai/stream_parser.py` | 新增 Responses 事件解析与搜索结果抽取 |
| `ai/chat_service.py` | 新增 `responses_stream()` 主流程 |
| `frontend/index.html` | 增加“接口模式”配置项 |
| `frontend/js/config.js` | 保存/读取 `endpointMode` 等配置 |
| `frontend/js/conversation.js` | 根据 `endpointMode` 切换请求链路 |
| `routes/models.py` | URL 归一化补充 `/responses` |
| `frontend/js/models.js` | URL 归一化补充 `/responses` |

---

## 验证方案

### 基础验证

1. 旧链路回归
   - 使用 `chat/completions` 正常聊天
   - Tavily / Exa 搜索正常工作

2. Responses 基础对话
   - 切换到 `Responses`
   - 普通提问能正常流式输出

3. Responses 内置搜索
   - 开启联网搜索
   - 能看到工具调用区域的搜索过程
   - 能看到来源状态与来源列表

4. 错误场景验证
   - 使用不支持 `/responses` 的兼容地址时，错误提示清晰
   - 使用不支持内置网页搜索的模型时，错误提示清晰

### 建议执行的检查命令

```bash
python -m py_compile server.py tools.py
```

如果后续改动范围涉及 `ai/` 目录中的多个文件，建议一并检查：

```bash
python -m py_compile server.py ai\\models.py ai\\providers.py ai\\stream_parser.py ai\\chat_service.py tools.py
```

### 手工检查清单

1. 启动服务并打开 `http://localhost:3000`
2. 用旧模式发送一条普通消息
3. 用旧模式发送一条联网搜索消息
4. 切换到 `Responses` 模式后发送普通消息
5. 切换到 `Responses` 模式并启用内置搜索后再次发送消息
6. 验证来源展示、工具事件展示、最终回答展示都正常

---

## 风险与注意事项

1. 并非所有 OpenAI 兼容服务都支持 `Responses API`
2. 并非所有模型都支持内置网页搜索
3. `Responses API` 的流式事件种类比 `chat/completions` 更多，第一版应优先做最小兼容，不宜一次性追求全量覆盖
4. 当前前端已经有稳定展示协议，应尽量保持后端标准化输出，而不是把 OpenAI 原始事件直接暴露到前端

---

## 推荐落地顺序

1. 先加 `endpointMode` 与 `/api/responses/stream` 路由骨架
2. 再接 Responses 的纯文本流式输出
3. 然后接内置网页搜索并映射到现有 `web_search/sources/tool`
4. 最后补模型列表地址归一化与 UI 细节

这样可以保证每一步都能独立验证，降低回归风险。
