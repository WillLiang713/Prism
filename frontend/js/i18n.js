const LANGUAGE_STORAGE_KEY = "prismLanguage";
const DEFAULT_LANGUAGE = "zh-CN";

const EN_TRANSLATIONS = {
  "新建": "New",
  "话题": "Topics",
  "展开侧栏": "Expand Sidebar",
  "收起侧栏": "Collapse Sidebar",
  "关闭侧栏": "Close Sidebar",
  "模型信息": "Model Info",
  "选择模型": "Choose Model",
  "界面操作": "Interface Actions",
  "切换主题": "Toggle Theme",
  "设置": "Settings",
  "关闭设置": "Close Settings",
  "配置分组": "Configuration Groups",
  "版本号": "Version",
  "窗口控制": "Window Controls",
  "最小化": "Minimize",
  "最大化": "Maximize",
  "还原": "Restore",
  "关闭": "Close",
  "聊天": "Chat",
  "滚动到底部": "Scroll To Bottom",
  "想问什么，直接说": "Whatever you want to ask, just say it",
  "输入问题或粘贴内容": "Ask anything or paste content",
  "上传图片": "Upload Image",
  "选择搜索方式": "Choose Search Mode",
  "搜索": "Search",
  "数据": "Data",
  "聊天数据": "Chat Data",
  "思考": "Reasoning",
  "发送": "Send",
  "停止": "Stop",
  "OpenAI Web Search": "OpenAI Web Search",
  "Anthropic Web Search": "Anthropic Web Search",
  "Google Search": "Google Search",
  "HTML 预览": "HTML Preview",
  "HTML 预览画布": "HTML Preview Canvas",
  "关闭 HTML 预览": "Close HTML Preview",
  "等待预览内容": "Waiting For Preview",
  "在 AI 回复里的 HTML 代码块上点击“预览”，右侧会打开页面内预览面板。":
    "Click “Preview” on an HTML code block in the AI response to open the in-page preview panel on the right.",
  "服务": "Services",
  "模型": "Models",
  "快捷键": "Shortcuts",
  "快捷键列表": "Shortcut List",
  "服务操作": "Service Actions",
  "新建话题": "New Topic",
  "新建服务": "New Service",
  "复制": "Copy",
  "删除": "Delete",
  "服务列表": "Service List",
  "导出配置": "Export Config",
  "导出备份": "Export Backup",
  "导入配置": "Import Config",
  "测试连接": "Test Connection",
  "服务名称": "Service Name",
  "输入服务名称": "Enter service name",
  "接口类型": "API Type",
  "选择接口类型": "Choose API type",
  "打开接口类型列表": "Open API Type List",
  "使用内置搜索服务": "Use Built-in Search",
  "选择是否使用内置搜索服务": "Choose whether to use built-in search",
  "打开内置搜索服务选项": "Open Built-in Search Options",
  "是": "Yes",
  "否": "No",
  "API 密钥": "API Key",
  "输入API密钥": "Enter API key",
  "显示/隐藏密钥": "Show/Hide Secret",
  "API 地址": "API URL",
  "输入API地址": "Enter API URL",
  "打开标题生成模型列表": "Open Title Model List",
  "标题生成模型": "Title Model",
  "标题生成": "Title Model",
  "选择模型或手动输入": "Choose a model or enter one manually",
  "点击选择模型": "Click to choose a model",
  "打开标题生成模型列表": "Open Title Model List",
  "角色设定": "System Prompt",
  "回答应以准确、及时、可核实为目标。\n\n当前时间：\n- {{datetime}}\n- {{date}}\n- {{time}}\n- {{timestamp}}\n\n如果问题涉及时间、最新状态或可能变化的信息，先联网搜索再回答。不要凭记忆猜测最新内容；不确定就明确说不确定，不要编造。回答时先给结论，再给关键依据。稳定知识默认不联网，除非用户明确要求最新资料。":
    "Aim for answers that are accurate, timely, and verifiable.\n\nCurrent time:\n- {{datetime}}\n- {{date}}\n- {{time}}\n- {{timestamp}}\n\nIf the question involves time, recent status, or information that may have changed, search the web before answering. Do not guess recent facts from memory. If you are unsure, say so clearly instead of inventing details. Give the conclusion first, then the key evidence. For stable knowledge, do not browse by default unless the user explicitly asks for the latest information.",
  "留空用内置提示词。支持 {{datetime}} {{date}} {{time}} {{timestamp}}":
    "Leave empty to use the built-in prompt. Supports {{datetime}} {{date}} {{time}} {{timestamp}}",
  "默认": "Default",
  "选择默认": "Choose default",
  "打开默认列表": "Open Default List",
  "搜索服务": "Search Provider",
  "选择搜索服务": "Choose search provider",
  "打开搜索服务列表": "Open Search Provider List",
  "搜索数量": "Result Count",
  "搜索模式": "Search Mode",
  "选择搜索模式": "Choose search mode",
  "打开搜索模式列表": "Open Search Mode List",
  "操作": "Action",
  "按键": "Keys",
  "提示": "Notice",
  "取消": "Cancel",
  "确定": "Confirm",
  "图片预览": "Image Preview",
  "保存图片": "Save Image",
  "配置已导出": "Configuration exported",
  "备份已导出": "Backup exported",
  "配置文件格式不正确": "Invalid configuration file format",
  "配置文件解析失败": "Failed to parse configuration file",
  "备份文件格式不正确": "Invalid backup file format",
  "备份文件解析失败": "Failed to parse backup file",
  "导入配置会覆盖当前本地配置，是否继续？": "Importing configuration will overwrite the current local configuration. Continue?",
  "导入备份会覆盖当前本地聊天数据，是否继续？":
    "Importing the backup will overwrite the local chat data on this device. Continue?",
  "当前编辑中的未保存修改也会丢失": "Unsaved edits in the current form will also be lost",
  "当前本地配置将被覆盖": "The current local configuration will be overwritten",
  "导入成功": "Import Successful",
  "配置已导入": "Configuration imported",
  "备份已导入": "Backup imported",
  "导出失败": "Export failed",
  "导出备份失败": "Failed to export backup",
  "导入失败": "Import failed",
  "导出配置失败": "Failed to export configuration",
  "导入配置失败": "Failed to import configuration",
  "导入配置": "Import Config",
  "导入备份": "Import Backup",
  "切换到英文": "Switch to English",
  "切换到中文": "Switch to Chinese",
  "切换语言": "Switch Language",
  "关": "Off",
  "微": "Min",
  "低": "Low",
  "中": "Med",
  "高": "High",
  "极高": "Max",
  "发送消息": "Send Message",
  "插入换行": "Insert New Line",
  "上一话题": "Previous Topic",
  "下一话题": "Next Topic",
  "删除当前话题": "Delete Current Topic",
  "切换话题栏": "Toggle Sidebar",
  "打开设置": "Open Settings",
  "查看快捷键": "View Shortcuts",
  "就绪": "Ready",
  "生成中...": "Generating...",
  "完成": "Done",
  "错误": "Error",
  "已停止": "Stopped",
  "话题：{title} · {count} 条": "Topic: {title} · {count} messages",
  "未命名话题": "Untitled Topic",
  "开始新话题": "Start A New Topic",
  "输入问题、任务，或粘贴一段内容，我会直接处理。":
    "Type a question, a task, or paste content and I will handle it directly.",
  "有什么我可以帮您的？": "How can I help you today?",
  "无论你想写代码、分析数据，还是解疑释惑，我都在这里。":
    "Whether you want to write code, analyze data, or seek answers, I'm here.",
  "查看图片": "View Image",
  "查看图片：{name}": "View Image: {name}",
  "用户上传的图片": "Uploaded Image",
  "查看生成图片 {count}": "View Generated Image {count}",
  "生成图片 {count}": "Generated Image {count}",
  "该话题正在生成中，删除前会先停止生成，是否继续？":
    "This topic is still generating. Stop it before deleting?",
  "删除话题": "Delete Topic",
  "删除服务": "Delete Service",
  "继续": "Continue",
  "确定要删除话题「{title}」吗？": "Delete topic “{title}”?",
  "确认": "Confirm",
  "当前消息正在生成中，删除前会先停止生成，是否继续？":
    "This message is still generating. Stop it before deleting?",
  "删除消息": "Delete Message",
  "这条消息“{preview}”": "this message “{preview}”",
  "这条消息": "this message",
  "确定要删除{messageLabel}吗？": "Delete {messageLabel}?",
  "切换到话题：{title}": "Switch to topic: {title}",
  "更多操作：{title}": "More actions: {title}",
  "更多操作": "More Actions",
  "正在生成标题...": "Generating title...",
  "重新生成标题": "Regenerate Title",
  "编辑并重新发送": "Edit And Resend",
  "重新生成": "Regenerate",
  "在这里修改这条消息": "Edit this message here",
  "重新发送": "Resend",
  "未配置": "Not Configured",
  "当前话题正在生成中，仍要清空并停止生成吗？":
    "This topic is still generating. Clear it and stop generation anyway?",
  "清空话题": "Clear Topic",
  "清空全部": "Clear All",
  "清空全部话题": "Clear All Topics",
  "确定要清空当前话题的所有消息吗？":
    "Clear all messages in the current topic?",
  "确定要删除当前设备上保存的 {count} 个话题吗？":
    "Delete the {count} topics saved on this device?",
  "清空": "Clear",
  "思考中": "Thinking",
  "请输入内容或上传图片": "Enter some text or upload an image",
  "无法发送": "Cannot Send",
  "请先配置模型": "Configure a model first",
  "缺少配置": "Missing Configuration",
  "请输入内容或保留图片后再重新发送":
    "Enter some text or keep the images before resending",
  "无法重新发送": "Cannot Resend",
  "无法生成标题": "Cannot Generate Title",
  "模型错误:": "Model Error:",
  "错误: {message}": "Error: {message}",
  "请先在设置里补全标题生成模型配置":
    "Complete the title generation model settings first",
  "无法生成标题": "Cannot Generate Title",
  "生成失败": "Generation Failed",
  "重新生成标题失败": "Failed to regenerate title",
  "话题不存在": "Topic does not exist",
  "标题生成配置不完整（需要 API Key 和模型名称）":
    "Title generation config is incomplete (API key and model name are required)",
  "话题中没有有效的对话内容": "No valid conversation content in this topic",
  "新话题": "New Topic",
  "{count} 个话题": "{count} topics",
  "{count} 个含消息": "{count} with messages",
  "{count} 个空话题": "{count} empty topics",
  "默认服务": "Default Service",
  "未命名服务": "Unnamed Service",
  "新服务": "New Service",
  "连接中": "Connecting",
  "连接成功": "Connected",
  "连接失败": "Connection Failed",
  "未测试": "Not Tested",
  "已配置密钥": "Key Configured",
  "未配置密钥": "No Key",
  "默认模型": "Default Model",
  "未填写": "Not Set",
  "密钥状态": "Key Status",
  "更新时间": "Updated",
  "暂无服务，点击上方“新建”开始配置。":
    "No services yet. Click “New” above to start.",
  "当前编辑服务有未保存修改，是否先保存？":
    "The current service has unsaved changes. Save before switching?",
  "未保存修改": "Unsaved Changes",
  "保存并切换": "Save And Switch",
  "继续切换": "Switch Anyway",
  "继续切换会进入下一步确认。":
    "If you continue, a second confirmation will follow.",
  "切换后将丢失当前编辑中的未保存修改，是否继续？":
    "Unsaved changes in the current edit will be lost after switching. Continue?",
  "放弃修改": "Discard Changes",
  "配置已保存": "Configuration Saved",
  "保存成功": "Saved",
  "使用 OpenAI /v1/responses。API 地址建议只填根地址，版本和接口路径会自动补全。":
    "Using OpenAI /v1/responses. Enter only the base URL. Version and endpoint paths are completed automatically.",
  "使用 Gemini 原生接口。API 地址建议只填根地址，v1beta 等版本路径会自动处理。":
    "Using the native Gemini API. Enter only the base URL. Version paths like v1beta are handled automatically.",
  "使用 Anthropic /v1/messages。API 地址建议只填根地址，接口路径会自动补全。":
    "Using Anthropic /v1/messages. Enter only the base URL. Endpoint paths are completed automatically.",
  "使用 OpenAI /v1/chat/completions。API 地址建议只填根地址，版本和接口路径会自动补全。":
    "Using OpenAI /v1/chat/completions. Enter only the base URL. Version and endpoint paths are completed automatically.",
  "填写根地址，如 https://generativelanguage.googleapis.com":
    "Enter the base URL, for example https://generativelanguage.googleapis.com",
  "填写根地址，如 https://api.anthropic.com":
    "Enter the base URL, for example https://api.anthropic.com",
  "填写根地址，如 https://api.openai.com":
    "Enter the base URL, for example https://api.openai.com",
  "选择模型": "Choose Model",
  "确定要清除所有配置吗？": "Clear all configuration?",
  "清除配置": "Clear Configuration",
  "此操作会重置当前页面所有本地配置":
    "This will reset all local configuration on the current page",
  "配置已清除": "Configuration Cleared",
  "操作完成": "Done",
  "{name} 副本": "{name} Copy",
  "确定要删除服务「{name}」吗？": "Delete service “{name}”?",
  "放弃未保存修改": "Discard Unsaved Changes",
  "请先选择或新建一个服务，再测试连接。":
    "Choose or create a service first, then test the connection.",
  "该服务有未保存修改，删除后这些修改将丢失，是否继续？":
    "This service has unsaved changes. They will be lost after deletion. Continue?",
  "请先选择或新建一个服务，再测试连接。":
    "Choose or create a service first, then test the connection.",
  "正在尝试拉取模型列表…": "Trying to fetch the model list…",
  "模型列表接口不可用，但已通过 Messages 接口验证连接。":
    "The model list API is unavailable, but the connection was verified through the Messages API.",
  "成功拉取 {count} 个模型。": "Fetched {count} models successfully.",
  "测试失败": "Test Failed",
  "未配置 API Key 或 API 地址": "API key or API URL is not configured",
  "当前主模型未设置": "The main model is not set",
  "先填写 API Key、API 地址，再拉取模型列表":
    "Enter the API key and API URL before fetching models",
  "先填写 API 地址，再拉取模型列表":
    "Enter the API URL before fetching models",
  "已获取 {count} 个模型ID，可下拉选或手动输入":
    "Fetched {count} model IDs. Choose one or enter manually.",
  "可独立指定；也可选择“跟随主模型”":
    "You can set it separately or choose “Follow main model”.",
  "已获取 {count} 个模型ID，可点击选择或跟随主模型":
    "Fetched {count} model IDs. Click to choose one or follow the main model.",
  "可点击选择标题模型，也可选择“跟随主模型”":
    "Click to choose a title model, or choose “Follow main model”.",
  "填模型ID；可下拉选或手动输入":
    "Enter a model ID, choose one, or type manually.",
  "获取模型列表失败": "Failed to fetch model list",
  "加载中": "Loading",
  "暂无模型": "No Models",
  "{count} 个模型": "{count} models",
  "暂无可用服务，请先在设置中添加服务":
    "No available services. Add one in settings first.",
  "已发现 {count} 个模型": "{count} models found",
  "{count} 个连接": "{count} connections",
  "暂无可选模型，请先配置至少一个可拉取模型的连接":
    "No selectable models. Configure at least one connection that can fetch models.",
  "未配置 API Key 或 API 地址": "API key or API URL is not configured",
  "正在获取模型列表…": "Fetching model list…",
  "当前连接还没有可选模型": "This connection does not have selectable models yet",
  "跟随主模型": "Follow Main Model",
  "无匹配模型，可继续输入": "No matching models. Keep typing to enter one.",
  "暂无模型列表，请先配置至少一个连接":
    "No model list available yet. Configure at least one connection first.",
  "加载更多（已显示 {shown}/{total}）":
    "Load more ({shown}/{total} shown)",
  "获取模型列表失败（{status}）：{detail}":
    "Failed to fetch model list ({status}): {detail}",
  "未知错误": "Unknown Error",
  "无效的图片数据": "Invalid image data",
  "没有可保存的图片": "No image available to save",
  "桌面保存接口不可用": "Desktop save API is unavailable",
  "获取到的模型列表为空": "The fetched model list is empty",
  "模型列表接口不可用，已验证消息接口；可手动输入模型ID":
    "The model list API is unavailable, but the message API works. You can enter a model ID manually.",
  "自动获取失败，请手动输入模型ID":
    "Automatic fetch failed. Enter a model ID manually.",
  "当前时间": "Current Time",
  "联网搜索": "Web Search",
  "搜索中": "Searching",
  "搜索失败": "Search Failed",
  "搜索中…": "Searching…",
  "联网搜索失败": "Web search failed",
  "(无标题)": "(Untitled)",
  "未返回结果。": "No results returned.",
  "未知工具": "Unknown Tool",
  "参数：{args}": "Arguments: {args}",
  "等待工具返回结果": "Waiting for tool result",
  "调用完成": "Completed",
  "查询：{query}": "Query: {query}",
  "摘要：{answer}": "Summary: {answer}",
  "工具调用 · {count} 步": "Tool Calls · {count} steps",
  "联网结果 · {count} 次": "Web Results · {count} rounds",
  "已核对 {count} 个站点": "Checked {count} sites",
  "已核对 {count} 个站点：{domains}": "Checked {count} sites: {domains}",
  "关": "Off",
  "模型：{provider} · {model}": "Model: {provider} · {model}",
  "模型：待完成（需 Key + 地址 + 模型）":
    "Model: incomplete (key + URL + model required)",
  "联网：关闭": "Web: Off",
  "联网：OpenAI Web Search": "Web: OpenAI Web Search",
  "联网：Anthropic Web Search": "Web: Anthropic Web Search",
  "联网：Google Search": "Web: Google Search",
  "联网：Exa · {type} · {count} 条": "Web: Exa · {type} · {count} results",
  "联网：Tavily · {depth} · {count} 条": "Web: Tavily · {depth} · {count} results",
  "当前服务将使用 {mode}，外部搜索配置已禁用。":
    "This service will use {mode}, and the external search settings are disabled.",
  "当前接口类型暂不支持内置搜索，仍需使用外部搜索配置。":
    "The current API type does not support built-in search yet. External search settings are still required.",
  "关闭后，可在“搜索”页配置 Tavily 或 Exa。":
    "When disabled, you can configure Tavily or Exa in the Search tab.",
  "当前主服务已启用内置搜索：{mode}。下面的外部搜索配置已隐藏。":
    "The current primary service is using built-in search: {mode}. The external search settings below are hidden.",
  "当前是 file:// 打开页面，无法调用本地接口；请用 python server.py 方式访问 http://localhost:3000":
    "The page is opened with file://, so local APIs are unavailable. Start the app with python server.py and open http://localhost:3000 instead.",
  "预览 HTML 代码": "Preview HTML Code",
  "保存图片失败:": "Failed to save image:",
  "复制…": "Copying…",
  "已复制": "Copied",
  "失败": "Failed",
  "复制代码": "Copy Code",
  "思考完成": "Thinking Complete",
  "思考完成，用时 {seconds} 秒": "Thinking complete in {seconds}s",
  "请求失败": "Request Failed",
  "知道了": "OK",
  "期望响应类型为 {expected}，实际收到 {actual}":
    "Expected response type {expected}, received {actual}",
  "解析流式响应失败: {message}": "Failed to parse streaming response: {message}",
  "同步桌面关闭行为失败:": "Failed to sync desktop close behavior:",
  "健康检查返回格式异常": "Health check returned an invalid payload",
  "健康检查失败：HTTP {status}": "Health check failed: HTTP {status}",
  "本地服务启动超时，请检查 sidecar 或端口占用情况":
    "Timed out waiting for the local service to start. Check the sidecar and port usage.",
  "知道了": "OK",
};

