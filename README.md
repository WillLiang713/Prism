# Prism

双模型并行对比工具，支持流式输出、思考模式、会话管理。

## 核心功能

- 双模型并行对比与流式输出
- 支持 OpenAI、Anthropic、自定义 API
- 思考模式
- 会话管理与历史记录
- Markdown 渲染与代码高亮
- 内置 Tavily 搜索接口

## 快速开始

1. 安装依赖
   ```bash
   pip install fastapi uvicorn httpx
   ```

2. 启动服务
   ```bash
   python server.py
   ```

3. 访问应用
   ```
   http://localhost:3000
   ```

4. 配置 API
   - 点击右上角"配置"按钮
   - 填入 API 地址、密钥、模型名称
   - 支持 OpenAI 格式、Anthropic 格式、自定义接口

## 技术栈

**前端**：原生 HTML/CSS/JavaScript + marked.js + highlight.js
**后端**：FastAPI + httpx（异步代理 + CORS 处理）

## 文件结构

```
Prism/
├── frontend/       # 前端代码（index.html, style.css, app.js）
├── server.py       # Python 后端服务器
└── README.md       # 说明文档
```
