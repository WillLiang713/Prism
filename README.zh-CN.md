# Prism

[English](./README.md)

Prism 是一个轻量级 AI 对话客户端，采用 Python 后端和静态前端，提供统一模型接入、联网搜索、话题管理，以及基于 Tauri 的 Windows 桌面版。

## 下载

- 仓库地址：<https://github.com/WillLiang713/Prism>
- Releases 页面：<https://github.com/WillLiang713/Prism/releases>
- 如果你只是想直接使用 Windows 桌面版，优先从 Releases 下载最新安装包。
- 如果你要本地开发、二次修改或自行打包，再继续阅读下面的说明。

## 功能亮点

- 流式对话输出
- 支持 OpenAI、Anthropic 和 Gemini 接口
- 支持 Tavily 和 Exa 联网搜索
- 基于话题的会话管理和本地历史保存
- 思考强度设置与思考过程展示
- Markdown 渲染与代码高亮
- 图片上传输入
- 新建话题快捷键：`Ctrl + Alt + O`

## 快速开始

### 本地运行 Web 版

1. 安装 Python 依赖：

```bash
pip install -r requirements.txt
```

如果仓库根目录已有 `venv/`，Windows 下更推荐直接复用：

```bash
.\venv\Scripts\python.exe -m pip install -r requirements.txt
```

2. 启动服务：

```bash
python server.py
```

Windows 下更推荐：

```bash
.\venv\Scripts\python.exe server.py
```

3. 打开浏览器访问：

```text
http://localhost:3000
```

### 使用 Docker 运行

```bash
docker compose up --build
```

默认端口由环境变量 `PRISM_PORT` 控制，未设置时为 `3000`。

## Windows 桌面版（Tauri）

### 直接使用已发布版本

如果你只是想在 Windows 上使用 Prism：

1. 打开 Releases 页面：

```text
https://github.com/WillLiang713/Prism/releases
```

2. 下载最新的 Windows 安装包。
3. 安装后直接启动。

### 桌面版开发

推荐命令：

```bash
npm install
npm run desktop:dev
```

如果你要把桌面壳缓存、Node 依赖、Rust/Tauri 构建产物、后端日志和 Python 缓存一起清掉并重新安装后再启动，可执行：

```bash
npm run desktop:rebuild-dev
```

这套流程会自动：

- 在 `127.0.0.1:33100` 启动本地 Python 后端
- 等待健康检查通过
- 让 Tauri 开发壳直接加载后端提供的首页与静态资源，避免桌面端单独缓存旧前端
- 启动 Tauri 桌面壳
- 在 Tauri 退出后停止后端进程

开发阶段后端日志默认写入：

```text
logs/desktop-dev-backend.stdout.log
logs/desktop-dev-backend.stderr.log
```

底层命令仍然可用：

```bash
python server.py --host 127.0.0.1 --port 33100
npm run tauri:dev
```

说明：

- 日常开发优先使用 `npm run desktop:dev`
- `npm run desktop:rebuild-dev` 会进一步删除 `node_modules`、`src-tauri\\target`、仓库内日志与 Python 缓存，并重新安装依赖后再启动
- `npm run tauri:dev` 仍不会自动帮你启动 Python 后端；现在它也依赖后端首页可访问
- 如果你已经激活了虚拟环境，优先用 `python`，不要用 `py -3`，避免绕过当前环境
- 桌面版默认连接到 `http://127.0.0.1:33100`，如果要改后端地址，可设置 `PRISM_DESKTOP_API_BASE`

### 打包 Windows 桌面版

首次打包前需要安装：

- Rust / Cargo
- Visual Studio Build Tools（含 MSVC 和 Windows SDK）
- Nuitka

打包命令：

```bash
npm run desktop:build
```

说明：

- 不建议直接运行 `npm run tauri:build`
- 推荐完整打包入口是 `npm run desktop:build`
- 实际脚本入口为 `scripts/build-tauri-windows.ps1`
- 该脚本会先清理 `node_modules`、`src-tauri\\target`、`build`、`dist`、仓库日志与 Python 缓存，再重新安装依赖并打包
- 该脚本会先把 Python 运行时打成 `prism-runtime.exe`，再执行 Tauri 构建
- 走这条路径才能确保桌面安装包带上最新的后端 sidecar

当前打包行为：

- `prism-runtime.exe` 以无控制台方式启动，不会额外弹出黑色命令行窗口
- 桌面主界面会先显示，待后端健康检查通过后进入可用状态
- 后端未就绪前，输入框和发送按钮会被禁用
- 如果本地后端启动失败，建议重启应用并查看日志

### 桌面版日志

Windows 打包版后端日志默认写入：

```text
%LOCALAPPDATA%\Prism\logs\
```

日志行为：

- 按天生成，文件名类似 `backend-2026-03-10.log`
- 启动时会自动清理 7 天前的旧日志
- 主要用于排查后端启动失败、接口异常和未捕获异常

## 配置说明

在应用右上角打开“配置”面板。

界面内可配置：

- 模型配置：`provider`、`apiKey`、`apiUrl`、`model`、`systemPrompt`
- 联网配置：`webSearchProvider`、Tavily / Exa Key、结果数量、搜索深度

也可以通过环境变量提供联网 Key：

- `TAVILY_API_KEY`
- `EXA_API_KEY`

说明：

- 如果你使用 `responses`，当前默认提供商应设为 `openai`
- 当提供商为 `openai` 且端点类型切到 `responses` 时，“模型内置”会出现在联网方式可选项里
- 是否开启联网、以及是否选择“模型内置”，都由用户手动决定，前端不会自动切换当前联网方式

## 环境变量

| 变量名 | 作用 | 默认值 |
| --- | --- | --- |
| `PRISM_PORT` | 本地服务或 Docker 对外暴露端口 | `3000` |
| `TAVILY_API_KEY` | Tavily 联网搜索 Key，可选 | 空 |
| `EXA_API_KEY` | Exa 联网搜索 Key，可选 | 空 |
| `PRISM_DESKTOP_API_BASE` | 桌面开发态后端地址，可选 | 桌面内置默认值 |

## 技术栈

- 前端：HTML、CSS、JavaScript、marked.js、highlight.js
- 后端：FastAPI、httpx、Nuitka
- 桌面端：Tauri 2

## 项目结构

```text
Prism/
├── ai/                    # AI 编排、Provider 适配、流解析与服务层
├── frontend/              # 静态前端资源
├── routes/                # FastAPI 路由模块
├── scripts/               # 桌面开发与打包脚本
├── src-tauri/             # Tauri 桌面壳与打包配置
├── tests/                 # 预留的 pytest 风格测试目录
├── server.py              # FastAPI 入口
├── tools.py               # 本地工具执行逻辑
├── tools.json             # 工具定义元数据
├── config.py              # 运行参数解析
├── runtime_paths.py       # 运行时路径定位
├── desktop_logging.py     # 桌面端日志初始化
├── docker-compose.yml     # 容器部署配置
├── .env.example           # 环境变量模板
└── README.zh-CN.md
```
