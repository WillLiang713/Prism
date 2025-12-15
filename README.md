# AI模型对比工具

一个简单的AI模型对比工具，支持同时调用两个不同的AI模型进行对比测试。

## 功能特性

- 双模型并行对比
- 流式输出显示
- Markdown渲染支持
- 代码高亮显示
- 思考模式支持
- 多API提供商支持（OpenAI、Anthropic、自定义）
- 配置持久化
- 自动CORS代理

## 快速开始

### 方式一：使用Python服务器（推荐）

1. 安装依赖：
   ```bash
   pip install fastapi uvicorn httpx
   ```

2. 启动服务器：
   ```bash
   python server.py
   ```

3. 访问应用：
   ```
   http://localhost:3000
   ```

4. 配置两个AI模型的API信息

5. 输入提示词，点击发送即可对比

**优势：**
- 自动处理CORS问题，无需手动配置
- 集成静态文件服务和API代理
- 开箱即用，无需额外配置

### 方式二：直接打开HTML（需要处理CORS）

如果直接在浏览器中打开 `frontend/index.html`，会遇到CORS跨域问题。建议使用方式一。

## 配置说明

### API提供商配置

**OpenAI格式：**
- API地址：`https://api.openai.com/v1/chat/completions`
- 模型示例：`gpt-4`、`gpt-4-turbo`、`gpt-3.5-turbo`
- 思考模式：o1系列模型支持

**Anthropic格式：**
- API地址：`https://api.anthropic.com/v1/messages`
- 模型示例：`claude-3-opus-20240229`、`claude-3-sonnet-20240229`
- 思考模式：Claude 3.5+模型支持

**自定义API：**
- 支持兼容OpenAI或Anthropic格式的第三方API
- 需要手动填入完整的API地址

### 系统提示词

可以为每个模型配置独立的系统提示词，用于定制AI的行为和角色。

### 思考模式

启用思考模式后，AI会显示内部思考过程：
- Anthropic：显示thinking内容
- OpenAI o1：显示reasoning过程
- DeepSeek（OpenAI兼容接口）：通过请求体 `thinking: { type: "enabled" }` 开启（SDK里通常以 `extra_body` 传入）

## 技术架构

### 前端
- 纯HTML/CSS/JavaScript实现
- 无需构建工具
- 使用fetch API处理流式响应
- localStorage持久化配置
- marked.js渲染Markdown
- highlight.js代码高亮

### 后端
- FastAPI框架
- 异步HTTP代理
- 流式响应转发
- 自动CORS处理

## 文件结构

```
AI-PK/
├── frontend/           # 前端代码
│   ├── index.html     # 主页面
│   ├── style.css      # 样式文件
│   └── app.js         # 核心逻辑
├── server.py          # Python后端服务器
├── pyproject.toml     # Python项目配置
└── README.md          # 说明文档
```

## 工作原理

### CORS代理机制

1. 前端通过 `server.py` 访问应用时，会自动检测并配置代理
2. 所有API请求会通过代理服务器转发
3. 代理服务器添加正确的CORS头，解决跨域问题
4. 支持流式响应的透明转发

### 请求流程

```
浏览器 → server.py → 第三方API
       ← (添加CORS头) ←
```

## 注意事项

### 1. API密钥安全
- 密钥存储在浏览器localStorage中
- 仅在本地使用，不要在公共环境使用
- 不要将密钥提交到代码仓库

### 2. 网络要求
- 需要能够访问目标API（OpenAI、Anthropic等）
- 如果在国内使用，可能需要配置网络代理

### 3. 流式输出
- 需要API支持Server-Sent Events (SSE)
- 网络不稳定可能导致中断
- 可随时点击"停止"按钮中断生成

### 4. 模型兼容性
- 确保模型名称正确
- 不同模型的参数可能不同
- 思考模式仅部分模型支持

## 常见问题

**Q: 如何启动应用？**
A: 运行 `python server.py`，然后访问 http://localhost:3000

**Q: 为什么直接打开HTML文件不行？**
A: 浏览器的CORS安全策略会阻止直接调用第三方API，需要通过代理服务器访问。

**Q: 思考模式没有显示内容？**
A: 确认使用的模型/接口会返回思考字段（如 `thinking` / `reasoning_content`）。若接口需要显式开启（如 DeepSeek/Qwen），请勾选"启用思考模式"以在请求中附带对应参数。

**Q: 流式输出中断了怎么办？**
A: 检查网络连接，或尝试重新发送请求。

**Q: 可以同时对比三个或更多模型吗？**
A: 当前版本仅支持两个模型对比，如需更多可修改代码扩展。

**Q: 如何修改服务器端口？**
A: 编辑 `server.py` 文件最后一行的端口号（默认3000）。

**Q: 支持哪些Markdown语法？**
A: 支持GitHub Flavored Markdown (GFM)，包括表格、代码块、任务列表等。

## 开发说明

### 添加新的API提供商

1. 在 `frontend/app.js` 的 `buildRequest()` 函数中添加新的提供商逻辑
2. 在 `frontend/index.html` 的下拉菜单中添加选项
3. 实现对应的响应解析函数

### 自定义样式

编辑 `frontend/style.css` 文件，所有样式都使用中性色调，易于定制。

### 扩展功能

- 添加更多模型对比：修改HTML结构和JavaScript逻辑
- 添加历史记录：扩展localStorage存储
- 导出对比结果：添加导出功能

## 许可证

MIT License
