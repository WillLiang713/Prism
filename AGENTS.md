# Repository Guidelines
仓库指南（Repository Guidelines）

## Project Structure & Module Organization
This repository is a lightweight AI chat client with a Python backend and static frontend.
项目结构与模块组织  
本仓库是一个轻量级 AI 对话客户端，后端使用 Python，前端为静态页面。

- `server.py`: FastAPI entry point, static file serving, and API routes (chat, models, tools).
- `server.py`：FastAPI 入口，负责静态文件服务与 API 路由（chat、models、tools）。
- `ai_service.py`: model request orchestration and streaming response handling.
- `ai_service.py`：模型请求编排与流式响应处理。
- `tools.py` / `tools.json`: web-search tool implementations and tool definitions.
- `tools.py` / `tools.json`：联网搜索工具实现与工具定义。
- `frontend/`: UI assets (`index.html`, `app.js`, `style.css`, and vendored libs in `frontend/libs/`).
- `frontend/`：前端资源（`index.html`、`app.js`、`style.css`，以及 `frontend/libs/` 下的第三方库）。
- `docs/`: implementation notes and bug writeups.
- `docs/`：实现说明与缺陷复盘文档。
- `.env.example`: environment variable template.
- `.env.example`：环境变量模板。

Keep backend behavior in Python modules and keep UI-only logic in `frontend/app.js`.
后端逻辑应放在 Python 模块中，纯 UI 逻辑应放在 `frontend/app.js`。

## Build, Test, and Development Commands
- `pip install -r requirements.txt`: install runtime dependencies.
- `pip install -r requirements.txt`：安装运行依赖。
- `python server.py`: run local server at `http://localhost:3000`.
- `python server.py`：本地启动服务，地址为 `http://localhost:3000`。
- `uvicorn server:app --host 0.0.0.0 --port 3000 --reload`: dev mode with auto-reload.
- `uvicorn server:app --host 0.0.0.0 --port 3000 --reload`：开发模式启动（支持自动重载）。
- `docker compose up --build`: build and run the containerized app.
- `docker compose up --build`：构建并启动容器化应用。
- `python -m py_compile server.py ai_service.py tools.py`: quick syntax check before commit.
- `python -m py_compile server.py ai_service.py tools.py`：提交前做快速语法检查。

## Coding Style & Naming Conventions
- Python: 4-space indentation, `snake_case` for functions/variables, `PascalCase` for classes.
- Python：4 空格缩进；函数/变量使用 `snake_case`；类名使用 `PascalCase`。
- JavaScript: `camelCase` for variables/functions, `UPPER_SNAKE_CASE` for top-level constants.
- JavaScript：变量/函数使用 `camelCase`；顶层常量使用 `UPPER_SNAKE_CASE`。
- Keep functions focused and avoid mixing route wiring with tool/business logic.
- 函数应职责单一，避免把路由绑定与业务/工具逻辑混写。
- Follow existing formatting style in touched files; do not introduce unrelated reformatting.
- 修改代码时遵循现有格式，不做无关的大范围格式化。

## Testing Guidelines
There is currently no committed automated test suite.
测试规范  
当前仓库尚未提交自动化测试套件。

- Add backend tests under `tests/` with `pytest` naming: `test_*.py`.
- 新增后端测试请放在 `tests/` 目录，命名使用 `pytest` 约定：`test_*.py`。
- Prioritize route-level regression tests for changed endpoints (for example `/api/chat/stream`).
- 优先为改动过的接口添加路由级回归测试（例如 `/api/chat/stream`）。
- Minimum manual check before PR:
- PR 前至少手动验证：
  1. Start server and load `http://localhost:3000`.
  1. 启动服务并打开 `http://localhost:3000`。
  2. Verify chat send/stream works.
  2. 验证聊天发送与流式输出正常。
  3. Verify model list and tool endpoints return expected data.
  3. 验证模型列表与工具接口返回符合预期。

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
- Never commit secrets; use `.env` (based on `.env.example`).
- 不要提交任何密钥；使用 `.env`（参考 `.env.example`）。
- Configure `TAVILY_API_KEY` and `EXA_API_KEY` via environment variables, not hardcoded values.
- `TAVILY_API_KEY` 和 `EXA_API_KEY` 应通过环境变量配置，禁止硬编码。

## Agent Communication Preferences
- Respond in Chinese by default when interacting with the user.
- 与用户交互时默认使用中文回复。
- Provide a step-by-step execution plan first, then let the user decide whether to proceed to the next step.
- 先给出分步执行方案，再由用户决定是否继续下一步。
- Avoid heavy jargon; explain technical points in plain language without assuming deep prior knowledge.
- 避免大量术语；解释时尽量通俗，不假设用户具备深厚技术背景。
