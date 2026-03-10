# Prism

Prism 是一个轻量的对话式 AI 客户端，提供统一的模型接入、联网搜索和会话管理能力。

## 下载与发布

- 仓库地址：<https://github.com/WillLiang713/Prism>
- Releases 页面：<https://github.com/WillLiang713/Prism/releases>
- 如果你只是想在 Windows 上直接使用桌面版，优先从 Releases 页面下载已发布的安装包
- 如果你需要参与开发或自行修改代码，再继续阅读下方的本地运行与打包说明

## 功能概览

- 模型对话与流式输出
- 支持 OpenAI 兼容与 Anthropic 兼容接口
- 思考强度设置与思考过程展示
- 联网搜索工具（Tavily / Exa）
- 会话与话题管理（本地保存历史）
- 新建话题快捷键：`Ctrl/Cmd + Alt + N`
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

## Tauri 桌面端（Windows 首版）

### 下载安装

如果你只是想使用桌面版，而不是参与开发：

1. 打开 Releases 页面：

```text
https://github.com/WillLiang713/Prism/releases
```

2. 下载最新发布版本中的 Windows 安装包

3. 安装后直接启动即可

如果你需要本地开发、调试或自行打包，再继续看下面的开发态与打包说明。

### 开发态

推荐命令：

```bash
npm install
npm run desktop:dev
```

这条命令会：

- 自动启动本地 Python 后端（默认 `127.0.0.1:33100`）
- 等待健康检查通过
- 再启动 Tauri 桌面壳
- 退出 Tauri 时自动停止后端进程

后端开发日志默认写到：

```bash
logs/desktop-dev-backend.stdout.log
logs/desktop-dev-backend.stderr.log
```

底层命令仍然保留：

```bash
python server.py --host 127.0.0.1 --port 33100
npm run tauri:dev
```

说明：

- 推荐日常开发优先使用 `npm run desktop:dev`
- `npm run tauri:dev` 是底层 Tauri 调试命令，本身不会帮你启动 Python 后端
- 如果已经激活 `venv`，请优先使用 `python`，不要用 `py -3`，否则可能绕过当前虚拟环境，导致依赖缺失

默认会把桌面端前端连接到 `http://127.0.0.1:33100`。如需改端口，可设置环境变量 `PRISM_DESKTOP_API_BASE`。

### Windows 打包

首次打包前需要安装：

- Rust / Cargo
- Visual Studio Build Tools（含 MSVC 与 Windows SDK）
- PyInstaller

打包命令：

```bash
npm run desktop:build
```

说明：

- 不建议直接执行 `npm run tauri:build`
- 推荐完整打包入口是 `npm run desktop:build`
- `desktop:build` 实际调用的是 `scripts/build-tauri-windows.ps1`
- 该脚本会先用 `PyInstaller` 生成 `prism-backend.exe` sidecar，再执行 `npm install` 和 `npm run tauri:build`
- 只有走这条脚本，桌面包里才会带上最新的 Python 后端可执行文件

当前打包行为：

- `prism-backend.exe` 以无控制台方式启动，正常情况下不会再弹出黑色命令行窗口
- 桌面端主界面会先显示，后端在后台完成健康检查后自动进入可用状态
- 后端启动过程中不再显示全屏 Loading 或头部等待提示；未就绪前仅禁用输入框和发送按钮
- 如果本地后端启动失败，当前版本不会显示额外提示胶囊，需重启应用后重试

### 桌面端日志

Windows 打包版后端日志默认写入：

```text
%LOCALAPPDATA%\Prism\logs\
```

日志说明：

- 按天生成，文件名形如 `backend-2026-03-10.log`
- 应用启动时会自动清理 7 天前的旧日志
- 主要用于排查桌面端后端启动失败、接口异常、未捕获异常等问题

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
