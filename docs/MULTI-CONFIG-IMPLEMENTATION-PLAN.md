# 多配置与 API 格式解耦实现方案

## 1. 背景与目标

当前项目是“单模型配置”模式，限制了多供应商并行使用。  
本方案目标是把模型配置升级为“多配置列表”，并支持以下 API 格式选择：

1. `openai_compatible`
2. `openai_responses`
3. `gemini`
4. `anthropic`

同时保证：

1. 聊天主界面整体不改（布局和交互风格保持原样），仅顶部模型 ID 支持点击切换配置。
2. 除顶部模型 ID 快捷切换外，其余新增能力全部放在“设置中心”完成。
3. `chat completions` 和 `responses` 严格分开，不做自动回退。

## 2. 范围与非目标

### 2.1 本次范围

1. 设置中心支持“多配置管理（列表 + 表单）”。
2. 每条配置只保留 5 个业务字段：
   1. 配置名称
   2. API 格式
   3. API Key
   4. Base URL
   5. 模型 ID
3. 聊天请求根据“当前活动配置（activeConfigId）”走对应协议链路。
4. 后端新增按 API 格式分流的处理逻辑。
5. 聊天页顶部模型 ID 支持点击下拉并切换活动配置。

### 2.2 明确不做

1. 不改聊天页面整体布局与消息区，仅允许顶部模型 ID 区域增加下拉切换能力。
2. 不做端点手动覆盖字段。
3. 不做联网方式字段（已确认删除）。
4. 不做自动回退（例如 responses 失败后自动转 chat）。

## 3. 交互设计（设置页 + 聊天页顶部切换）

## 3.1 页面结构

设置中心 -> 模型页拆分为两栏：

1. 左侧：配置列表
   1. 新建配置
   2. 配置项列表（显示名称 + API 格式标签 + 默认标记）
2. 右侧：配置详情表单
   1. 配置名称
   2. API 格式（四选一）
   3. API Key
   4. Base URL
   5. 模型 ID
   6. 按钮：设为默认 / 复制 / 删除 / 保存配置

## 3.2 交互规则

1. 进入设置时，默认选中“当前活动配置（activeConfigId）”。
2. 切换左侧配置后，右侧表单刷新为该配置内容。
3. 点击保存仅更新当前配置，不影响其他配置。
4. 删除默认配置时，自动将第一条剩余配置设为默认。
5. 至少保留一条配置，最后一条不可删除。

## 3.3 聊天页顶部模型 ID 快捷切换

1. 顶部模型 ID 文本区改为可点击，点击后弹出配置下拉列表。
2. 顶部展示文案固定为单行：`配置名称 / 模型ID`。
3. 下拉项展示固定为单行：`配置名称 / 模型ID`。
4. 不显示次文案（不显示 API 格式小字、第二行说明）。
5. 当前选中项高亮并显示对勾；默认配置可显示 `默认` 标签。
6. 选择某项后立即更新 `activeConfigId`，并持久化到本地存储。
7. 切换仅影响后续消息，不中断当前已在生成中的请求。
8. 若配置缺少必填字段（API Key、Base URL、模型 ID），禁止切换并提示原因。

## 4. 数据结构设计

本地存储键：`aiPkConfig`

```json
{
  "activeConfigId": "cfg_xxx",
  "configs": [
    {
      "id": "cfg_xxx",
      "name": "GPT-5 Responses",
      "apiFormat": "openai_responses",
      "apiKey": "",
      "baseUrl": "https://api.openai.com",
      "model": "gpt-5-chat-latest",
      "isDefault": true
    }
  ]
}
```

说明：

1. `activeConfigId` 用于标记当前使用配置。
2. `isDefault` 仅用于列表展示和默认管理。
3. 业务字段严格保持 5 项；`id/isDefault` 是系统元数据。

## 5. 旧数据迁移策略

已有旧结构（单配置）时，首次加载执行一次迁移：

1. 把旧 `model.provider/apiKey/apiUrl/model` 转成一条新配置。
2. 根据旧 provider 映射默认 `apiFormat`：
   1. `anthropic` -> `anthropic`
   2. 其他 -> `openai_compatible`
3. 生成 `id`，并写入 `activeConfigId`。
4. 迁移后覆盖保存为新结构。

## 6. 前端实现方案

涉及文件：`frontend/index.html`、`frontend/app.js`、`frontend/style.css`

## 6.1 `index.html` 改动点

