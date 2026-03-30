# Repository Guidelines
仓库指南（Repository Guidelines）

## Project Structure & Module Organization
This repository is a lightweight AI chat client with a Python backend, a modular static frontend, and a Windows desktop shell powered by Tauri.
项目结构与模块组织
本仓库是一个轻量级 AI 对话客户端，后端使用 Python，前端为模块化静态页面，并提供基于 Tauri 的 Windows 桌面壳。

- `server.py`: FastAPI entry point, CORS setup, health check, and route registration.
- `server.py`：FastAPI 入口，负责 CORS、中控健康检查与各路由挂载。
- `routes/`: HTTP route modules, including `chat.py`, `responses.py`, `models.py`, `topics.py`, `search.py`, `tools.py`, `proxy.py`, and `static.py`.
- `routes/`：按功能拆分的接口路由模块，包括 `chat.py`、`responses.py`、`models.py`、`topics.py`、`search.py`、`tools.py`、`proxy.py`、`static.py`。
- `ai/`: AI request models, provider URL/header adaptation, stream parsing, and chat/responses orchestration.
- `ai/`：AI 相关核心逻辑，包含请求模型、Provider 适配、流解析与聊天/Responses 编排。
- `tools.py` / `tools.json`: local tool execution and tool definition metadata.
- `tools.py` / `tools.json`：本地工具执行逻辑与工具定义元数据。
- `frontend/`: web UI assets; entry files stay at the top level, while feature logic is split across `frontend/js/` and `frontend/css/`.
- `frontend/`：Web 前端资源目录；入口文件保留在顶层，功能逻辑拆分在 `frontend/js/` 与 `frontend/css/`。
- `src-tauri/`: Tauri desktop shell, Rust entry points, capabilities, and packaging configuration.
- `src-tauri/`：Tauri 桌面端外壳、Rust 入口、能力声明与打包配置。
- `scripts/`: desktop development/build scripts such as `dev-tauri-windows.ps1` and `build-tauri-windows.ps1`.
- `scripts/`：桌面端开发与构建脚本，如 `dev-tauri-windows.ps1`、`build-tauri-windows.ps1`。
- `config.py` / `runtime_paths.py` / `desktop_logging.py`: runtime argument parsing, path resolution, and desktop log setup.
- `config.py` / `runtime_paths.py` / `desktop_logging.py`：运行参数解析、路径定位与桌面端日志初始化。
- `docs/`: implementation notes, plans, and bug writeups.
- `docs/`：实现说明、规划文档与缺陷复盘。
- `.env.example`: environment variable template.
- `.env.example`：环境变量模板。

Keep HTTP wiring inside `routes/`, model/provider orchestration inside `ai/`, tool code in `tools.py`, and UI-only logic in `frontend/js/` plus `frontend/css/`.
路由装配放在 `routes/`，模型与 Provider 编排放在 `ai/`，工具逻辑放在 `tools.py`，纯 UI 逻辑放在 `frontend/js/` 与 `frontend/css/`。

