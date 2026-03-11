# ai_service.py 重构计划

## 现状分析

`ai_service.py` 目前 **1015 行**，把所有 AI 相关逻辑塞在一个文件里，包括：

| 区域 | 行号 | 行数 | 说明 |
|------|------|------|------|
| 数据模型 | 18-88 | ~70 | `ImageContent`, `HistoryTurn`, `ChatRequest`, `StreamChunk` |
| 提供商配置 | 90-163 | ~73 | `ProviderConfig` — URL 拼接、请求头构建 |
| 消息构建器 | 165-421 | ~256 | `MessageBuilder` — 系统提示词、历史消息、多模态、请求体 |
| 流式解析器 | 423-479 | ~56 | `StreamParser` — Anthropic/OpenAI chunk 解析 |
| AI 服务主类 | 482-1015 | **~533** | `AIService.chat_stream` — 一个巨大的方法 |

### 主要问题

1. **`chat_stream` 方法过长（533 行）**：流式请求、SSE 解析、工具调用循环、搜索结果提取全混在一起，嵌套层级最深达 8-9 层
2. **大量代码重复**：第一次流式解析（560-639 行）和工具调用后的流式解析（924-1006 行）逻辑几乎一样，复制粘贴了一遍
3. **职责不清**：搜索结果的来源提取、预览构建（798-876 行）不应该放在 AI 服务里
4. **难以测试**：所有逻辑都在一个 async generator 里，无法单独测试某一部分

---

## 重构方案

把 `ai_service.py` 拆成 **4 个文件**，放到一个 `ai/` 包里：

```
ai/
├── __init__.py          # 导出 AIService, ChatRequest（保持外部引用不变）
├── models.py            # 数据模型
├── providers.py         # 提供商配置 + 消息构建
├── stream_parser.py     # 流式响应解析（含 SSE 行解析）
└── chat_service.py      # AI 服务主类（精简后的 chat_stream）
```

### 文件 1：`ai/models.py` （约 70 行）

把所有 Pydantic 数据模型搬过来，不需要改动：
- `ImageContent`
- `HistoryTurn`
- `ChatRequest`
- `StreamChunk`

### 文件 2：`ai/providers.py` （约 260 行）

合并 `ProviderConfig` 和 `MessageBuilder`，因为它们都是在做"请求准备"工作：
- URL 拼接、请求头构建
- 系统提示词处理
- 历史消息转换
- 多模态内容构建
- 请求体构建（OpenAI / Anthropic）

### 文件 3：`ai/stream_parser.py` （约 120 行）

在现有 `StreamParser` 基础上增加：
- **SSE 行解析**：把"读字节→拆行→去掉 `data: ` 前缀→JSON 解析"这套重复逻辑提取成一个公共的异步迭代器
- **工具调用累积**：把 `tool_calls_buffer` 的拼接逻辑封装起来
- 搜索结果的来源提取和预览构建也放这里

这样 `chat_stream` 里的两处流解析代码就能合并成一处。

### 文件 4：`ai/chat_service.py` （约 200 行）

精简后的 `AIService`，`chat_stream` 的结构变成：

```python
async def chat_stream(request):
    # 1. 准备请求（用 providers 模块）
    # 2. 发起首次请求，用 stream_parser 解析
    # 3. 如果有工具调用 → 进入工具循环
    #    3a. 执行工具
    #    3b. 发送工具事件
    #    3c. 再次请求 AI，用同一个解析器
```

### 文件 5：`ai/__init__.py` （约 5 行）

```python
from .models import ChatRequest, StreamChunk, ImageContent, HistoryTurn
from .providers import ProviderConfig
from .chat_service import AIService
```

---

## 需要同步修改的引用

目前只有 `server.py` 引用了 `ai_service`：

| 文件 | 当前引用 | 改为 |
|------|---------|------|
| `server.py:32` | `from ai_service import AIService, ChatRequest` | `from ai import AIService, ChatRequest` |
| `server.py:563` | `from ai_service import ProviderConfig` | `from ai import ProviderConfig` |

旧的 `ai_service.py` 重构完成后可以删除。

---

## 关键原则

- **不改功能**：纯粹的结构拆分，所有输入输出、SSE 格式保持不变
- **不加功能**：不趁机加新特性或改行为
- **分步执行**：每一步拆完都能跑，不需要一次性全改完
- **保持兼容**：通过 `ai/__init__.py` 的导出，外部代码只需改一处 import 路径

---

## 执行步骤

### 第 1 步：创建 `ai/` 包结构
- 新建 `ai/` 目录和 `__init__.py`

### 第 2 步：搬迁数据模型 → `ai/models.py`
- 搬 `ImageContent`, `HistoryTurn`, `ChatRequest`, `StreamChunk`
- 搬相关 import（`pydantic`, `typing`, `datetime`）

### 第 3 步：搬迁请求准备 → `ai/providers.py`
- 搬 `ProviderConfig` 和 `MessageBuilder`
- 从 `models.py` 引用数据模型

### 第 4 步：重构流式解析 → `ai/stream_parser.py`
- 搬现有 `StreamParser`
- 新增 `async def parse_sse_stream(response, provider_mode)` 异步迭代器
  - 合并两处重复的 SSE 解析逻辑
- 新增 `ToolCallsAccumulator` 类封装工具调用累积
- 新增搜索结果提取函数

### 第 5 步：精简主服务 → `ai/chat_service.py`
- 搬 `AIService`
- 用 `parse_sse_stream` 替换两处重复代码
- 用 `ToolCallsAccumulator` 简化工具调用累积
- 提取工具执行逻辑为独立方法

### 第 6 步：更新引用 + 清理
- 更新 `server.py` 的 import
- 确保 `__init__.py` 导出正确
- 删除旧的 `ai_service.py`
- 运行测试/启动验证