const listeners = new Set();
let currentLanguage = DEFAULT_LANGUAGE;

function normalizeLanguage(value) {
  if (value == null || value === "") return "";
  const normalized = String(value || "").trim().toLowerCase();
  return normalized.startsWith("en") ? "en" : DEFAULT_LANGUAGE;
}

function getStoredLanguage() {
  try {
    return normalizeLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch (_error) {
    return DEFAULT_LANGUAGE;
  }
}

function resolveInitialLanguage() {
  const stored = getStoredLanguage();
  if (stored) return stored;
  if (typeof navigator === "undefined") return DEFAULT_LANGUAGE;
  return normalizeLanguage(navigator.language);
}

function formatText(template, params = {}) {
  return String(template || "").replace(/(^|[^{])\{(\w+)\}(?!\})/g, (_match, prefix, key) => {
    const value = params[key];
    return `${prefix}${value == null ? "" : String(value)}`;
  });
}

export function getCurrentLanguage() {
  return currentLanguage;
}

export function getCurrentLocale() {
  return currentLanguage === "en" ? "en-US" : "zh-CN";
}

export function t(key, params = {}) {
  const source = String(key || "");
  const translated =
    currentLanguage === "en" ? EN_TRANSLATIONS[source] || source : source;
  return formatText(translated, params);
}

function setTextContent(selector, key) {
  const node = document.querySelector(selector);
  if (node) node.textContent = t(key);
}

function setAttribute(selector, attr, key) {
  const node = document.querySelector(selector);
  if (node) node.setAttribute(attr, t(key));
}

function setTextContentAll(selector, key) {
  document.querySelectorAll(selector).forEach((node) => {
    node.textContent = t(key);
  });
}

function applyReasoningTranslations() {
  const labels = {
    none: "关",
    minimal: "微",
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "极高",
  };

  document.querySelectorAll("#reasoningEffortDropdown button[data-value]").forEach((button) => {
    const value = String(button.dataset.value || "").trim();
    const sourceLabel = labels[value] || button.dataset.label || button.textContent || "";
    const translated = t(sourceLabel);
    button.dataset.label = translated;
    button.textContent = translated;
  });

  const currentBtn = document.querySelector(".reasoning-effort-current");
  if (currentBtn) currentBtn.setAttribute("aria-label", t("选择思考强度"));

  const activeButton = document.querySelector("#reasoningEffortDropdown button.active");
  const valueEl = document.getElementById("reasoningEffortValue");
  if (valueEl && activeButton instanceof HTMLButtonElement) {
    valueEl.textContent = activeButton.dataset.label || activeButton.textContent || "";
  }
}

function applyLanguageTogglePresentation() {
  const button = document.getElementById("languageToggleBtn");
  if (!(button instanceof HTMLElement)) return;
  button.dataset.language = currentLanguage;
  const label =
    currentLanguage === "en" ? t("切换到中文") : t("切换到英文");
  button.setAttribute("aria-label", label);
}

export function applyStaticTranslations() {
  if (typeof document === "undefined") return;

  document.documentElement.lang = currentLanguage === "en" ? "en" : "zh-CN";
  document.documentElement.dataset.language = currentLanguage;
  document.title = "Prism";

  setAttribute(".topics-panel", "aria-label", "话题");
  setAttribute("#expandSidebarBtn", "aria-label", "展开侧栏");
  setAttribute("#newTopicBtn", "aria-label", "新建话题");
  setTextContent("#newTopicBtn .topic-new-text", "新建");
  setTextContent("#newTopicBtn .sr-only", "新建");
  setAttribute("#toggleSidebarBtn", "aria-label", "收起侧栏");
  setAttribute("#sidebarScrim", "aria-label", "关闭侧栏");
  setAttribute("#mobileExpandSidebarBtn", "aria-label", "展开侧栏");
  setAttribute(".header-brand", "aria-label", "模型信息");
  setAttribute("#headerModelTrigger", "aria-label", "选择模型");
  setAttribute(".header-utility-actions", "aria-label", "界面操作");
  setAttribute("#themeToggleBtn", "aria-label", "切换主题");
  setTextContent("#themeToggleBtn .sr-only", "切换主题");
  setAttribute("#openConfigBtn", "aria-label", "设置");
  setTextContent("#openConfigBtn .sr-only", "设置");
  setAttribute("#desktopWindowControls", "aria-label", "窗口控制");
  setAttribute("#windowMinimizeBtn", "aria-label", "最小化");
  setAttribute("#windowCloseBtn", "aria-label", "关闭");
  setAttribute(".chat-thread", "aria-label", "聊天");
  setAttribute("#scrollToBottomBtn", "aria-label", "滚动到底部");
  setAttribute("#promptInput", "placeholder", "想问什么，直接说");
  setAttribute("#imageUploadBtn", "aria-label", "上传图片");
  setAttribute("#webSearchToolCurrent", "aria-label", "选择搜索方式");
  setTextContent("#webSearchSwitchText", "搜索");
  setTextContent(".reasoning-effort-label", "思考");
  setAttribute("#sendBtn", "aria-label", "发送");
  setTextContent("#sendBtn .label-send", "发送");
  setTextContent("#sendBtn .label-stop", "停止");
  setAttribute("#htmlPreviewLayer", "aria-label", "HTML 预览");
  setAttribute("#htmlPreviewBackdrop", "aria-label", "关闭 HTML 预览");
  setAttribute("#htmlPreviewCloseBtn", "aria-label", "关闭 HTML 预览");
  setAttribute("#htmlPreviewFrame", "title", "HTML 预览画布");
  setTextContent("#htmlPreviewEmpty .html-preview-empty-title", "等待预览内容");
  setTextContent("#htmlPreviewEmpty .html-preview-empty-text", "在 AI 回复里的 HTML 代码块上点击“预览”，右侧会打开页面内预览面板。");
  setTextContent(".config-header h2", "设置");
  setAttribute("#configVersion", "aria-label", "版本号");
  setAttribute("#closeConfigBtn", "aria-label", "关闭设置");
  setAttribute("#configTabs", "aria-label", "配置分组");
  setTextContent('.config-tab[data-tab="services"]', "服务");
  setTextContent('.config-tab[data-tab="model"]', "模型");
  setTextContent('.config-tab[data-tab="web"]', "搜索");
  setTextContent('.config-tab[data-tab="data"]', "数据");
  setTextContent('.config-tab[data-tab="shortcuts"]', "快捷键");
  setAttribute(".chat-data-stats", "aria-label", "聊天数据");
  setAttribute(".service-toolbar", "aria-label", "服务操作");
  setAttribute("#createServiceBtn", "aria-label", "新建服务");
  setTextContent("#createServiceBtn .sr-only", "新建");
  setAttribute("#duplicateServiceBtn", "aria-label", "复制");
  setTextContent("#duplicateServiceBtn .sr-only", "复制");
  setAttribute("#deleteServiceBtn", "aria-label", "删除");
  setTextContent("#deleteServiceBtn .sr-only", "删除");
  setAttribute("#serviceList", "aria-label", "服务列表");
  setTextContent("#exportConfigBtn", "导出配置");
  setAttribute("#exportConfigBtn", "aria-label", "导出配置");
  setTextContent("#importConfigBtn", "导入配置");
  setAttribute("#importConfigBtn", "aria-label", "导入配置");
  setTextContent("#importDataBtn", "导入备份");
  setAttribute("#importDataBtn", "aria-label", "导入备份");
  setTextContent("#exportTopicsBtn", "导出备份");
  setAttribute("#exportTopicsBtn", "aria-label", "导出备份");
  setTextContent("#clearTopicsBtn", "清空全部");
  setAttribute("#clearTopicsBtn", "aria-label", "清空全部");
  setTextContent("#testServiceConnectionBtn", "测试连接");
  setTextContent('label[for="serviceNameInput"]', "服务名称");
  setAttribute("#serviceNameInput", "placeholder", "输入服务名称");
  setTextContent('label[for="providerPickerInput"]', "接口类型");
  setAttribute("#providerPickerInput", "placeholder", "选择接口类型");
  setAttribute("#providerPickerBtn", "aria-label", "打开接口类型列表");
  setTextContent('label[for="builtinWebSearchPickerInput"]', "使用内置搜索服务");
  setAttribute("#builtinWebSearchPickerInput", "placeholder", "选择是否使用内置搜索服务");
  setAttribute("#builtinWebSearchPickerBtn", "aria-label", "打开内置搜索服务选项");
  setTextContent('#builtinWebSearch option[value="false"]', "否");
  setTextContent('#builtinWebSearch option[value="true"]', "是");
  setTextContent('label[for="apiKey"]', "API 密钥");
  setAttribute("#apiKey", "placeholder", "输入API密钥");
  setAttribute('button.password-toggle-btn[data-target="apiKey"]', "aria-label", "显示/隐藏密钥");
  setTextContent('label[for="apiUrl"]', "API 地址");
  setAttribute("#apiUrl", "placeholder", "输入API地址");
  setTextContent('label[for="titleGenerationModel"]', "标题生成");
  setAttribute("#titleGenerationModel", "placeholder", "点击选择模型");
  setAttribute("#modelDropdownBtnTitle", "aria-label", "打开标题生成模型列表");
  setTextContent('label[for="roleSetting"]', "角色设定");
  setAttribute("#roleSetting", "placeholder", "回答应以准确、及时、可核实为目标。\n\n当前时间：\n- {{datetime}}\n- {{date}}\n- {{time}}\n- {{timestamp}}\n\n如果问题涉及时间、最新状态或可能变化的信息，先联网搜索再回答。不要凭记忆猜测最新内容；不确定就明确说不确定，不要编造。回答时先给结论，再给关键依据。稳定知识默认不联网，除非用户明确要求最新资料。");
  setTextContent("#roleSettingPreview + .form-hint", "留空用内置提示词。支持 {{datetime}} {{date}} {{time}} {{timestamp}}");
  setTextContent('label[for="webSearchDefaultModePickerInput"]', "默认");
  setAttribute("#webSearchDefaultModePickerInput", "placeholder", "选择默认");
  setAttribute("#webSearchDefaultModePickerBtn", "aria-label", "打开默认列表");
  setTextContent('label[for="webSearchProviderPickerInput"]', "搜索服务");
  setAttribute("#webSearchProviderPickerInput", "placeholder", "选择搜索服务");
  setAttribute("#webSearchProviderPickerBtn", "aria-label", "打开搜索服务列表");
  setTextContent('label[for="webSearchApiKey"]', "API 密钥");
  setAttribute("#webSearchApiKey", "placeholder", "输入API密钥");
  setAttribute('button.password-toggle-btn[data-target="webSearchApiKey"]', "aria-label", "显示/隐藏密钥");
  setTextContent('label[for="tavilyMaxResults"]', "搜索数量");
  setTextContent("#webSearchModeLabel", "搜索模式");
  setAttribute("#webSearchModePickerInput", "placeholder", "选择搜索模式");
  setAttribute("#webSearchModePickerBtn", "aria-label", "打开搜索模式列表");
  setAttribute(".shortcut-help-table", "aria-label", "快捷键列表");
  setTextContent(".shortcut-help-table th:nth-child(1)", "操作");
  setTextContent(".shortcut-help-table th:nth-child(2)", "按键");
  setTextContent("#promptConfirmTitle", "提示");
  setTextContent("#promptConfirmCancelBtn", "取消");
  setTextContent("#promptConfirmOkBtn", "确定");
  setAttribute("#imagePreviewModal", "aria-label", "图片预览");
  setAttribute("#imagePreviewCloseBtn", "aria-label", "关闭");
  setAttribute("#imagePreviewSaveBtn", "aria-label", "保存图片");
  setAttribute("#imagePreviewSaveBtn", "title", "保存图片");

  applyReasoningTranslations();
  applyLanguageTogglePresentation();
}

function notifyListeners() {
  listeners.forEach((listener) => {
    try {
      listener(currentLanguage);
    } catch (error) {
      console.error("language listener failed:", error);
    }
  });
}

export function setLanguage(language, options = {}) {
  const nextLanguage = normalizeLanguage(language);
  const changed = nextLanguage !== currentLanguage;
  currentLanguage = nextLanguage;

  if (options.persist !== false) {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, currentLanguage);
    } catch (_error) {
      // Ignore persistence failures.
    }
  }

  applyStaticTranslations();
  if (changed && options.notify !== false) {
    notifyListeners();
  }
  return currentLanguage;
}

export function initLanguage() {
  currentLanguage = resolveInitialLanguage();
  applyStaticTranslations();
  return currentLanguage;
}

export function toggleLanguage() {
  return setLanguage(currentLanguage === "en" ? "zh-CN" : "en");
}

export function onLanguageChange(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
