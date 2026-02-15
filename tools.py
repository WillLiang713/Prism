"""
工具函数实现

在这个文件中添加所有工具函数，函数名必须与 tools.json 中定义的 name 一致
"""


# 工具注册表 - 自动发现所有工具函数
TOOLS = {}


def execute_tool(tool_name: str, arguments: dict = None) -> str:
    """
    执行工具调用

    Args:
        tool_name: 工具名称
        arguments: 工具参数

    Returns:
        工具执行结果
    """
    if tool_name not in TOOLS:
        return f"错误：未找到工具 '{tool_name}'"

    try:
        tool_func = TOOLS[tool_name]
        result = tool_func(**(arguments or {}))
        return str(result)
    except Exception as e:
        return f"错误：工具执行失败 - {str(e)}"
