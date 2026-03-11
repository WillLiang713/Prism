# server.py 重构计划

## 现状

`server.py` 共 **704 行**，承担了太多职责：桌面端日志、静态文件服务、多个业务 API、代理转发、启动入口等全部挤在一个文件里。随着功能增长，维护和阅读成本越来越高。

## 目标

将 `server.py` 拆分为多个职责清晰的模块，使主文件只保留 **应用组装 + 路由注册 + 启动入口**，预计缩减到 ~80 行以内。

---

## 拆分方案

### 1. `routes/static.py` — 静态文件路由

**搬迁内容（约 80 行）：**
- `_ensure_frontend_asset()` 函数
- `_render_index_html()` 函数
- 所有静态文件路由：`/`、`/index.html`、`/style.css`、`/app.js`、`/favicon.svg`、`/favicon.ico`

**对外接口：**
- 导出一个 `APIRouter`，在 `server.py` 中通过 `app.include_router()` 注册

---

### 2. `routes/search.py` — 搜索 API（Tavily + Exa）

**搬迁内容（约 94 行）：**
- `TavilySearchRequest` 模型
- `tavily_search()` 路由处理函数
- `ExaSearchRequest` 模型
- `exa_search()` 路由处理函数

**对外接口：**
- 导出一个 `APIRouter`（前缀 `/api`）

---

### 3. `routes/models.py` — 模型列表 API

**搬迁内容（约 114 行）：**
- `ModelListRequest` 模型
- `normalize_api_url()` 辅助函数
- `build_models_base_url()` 辅助函数
- `list_models()` 路由处理函数

**对外接口：**
- 导出一个 `APIRouter`（前缀 `/api`）

---

### 4. `routes/topics.py` — 话题标题生成 API

**搬迁内容（约 169 行）：**
- `GenerateTitleRequest` 模型
- `_normalize_compare_text()` 等标题清洗辅助函数（共 5 个）
- `generate_topic_title()` 路由处理函数

**对外接口：**
- 导出一个 `APIRouter`（前缀 `/api`）

---

### 5. `routes/chat.py` — AI 聊天流式接口

**搬迁内容（约 17 行）：**
- `chat_stream()` 路由处理函数

**对外接口：**
- 导出一个 `APIRouter`（前缀 `/api`）

---

### 6. `routes/tools.py` — 工具 API

**搬迁内容（约 20 行）：**
- `get_tools()` 路由
- `execute_tool_endpoint()` 路由

**对外接口：**
- 导出一个 `APIRouter`（前缀 `/api`）

---

### 7. `routes/proxy.py` — 通配符代理

**搬迁内容（约 50 行）：**
- `proxy()` 路由处理函数

**对外接口：**
- 导出一个 `APIRouter`

**注意：** 通配符代理路由必须最后注册，在 `server.py` 中确保 `include_router` 顺序正确。

---

### 8. `desktop_logging.py` — 桌面端日志（已有部分基础设施）

**搬迁内容（约 49 行）：**
- `_cleanup_old_desktop_logs()` 函数
- `_desktop_log_path()` 函数
- `_init_desktop_release_logging()` 函数
- 相关全局变量：`DESKTOP_LOG_RETENTION_DAYS`、`DESKTOP_LOG_STREAM`

**对外接口：**
- `init_desktop_release_logging(is_release_mode: bool) -> None`

---

### 9. `config.py` — 运行时配置

**搬迁内容（约 20 行）：**
- `_parse_runtime_args()` 函数
- `RUNTIME_ARGS`、`DESKTOP_MODE`、`DESKTOP_RELEASE_MODE`、`BUILD_ID` 等全局常量

**对外接口：**
- 导出各个配置常量，供其他模块 import 使用

---

## 重构后的 `server.py` 结构（预计 ~80 行）

```python
"""Prism - CORS代理服务器"""

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import RUNTIME_ARGS, DESKTOP_MODE, DESKTOP_RELEASE_MODE, BUILD_ID
from desktop_logging import init_desktop_release_logging
from runtime_paths import frontend_path, has_frontend_assets

# 初始化桌面端日志
init_desktop_release_logging(DESKTOP_RELEASE_MODE)

# 创建 FastAPI 应用
app = FastAPI(title="CORS代理服务器")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

if has_frontend_assets() and frontend_path("libs").exists():
    app.mount("/libs", StaticFiles(directory=str(frontend_path("libs"))), name="libs")

# 注册路由（注意顺序：通配符代理必须最后）
from routes.static import router as static_router
from routes.tools import router as tools_router
from routes.search import router as search_router
from routes.models import router as models_router
from routes.topics import router as topics_router
from routes.chat import router as chat_router
from routes.proxy import router as proxy_router

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "mode": "desktop" if DESKTOP_MODE else "web", "buildId": BUILD_ID}

app.include_router(static_router)
app.include_router(tools_router)
app.include_router(search_router)
app.include_router(models_router)
app.include_router(topics_router)
app.include_router(chat_router)
app.include_router(proxy_router)  # 必须最后注册

if __name__ == "__main__":
    import uvicorn
    print("=" * 50)
    print("服务器已启动")
    print("=" * 50)
    print(f"访问地址: http://{RUNTIME_ARGS.host}:{RUNTIME_ARGS.port}")
    print("=" * 50)
    uvicorn.run(app, host=RUNTIME_ARGS.host, port=RUNTIME_ARGS.port)
```

---

## 文件结构预览

```
Prism/
├── server.py              ← 主文件（~80 行，只负责组装）
├── config.py              ← 运行时配置与常量
├── desktop_logging.py     ← 桌面端日志初始化
├── runtime_paths.py       ← 已有，路径工具
├── ai/                    ← 已有，AI 服务
├── routes/
│   ├── __init__.py
│   ├── static.py          ← 静态文件路由
│   ├── tools.py           ← 工具 API
│   ├── search.py          ← Tavily + Exa 搜索
│   ├── models.py          ← 模型列表
│   ├── topics.py          ← 话题标题生成
│   ├── chat.py            ← AI 聊天流式接口
│   └── proxy.py           ← 通配符代理（最后注册）
└── ...
```

---

## 执行步骤

1. **新建 `routes/` 目录和 `__init__.py`**
2. **新建 `config.py`** — 搬迁参数解析和全局常量
3. **新建 `desktop_logging.py`** — 搬迁桌面端日志逻辑
4. **逐个创建路由模块** — 按上述方案搬迁代码，每个模块创建后即可测试
5. **改写 `server.py`** — 删除已搬出的代码，改为 import + include_router
6. **测试验证** — 启动服务器，确认所有接口正常工作

## 注意事项

- 每个路由模块使用 FastAPI 的 `APIRouter`，避免循环导入
- `config.py` 中的常量会被多个模块引用，确保它不依赖其他业务模块
- 通配符代理路由 **必须最后注册**，否则会拦截其他路由
- `health_check` 路由较短，可以留在 `server.py` 中，也可以单独拆出
