from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from ai import AIService, ChatRequest


router = APIRouter(prefix="/api")


@router.post("/responses/stream")
async def responses_stream(request: ChatRequest):
    return StreamingResponse(
        AIService.responses_stream(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