## Build, Test, and Development Commands
- Prefer the existing repo-local virtual environment first. This repository already has `venv/` with the needed Python dependencies; before installing or running backend commands, check `.\venv\Scripts\python.exe` first and use it instead of the global `python` when available.
- 优先复用仓库内现成的虚拟环境。本仓库已存在带依赖的 `venv/`；执行后端相关命令或安装依赖前，先检查并优先使用 `.\venv\Scripts\python.exe`，不要默认使用全局 `python`。
- `pip install -r requirements.txt`: install Python runtime dependencies.
- `pip install -r requirements.txt`：安装 Python 运行依赖。
- `.\venv\Scripts\python.exe -m pip install -r requirements.txt`: use this only when the repo-local virtual environment is missing dependencies.
- `.\venv\Scripts\python.exe -m pip install -r requirements.txt`：仅当仓库内虚拟环境缺少依赖时再执行。
- `python server.py`: run the local web server (default `http://localhost:3000`).
- `python server.py`：启动本地 Web 服务（默认地址 `http://localhost:3000`）。
- `.\venv\Scripts\python.exe server.py`: preferred backend start command on Windows for this repo.
- `.\venv\Scripts\python.exe server.py`：本仓库在 Windows 下优先使用的后端启动命令。
- `python server.py --host 0.0.0.0 --port 3000`: run with explicit host/port.
- `python server.py --host 0.0.0.0 --port 3000`：使用显式 host/port 启动服务。
- `uvicorn server:app --host 0.0.0.0 --port 3000 --reload`: backend dev mode with auto-reload.
- `uvicorn server:app --host 0.0.0.0 --port 3000 --reload`：后端开发模式启动（自动重载）。
- `docker compose up --build`: build and run the containerized web app.
- `docker compose up --build`：构建并启动容器化 Web 应用。
- `npm install`: install Tauri desktop dependencies.
- `npm install`：安装 Tauri 桌面端依赖。
- `npm run desktop:dev`: recommended Windows desktop development workflow; starts backend and Tauri shell together.
- `npm run desktop:dev`：推荐的 Windows 桌面端开发命令；会同时拉起后端与 Tauri 壳。
- `npm run desktop:build`: build the packaged Windows desktop app with the bundled backend.
- `npm run desktop:build`：构建带后端 sidecar 的 Windows 桌面安装包。
- `python -m compileall server.py config.py runtime_paths.py desktop_logging.py ai routes tools.py`: quick syntax check before commit.
- `python -m compileall server.py config.py runtime_paths.py desktop_logging.py ai routes tools.py`：提交前快速做一次语法检查。

## Coding Style & Naming Conventions
- Python: 4-space indentation, `snake_case` for functions/variables, `PascalCase` for classes.
- Python：4 空格缩进；函数/变量使用 `snake_case`；类名使用 `PascalCase`。
- JavaScript: `camelCase` for variables/functions, `UPPER_SNAKE_CASE` for top-level constants.
- JavaScript：变量/函数使用 `camelCase`；顶层常量使用 `UPPER_SNAKE_CASE`。
- Rust/Tauri: follow the existing `src-tauri/` style and keep desktop shell changes narrowly scoped.
- Rust/Tauri：遵循 `src-tauri/` 现有风格，桌面端改动尽量保持边界清晰。
- Keep functions focused and avoid mixing route wiring, provider adaptation, and tool/business logic.
- 函数应职责单一，避免把路由绑定、Provider 适配与业务/工具逻辑混写。
- Follow existing formatting style in touched files; do not introduce unrelated reformatting.
- 修改代码时遵循现有格式，不做无关的大范围格式化。
- Do not add, delete, or modify existing styles without the user's explicit permission.
- 未经用户明确允许，不得随意新增、删除或修改已经写好的样式。

## Testing Guidelines
There is currently no committed, active automated test source in `tests/`; the directory is reserved for pytest-style regression tests.
测试规范
当前 `tests/` 目录已预留，但仓库里没有已提交且可直接维护的自动化测试源码；后续测试统一按 pytest 风格补充。

