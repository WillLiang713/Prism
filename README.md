# Prism

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

[简体中文](./README.zh-CN.md)

Prism is a lightweight AI chat client with a Python backend and a static frontend. It provides unified model access, web search tools, local topic management, and a Windows desktop build powered by Tauri.

## Download

- Repository: <https://github.com/WillLiang713/Prism>
- Releases: <https://github.com/WillLiang713/Prism/releases>
- If you only want to use the Windows desktop app, download the latest installer from Releases.
- If you want to develop locally or customize the project, continue with the setup instructions below.

## Highlights

- Streaming chat responses
- OpenAI-compatible, Anthropic-compatible, and Gemini API support
- Web search integration with Tavily and Exa
- Topic-based conversation management with local history
- Reasoning effort controls and reasoning display
- Markdown rendering and code highlighting
- Image upload support
- Quick new-topic shortcut: `Ctrl + Alt + O`

## Quick Start

### Run the web app locally

1. Install Python dependencies:

```bash
pip install -r requirements.txt
```

If the repo already includes `venv/`, Windows users should preferably reuse it:

```bash
.\venv\Scripts\python.exe -m pip install -r requirements.txt
```

2. Start the server:

```bash
npm run dev:web
```

If you need to run it directly without npm, Windows users can still use:

```bash
.\venv\Scripts\python.exe server.py
```

3. Open the app in your browser:

```text
http://localhost:3000
```

### Run with Docker

```bash
docker compose up --build
```

The app will be available on the port defined by `PRISM_PORT` in your environment, or `3000` by default.

## Windows Desktop App (Tauri)

### Use a released build

If you just want to use Prism on Windows:

1. Open the Releases page:

```text
https://github.com/WillLiang713/Prism/releases
```

2. Download the latest Windows installer.
3. Install and launch the app.

### Desktop development

Recommended command:

```bash
npm install
npm run dev:desktop
```

This workflow will:

- start the local Python backend automatically on `127.0.0.1:33100`
- wait for the health check to pass
- load the desktop dev window from the backend-served page and static assets to avoid stale desktop-only frontend cache
- launch the Tauri shell
- stop the backend process when Tauri exits

Development backend logs are written to:

```text
logs/desktop-dev-backend.stdout.log
logs/desktop-dev-backend.stderr.log
```

Notes:

- `npm run dev:desktop` is the recommended daily workflow.
- If you already activated a virtual environment, prefer `python` over `py -3` so you do not bypass the active environment.
- The desktop frontend connects to `http://127.0.0.1:33100` by default. Set `PRISM_DESKTOP_API_BASE` if you need a different backend URL.

### Build the Windows desktop app

Before the first build, install:

- Rust / Cargo
- Visual Studio Build Tools with MSVC and Windows SDK
- Nuitka

Build command:

```bash
npm run build
```

Notes:

- Use `npm run build` as the only packaged desktop build entry point.
- The build entry point is `scripts/build-tauri-windows.ps1`.
- The script now performs a full local rebuild by clearing `node_modules`, `src-tauri\\target`, `build`, `dist`, repo logs, and Python cache before reinstalling dependencies.
- The script first packages the Python runtime into `prism-runtime.exe`, then runs the Tauri build.
- This is the path that ensures the desktop package includes the latest backend sidecar.

Current desktop packaging behavior:

- `prism-runtime.exe` starts without opening a visible console window
- the desktop UI appears first and becomes interactive after backend health checks pass
- the app disables the input and send button while the backend is not ready
- if the local backend fails to start, restart the app and check logs

### Desktop logs

Packaged Windows backend logs are written to:

```text
%LOCALAPPDATA%\Prism\logs\
```

Behavior:

- log files are rotated daily, for example `backend-2026-03-10.log`
- logs older than 7 days are cleaned up automatically on startup
- logs help diagnose backend startup failures, API errors, and uncaught exceptions

## Configuration

Open the configuration panel from the top-right corner of the app.

UI configuration covers:

- Model settings: `provider`, `apiKey`, `apiUrl`, `model`, `systemPrompt`
- Web search settings: `webSearchProvider`, Tavily / Exa keys, result count, and search depth

You can also provide search keys through environment variables:

- `TAVILY_API_KEY`
- `EXA_API_KEY`

Notes:

- If you use `responses`, the default provider should currently be `openai`.
- When the provider is `openai` and the endpoint mode switches to `responses`, `builtin` becomes available as a web-search option.
- Whether web search is enabled, and whether `builtin` is selected, is still controlled manually by the user. The frontend does not auto-switch the current web-search mode.

## Environment Variables

| Name | Purpose | Default |
| --- | --- | --- |
| `PRISM_PORT` | Public port used by the local server or Docker mapping | `3000` |
| `TAVILY_API_KEY` | Optional Tavily API key for web search | empty |
| `EXA_API_KEY` | Optional Exa API key for web search | empty |
| `PRISM_DESKTOP_API_BASE` | Optional desktop backend base URL for development | built-in desktop default |

## Tech Stack

- Frontend: HTML, CSS, JavaScript, marked.js, highlight.js
- Backend: FastAPI, httpx, Nuitka
- Desktop: Tauri 2

## Project Structure

```text
Prism/
├── ai/                    # AI orchestration, provider adapters, parsers, and services
├── frontend/              # Static UI assets
├── routes/                # FastAPI route modules
├── scripts/               # Desktop dev/build scripts
├── src-tauri/             # Tauri desktop shell and packaging config
├── tests/                 # Reserved pytest-style test directory
├── server.py              # FastAPI entry point
├── tools.py               # Local tool execution logic
├── tools.json             # Tool definition metadata
├── config.py              # Runtime argument parsing
├── runtime_paths.py       # Runtime path resolution
├── desktop_logging.py     # Desktop logging bootstrap
├── docker-compose.yml     # Container setup
├── .env.example           # Environment variable template
└── README.md
```

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
