# 仓库指南（Repository Guidelines）

## 项目结构与模块组织
本仓库是一个轻量级 AI 对话客户端，后端使用 Python，前端为静态页面。

- `server.py`：FastAPI 入口，负责静态文件服务与 API 路由（chat、models、tools）。
- `ai_service.py`：模型请求编排与流式响应处理。
- `tools.py` / `tools.json`：联网搜索工具实现与工具定义。
- `frontend/`：前端资源（`index.html`、`app.js`、`style.css`，以及 `frontend/libs/` 下的第三方库）。
- `docs/`：实现说明与缺陷复盘文档。
- `.env.example`：环境变量模板。

后端逻辑应放在 Python 模块中，纯 UI 逻辑应放在 `frontend/app.js`。

## 构建、测试与开发命令
- `pip install -r requirements.txt`：安装运行依赖。
- `python server.py`：本地启动服务，地址为 `http://localhost:3000`。
- `uvicorn server:app --host 0.0.0.0 --port 3000 --reload`：开发模式启动（支持自动重载）。
- `docker compose up --build`：构建并启动容器化应用。
- `python -m py_compile server.py ai_service.py tools.py`：提交前做快速语法检查。

## 代码风格与命名规范
- Python：4 空格缩进；函数/变量使用 `snake_case`；类名使用 `PascalCase`。
- JavaScript：变量/函数使用 `camelCase`；顶层常量使用 `UPPER_SNAKE_CASE`。
- 函数应职责单一，避免把路由绑定与业务/工具逻辑混写。
- 修改代码时遵循现有格式，不做无关的大范围格式化。

## 测试规范
当前仓库尚未提交自动化测试套件。

- 新增后端测试请放在 `tests/` 目录，命名使用 `pytest` 约定：`test_*.py`。
- 优先为改动过的接口添加路由级回归测试（例如 `/api/chat/stream`）。
- PR 前至少手动验证：
  1. 启动服务并打开 `http://localhost:3000`。
  2. 验证聊天发送与流式输出正常。
  3. 验证模型列表与工具接口返回符合预期。

## 提交与 Pull Request 规范
近期提交信息风格简短且带类型前缀，例如 `feat(frontend): ...`、`style: ...`、`修复：...`、`优化：...`。

- 推荐使用 `<type>(scope): summary`（`scope` 可选）。
- 每个 commit 聚焦一个改动点。
- PR 需包含：目标说明、关键改动、验证步骤、关联 issue/文档；UI 改动需附截图。

## 安全与配置提示
- 不要提交任何密钥；使用 `.env`（参考 `.env.example`）。
- `TAVILY_API_KEY` 和 `EXA_API_KEY` 应通过环境变量配置，禁止硬编码。

## Agent 沟通偏好
- 与用户交互时默认使用中文回复。
- 先给出分步执行方案，再由用户决定是否继续下一步。
- 避免大量术语；解释时尽量通俗，不假设用户具备深厚技术背景。