- Add backend tests under `tests/` using `pytest` naming: `test_*.py`.
- 新增后端测试请放在 `tests/` 目录，命名使用 `pytest` 约定：`test_*.py`。
- Prioritize route-level regression tests for changed endpoints such as `/api/chat/stream`, `/api/responses/stream`, `/api/models/list`, and topic-related APIs.
- 优先为改动过的接口添加路由级回归测试，例如 `/api/chat/stream`、`/api/responses/stream`、`/api/models/list` 与主题相关接口。
- Run `python -m pytest` when test files are present.
- 当存在测试文件时，使用 `python -m pytest` 执行测试。
- For browser automation checks, first start the backend with `.\venv\Scripts\python.exe server.py`, wait until `http://127.0.0.1:3000/api/health` returns `{"status":"ok",...}`, then run browser automation against `http://127.0.0.1:3000/`. After verification, stop the temporary backend process.
- 执行浏览器自动化验证时，先用 `.\venv\Scripts\python.exe server.py` 启动后端，确认 `http://127.0.0.1:3000/api/health` 返回 `{"status":"ok",...}` 后，再对 `http://127.0.0.1:3000/` 运行浏览器自动化；验证结束后记得停止临时启动的后端进程。
- When running browser automation from PowerShell, prefer starting the backend as a background process with redirected logs so the test can continue in the same session.
- 在 PowerShell 中做浏览器自动化时，优先把后端作为带日志重定向的后台进程启动，便于同一会话继续执行测试。
- Minimum manual check before PR:
- PR 前至少手动验证：
  1. Start the backend and open `http://localhost:3000`.
  1. 启动后端并打开 `http://localhost:3000`。
  2. Verify model loading, chat send/stream, and any touched tool or search flow work as expected.
  2. 验证模型加载、聊天发送/流式输出，以及本次改动涉及的工具或搜索流程正常。
  3. If desktop-related code changed, run `npm run desktop:dev` and confirm the desktop shell can connect to the backend.
  3. 如果改动涉及桌面端，执行 `npm run desktop:dev` 并确认桌面壳能正常连接后端。

## Commit & Pull Request Guidelines
Recent history uses concise, type-led messages such as `feat(frontend): ...`, `style: ...`, `修复：...`, `优化：...`.
提交与 Pull Request 规范
近期提交信息风格简短且带类型前缀，例如 `feat(frontend): ...`、`style: ...`、`修复：...`、`优化：...`。

- Prefer `<type>(scope): summary` (scope optional).
- 推荐使用 `<type>(scope): summary`（`scope` 可选）。
- Keep each commit focused on one concern.
- 每个 commit 聚焦一个改动点。
- PRs should include: purpose, key changes, verification steps, linked issue/doc, and screenshots for UI changes.
- PR 需包含：目标说明、关键改动、验证步骤、关联 issue/文档；UI 改动需附截图。

## Security & Configuration Tips
- Never commit secrets; use `.env` (based on `.env.example`) or local runtime environment variables.
- 不要提交任何密钥；请使用 `.env`（参考 `.env.example`）或本地环境变量。
- Configure `TAVILY_API_KEY` and `EXA_API_KEY` via environment variables, not hardcoded values.
- `TAVILY_API_KEY` 和 `EXA_API_KEY` 应通过环境变量配置，禁止硬编码。
- `PRISM_PORT` controls the exposed server port; `PRISM_HOST` can override the bind host when needed.
- `PRISM_PORT` 控制服务端口；如有需要，可通过 `PRISM_HOST` 覆盖监听地址。
- `PRISM_DESKTOP_API_BASE` is for desktop development overrides and should not be hardcoded into frontend code.
- `PRISM_DESKTOP_API_BASE` 用于桌面开发时覆盖后端地址，不应硬编码进前端代码。

## Agent Communication Preferences
- Respond in Chinese by default when interacting with the user.
- 与用户交互时默认使用中文回复。
- Avoid heavy jargon; explain technical points in plain language without assuming deep prior knowledge.
- 避免大量术语；解释时尽量通俗，不假设用户具备深厚技术背景。
- When the user raises a question or request, first propose the most effective solution with the smallest necessary change, and wait for the user's approval before making edits or taking action.
- 当用户提出问题或需求时，先优先给出改动最小但效果最好的方案，并在用户明确同意后再进行修改或执行操作。

## Difficult Bug Investigation
复杂问题排查

- Prioritize Context7 for official framework/library docs, and GitHub Issues/Discussions/PRs for real-world reports and fixes; do not rely only on local intuition when symptoms are hard to explain.
- 查资料时统一优先使用 Context7 获取框架或库的官方文档，使用 GitHub Issues / Discussions / PR 查真实案例与修复思路；当现象反直觉时，不要只凭本地经验判断。
- When presenting the diagnosis, clearly separate confirmed facts, likely inferences, and external references that inspired the hypothesis.
- 输出诊断结论时，要明确区分：已经确认的事实、基于证据的推断，以及作为启发来源的外部案例。
