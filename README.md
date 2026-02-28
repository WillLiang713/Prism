# Prism

Prism 是一个轻量的对话式 AI 客户端，提供统一的模型接入、联网搜索和会话管理能力。

## 功能概览

- 模型对话与流式输出
- 支持 OpenAI 兼容与 Anthropic 兼容接口
- 思考强度设置与思考过程展示
- 联网搜索工具（Tavily / Exa）
- 会话与话题管理（本地保存历史）
- Markdown 渲染与代码高亮
- 图片上传输入

## 快速开始

1. 安装依赖

```bash
pip install -r requirements.txt
```

2. 启动服务

```bash
python server.py
```

3. 打开页面

```text
http://localhost:3000
```

## 配置说明

在页面右上角进入“配置”：

- 模型配置：provider、apiKey、apiUrl、model、systemPrompt
- 联网配置：webSearchProvider、Tavily/Exa Key、结果数量、搜索深度

也可通过环境变量提供联网密钥：

- `TAVILY_API_KEY`
- `EXA_API_KEY`

## 技术栈

- 前端：HTML / CSS / JavaScript（marked.js、highlight.js）
- 后端：FastAPI、httpx

## 项目结构

```text
Prism/
├── frontend/          # 前端页面与交互逻辑
├── server.py          # HTTP 服务与接口
├── ai_service.py      # 模型调用与工具编排
├── tools.py           # 联网搜索等工具实现
├── docker-compose.yml # 容器部署配置
└── README.md
```
