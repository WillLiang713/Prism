import json

from fastapi import APIRouter, HTTPException, Request

from runtime_paths import TOOLS_JSON_PATH


router = APIRouter(prefix="/api")


@router.get("/tools")
async def get_tools():
    try:
        with open(TOOLS_JSON_PATH, "r", encoding="utf-8") as f:
            tools = json.load(f)
        return {"tools": tools}
    except FileNotFoundError:
        return {"tools": []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取工具列表失败: {str(e)}")


@router.post("/tools/execute")
async def execute_tool_endpoint(request: Request):
    from tools import execute_tool

    body = await request.json()
    tool_name = body.get("name")
    arguments = body.get("arguments", {})

    result = execute_tool(tool_name, arguments)
    return {"result": result}

