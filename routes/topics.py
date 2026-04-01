from fastapi import APIRouter
from pydantic import BaseModel, Field

from ai.services import TopicService


router = APIRouter(prefix="/api")


class GenerateTitleRequest(BaseModel):
    provider: str = Field(default="openai")
    apiKey: str | None = None
    model: str | None = None
    apiUrl: str | None = None
    messages: list[dict[str, str]]


@router.post("/topics/generate-title")
async def generate_topic_title(payload: GenerateTitleRequest):
    return await TopicService.generate_title(payload)