1. 模型页新增“配置列表容器”。
2. 模型页右侧表单替换为多配置编辑表单。
3. `API 格式`下拉选项固定四个值：
   1. `openai_compatible`
   2. `openai_responses`
   3. `gemini`
   4. `anthropic`
4. 聊天页头部模型 ID 区域添加下拉容器（仅该区域新增交互节点）。

## 6.2 `app.js` 改动点

1. 新增状态方法：
   1. `getConfigs()`
   2. `setConfigs()`
   3. `getActiveConfig()`
   4. `setActiveConfig(id)`
   5. `switchActiveConfig(id)`
2. 新增列表操作：
   1. 新建配置
   2. 复制配置
   3. 删除配置
   4. 设为默认
3. 新增聊天页顶部切换逻辑：
   1. 渲染顶部配置下拉项
   2. 绑定点击切换事件
   3. 切换后更新顶部模型显示（`配置名称 / 模型ID`）
   4. 切换失败时显示校验提示
4. 调整保存逻辑：
   1. 保存当前编辑配置到 `configs[]`
   2. 不再写入旧的单配置结构
5. 聊天发送时读取 `activeConfig` 生成请求体。

## 6.3 `style.css` 改动点

1. 仅补充顶部模型 ID 下拉相关样式。
2. 保持现有头部视觉风格，不引入新的布局层级。

## 7. 后端实现方案

涉及文件：`ai_service.py`、`server.py`

## 7.1 请求模型

`ChatRequest` 新增字段：

1. `apiFormat: str`
2. `baseUrl: str | None`

并保留：

1. `apiKey`
2. `model`
3. `prompt` 等现有字段

## 7.2 分流策略（无回退）

入口：`AIService.chat_stream`

按 `apiFormat` 进入不同链路：

1. `openai_compatible` -> 走现有 OpenAI Chat Completions 链路
2. `openai_responses` -> 新增 Responses 专用链路
3. `anthropic` -> 走现有 Anthropic Messages 链路
4. `gemini` -> 新增 Gemini 专用链路

规则：链路失败直接报错，不做降级或重试到别的格式。

## 7.3 响应规范

无论内部协议如何，统一转换成现有前端可消费 SSE 事件：

1. `thinking`
2. `content`
3. `tokens`
4. `error`

这样聊天界面无需改动。

## 8. API 格式约定

## 8.1 `openai_compatible`

1. 默认路径：`/v1/chat/completions`
2. 请求体：`messages` 风格
3. 鉴权：`Authorization: Bearer ...`

## 8.2 `openai_responses`

1. 默认路径：`/v1/responses`
2. 请求体：`input` 风格
3. 鉴权：`Authorization: Bearer ...`
4. 与 `openai_compatible` 完全分离

## 8.3 `anthropic`

1. 默认路径：`/v1/messages`
2. 请求头需包含 `anthropic-version`
3. 鉴权：`x-api-key`

## 8.4 `gemini`

1. 使用 Gemini 原生协议路径
2. 使用 Gemini 对应请求体结构
3. 与 OpenAI/Anthropic 协议不共享构建器

## 9. 错误提示策略

报错文案必须明确：

1. 当前配置名称
2. API 格式
3. 请求 URL
4. 上游返回码与关键信息

示例：

`配置「GPT-5 Responses」调用失败（openai_responses，HTTP 404）：目标端点不存在`

## 10. 分阶段实施计划

### 阶段 1：设置页多配置 + 顶部切换入口（不改请求链路）

1. 完成列表 + 表单 UI
2. 完成本地存储与旧数据迁移
3. 完成聊天页顶部模型 ID 下拉切换
4. 验证配置增删改查与顶部切换

### 阶段 2：聊天请求接入活动配置

1. 聊天发送改为读取 `activeConfig`
2. 后端接收 `apiFormat`
3. 现有 `openai_compatible/anthropic` 链路保持可用

### 阶段 3：新增 `openai_responses` 与 `gemini` 链路

1. 增加协议构建与流解析
2. 统一 SSE 输出
3. 完成错误提示细化

### 阶段 4：联调与回归

1. 四种 API 格式逐一验证
2. 老配置迁移验证
3. 聊天页除顶部模型切换外无额外改动验证

## 11. 验收标准

1. 可在设置页保存多条配置并切换默认配置。
2. 聊天页顶部可切换配置，且后续消息按切换后的活动配置发送请求。
3. 四种 API 格式可独立工作，互不回退。
4. 旧用户首次启动可自动迁移且不丢配置。
5. 失败时错误信息可定位到具体配置与协议。
6. 顶部切换配置不打断当前生成，仅影响后续消息。
