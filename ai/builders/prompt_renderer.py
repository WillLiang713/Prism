from datetime import datetime


DEFAULT_SYSTEM_PROMPT = """回答应以准确、及时、可核实为目标。

当前时间：
- {{datetime}}
- {{date}}
- {{time}}
- {{timestamp}}

如果问题涉及时间、最新状态或可能变化的信息，先联网搜索再回答。不要凭记忆猜测最新内容；不确定就明确说不确定，不要编造。回答时先给结论，再给关键依据。稳定知识默认不联网，除非用户明确要求最新资料。"""


def render_system_prompt_template(template: str, now: datetime) -> str:
    text = str(template or "")
    replacements = {
        "{{datetime}}": now.strftime("%Y-%m-%d %H:%M:%S"),
        "{{date}}": now.strftime("%Y-%m-%d"),
        "{{time}}": now.strftime("%H:%M:%S"),
        "{{timestamp}}": str(int(now.timestamp())),
    }
    for key, value in replacements.items():
        text = text.replace(key, value)
    return text


def resolve_system_prompt(config_prompt: str | None, now: datetime) -> str:
    custom_prompt = (config_prompt or "").strip()
    template = custom_prompt if custom_prompt else DEFAULT_SYSTEM_PROMPT
    return render_system_prompt_template(template, now)
