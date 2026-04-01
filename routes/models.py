from fastapi import APIRouter
from pydantic import BaseModel, Field

from ai.services import ModelService


router = APIRouter(prefix="/api")


class ModelListRequest(BaseModel):
    provider: str = Field(default="openai")
    apiKey: str | None = None
    apiUrl: str | None = None
    model: str | None = None


@router.post("/models/list")
async def list_models(payload: ModelListRequest):
    return await ModelService.list_models(payload)
