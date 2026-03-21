"""
Prism - CORS代理服务器
"""

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import BUILD_ID, DESKTOP_MODE, DESKTOP_RELEASE_MODE, RUNTIME_ARGS
from desktop_logging import init_desktop_release_logging

from routes.chat import router as chat_router
from routes.models import router as models_router
from routes.proxy import router as proxy_router
from routes.responses import router as responses_router
from routes.search import router as search_router
from routes.static import router as static_router
from routes.tools import router as tools_router
from routes.topics import router as topics_router


init_desktop_release_logging(DESKTOP_RELEASE_MODE)

app = FastAPI(title="CORS代理服务器")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "mode": "desktop" if DESKTOP_MODE else "web",
        "buildId": BUILD_ID,
    }


app.include_router(static_router)
app.include_router(tools_router)
app.include_router(search_router)
app.include_router(models_router)
app.include_router(topics_router)
app.include_router(chat_router)
app.include_router(responses_router)
app.include_router(proxy_router)


if __name__ == "__main__":
    import uvicorn

    print("=" * 50)
    print("服务器已启动")
    print("=" * 50)
    print(f"访问地址: http://{RUNTIME_ARGS.host}:{RUNTIME_ARGS.port}")
    print("=" * 50)
    uvicorn.run(app, host=RUNTIME_ARGS.host, port=RUNTIME_ARGS.port)
