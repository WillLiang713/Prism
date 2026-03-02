# Repository Guidelines

## Project Structure & Module Organization
This repository is a lightweight AI chat client with a Python backend and static frontend.

- `server.py`: FastAPI entry point, static file serving, and API routes (chat, models, tools).
- `ai_service.py`: model request orchestration and streaming response handling.
- `tools.py` / `tools.json`: web-search tool implementations and tool definitions.
- `frontend/`: UI assets (`index.html`, `app.js`, `style.css`, and vendored libs in `frontend/libs/`).
- `docs/`: implementation notes and bug writeups.
- `.env.example`: environment variable template.

Keep backend behavior in Python modules and keep UI-only logic in `frontend/app.js`.

## Build, Test, and Development Commands
- `pip install -r requirements.txt`: install runtime dependencies.
- `python server.py`: run local server at `http://localhost:3000`.
- `uvicorn server:app --host 0.0.0.0 --port 3000 --reload`: dev mode with auto-reload.
- `docker compose up --build`: build and run the containerized app.
- `python -m py_compile server.py ai_service.py tools.py`: quick syntax check before commit.

## Coding Style & Naming Conventions
- Python: 4-space indentation, `snake_case` for functions/variables, `PascalCase` for classes.
- JavaScript: `camelCase` for variables/functions, `UPPER_SNAKE_CASE` for top-level constants.
- Keep functions focused and avoid mixing route wiring with tool/business logic.
- Follow existing formatting style in touched files; do not introduce unrelated reformatting.

## Testing Guidelines
There is currently no committed automated test suite.

- Add backend tests under `tests/` with `pytest` naming: `test_*.py`.
- Prioritize route-level regression tests for changed endpoints (for example `/api/chat/stream`).
- Minimum manual check before PR:
  1. Start server and load `http://localhost:3000`.
  2. Verify chat send/stream works.
  3. Verify model list and tool endpoints return expected data.

## Commit & Pull Request Guidelines
Recent history uses concise, type-led messages such as `feat(frontend): ...`, `style: ...`, `修复：...`, `优化：...`.

- Prefer `<type>(scope): summary` (scope optional).
- Keep each commit focused on one concern.
- PRs should include: purpose, key changes, verification steps, linked issue/doc, and screenshots for UI changes.

## Security & Configuration Tips
- Never commit secrets; use `.env` (based on `.env.example`).
- Configure `TAVILY_API_KEY` and `EXA_API_KEY` via environment variables, not hardcoded values.

## Agent Communication Preferences
- Respond in Chinese by default when interacting with the user.
- Provide a step-by-step execution plan first, then let the user decide whether to proceed to the next step.
- Avoid heavy jargon; explain technical points in plain language without assuming deep prior knowledge.
