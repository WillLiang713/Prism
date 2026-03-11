from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ai import AIService, ChatRequest


router = APIRouter(prefix="/api")


@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    return StreamingResponse(
        AIService.chat_stream(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

