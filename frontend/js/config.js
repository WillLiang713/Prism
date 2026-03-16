import { state, elements, STORAGE_KEYS } from './state.js';
import { showAlert, showConfirm, syncBodyScrollLock } from './dialog.js';
import { syncAllConfigSelectPickers, closeAllConfigSelectPickers } from './dropdown.js';
import { closeModelDropdown, scheduleFetchModels, updateModelHint } from './models.js';
import { renderMarkdownToElement } from './markdown.js';
import { normalizeWebSearchProvider, normalizeTavilySearchDepth, normalizeExaSearchType, updateConfigStatusStrip, updateWebSearchProviderUi } from './web-search.js';

export function getConfigFromForm(side) {
  // 如果是标题模型，从主配置中获取
  if (side === "Title") {
    return {
      provider: elements.provider?.value || "openai",
      apiKey: elements.apiKey?.value || "",
      apiUrl: elements.apiUrl?.value || "",
    };
  }

  return {
    provider: elements.provider?.value || "openai",
    apiKey: elements.apiKey?.value || "",
    apiUrl: elements.apiUrl?.value || "",
  };
}

export function setActiveConfigTab(tabName = "model") {
  const tabs = document.querySelectorAll(".config-tab[data-tab]");
  const panels = document.querySelectorAll(".config-tab-panel[data-panel]");
  if (!tabs.length || !panels.length) return;

  const target = typeof tabName === "string" ? tabName : "model";
  const hasTarget = Array.from(tabs).some((tab) => tab.dataset.tab === target);
  const finalTab = hasTarget ? target : "model";

  tabs.forEach((tab) => {
    const active = tab.dataset.tab === finalTab;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });

  panels.forEach((panel) => {
    const active = panel.dataset.panel === finalTab;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
  closeModelDropdown("main");
  closeAllConfigSelectPickers();

  if (elements.configContent) {
    elements.configContent.scrollTop = 0;
  }
}

export function openConfigModal(tabName = "model") {
  if (!elements.configModal) return;
  setActiveConfigTab(typeof tabName === "string" ? tabName : "model");
  syncAllConfigSelectPickers();
  elements.configModal.classList.add("open");
  elements.configModal.setAttribute("aria-hidden", "false");
  syncBodyScrollLock();
  updateModelHint();
  syncRoleSettingPreview(true);
  updateConfigStatusStrip();
  scheduleFetchModels("main", 0);
}

export function closeConfigModal() {
  if (!elements.configModal) return;
  elements.configModal.classList.remove("open");
  elements.configModal.setAttribute("aria-hidden", "true");
  syncBodyScrollLock();
  closeModelDropdown("main");
  closeAllConfigSelectPickers();
}

export function showRoleSettingEditor(focus = false) {
  if (!elements.roleSetting || !elements.roleSettingPreview) return;
  elements.roleSetting.hidden = false;
  elements.roleSettingPreview.hidden = true;
  if (!focus) return;
  requestAnimationFrame(() => {
    elements.roleSetting?.focus();
    const len = elements.roleSetting?.value?.length || 0;
    elements.roleSetting?.setSelectionRange(len, len);
  });
}

export function showRoleSettingPreview() {
  if (!elements.roleSetting || !elements.roleSettingPreview) return;
  const text = (elements.roleSetting.value || "").trim();
  if (!text) {
    showRoleSettingEditor(false);
    return;
  }
  renderMarkdownToElement(elements.roleSettingPreview, text);
  elements.roleSetting.hidden = true;
  elements.roleSettingPreview.hidden = false;
}

export function syncRoleSettingPreview(preferPreview = true) {
  const text = (elements.roleSetting?.value || "").trim();
  if (preferPreview && text) {
    showRoleSettingPreview();
    return;
  }
  showRoleSettingEditor(false);
}

export function updateProviderUi() {
  const provider = elements.provider?.value || "openai";
  const hintEl = elements.providerHint;

  if (hintEl) {
    if (provider === "openai") {
      hintEl.textContent =
        "OpenAI 兼容接口，请填写 API 地址";
    } else if (provider === "anthropic") {
      hintEl.textContent =
        "Anthropic 兼容接口，请填写 API 地址";
    }
  }

  updateApiUrlPlaceholder();
  updateModelHint();
}

export function updateApiUrlPlaceholder() {
  const providerEl = elements.provider;
  const urlInput = elements.apiUrl;
  if (!providerEl || !urlInput) return;

  const provider = providerEl.value;
  const placeholders = {
    openai: "https://api.openai.com/v1/chat/completions",
    anthropic: "https://api.anthropic.com/v1/messages",
  };
  urlInput.placeholder = placeholders[provider] || "";
}

export function resolveModelDisplayName(modelId, customName) {
  const alias = (customName || "").trim();
  if (alias) return alias;
  return (modelId || "").trim();
}

export function updateModelNames() {
  const modelId = elements.model?.value || "";
  const customName = elements.modelCustomName?.value || "";
  const displayName = resolveModelDisplayName(modelId, customName);

  // 更新模型名称（未配置时不显示任何内容）
  elements.modelName.textContent = displayName || "";

  // 根据配置状态显示/隐藏模型行
  const modelLine = elements.modelName.closest(".brand-model");
  if (modelLine) {
    modelLine.style.display = displayName ? "" : "none";
  }
}

export function getConfig(side) {
  // 标题生成配置：始终跟随主模型
  if (side === "Title") {
    return {
      provider: elements.provider?.value || "openai",
      apiKey: elements.apiKey?.value || "",
      model: elements.model?.value || "",
      customModelName: (elements.modelCustomName?.value || "").trim(),
      apiUrl: elements.apiUrl?.value || "",
      systemPrompt: "", // 标题生成不需要系统提示词
      reasoningEffort: "none",
    };
  }

  return {
    provider: elements.provider?.value || "openai",
    apiKey: elements.apiKey?.value || "",
    model: elements.model?.value || "",
    customModelName: (elements.modelCustomName?.value || "").trim(),
    apiUrl: elements.apiUrl?.value || "",
    // 角色设定：发送给后端作为系统提示词
    systemPrompt: elements.roleSetting?.value || "",
    reasoningEffort: elements.reasoningEffortDropdown?.querySelector("button.active")?.dataset.value || "medium",
  };
}

export function getWebSearchConfig() {
  const maxResults = parseInt(elements.tavilyMaxResults?.value);
  return {
    enabled: !!elements.enableWebSearch?.checked,
    provider: normalizeWebSearchProvider(elements.webSearchProvider?.value),
    tavilyApiKey: (elements.tavilyApiKey?.value || "").trim(),
    exaApiKey: (elements.exaApiKey?.value || "").trim(),
    exaSearchType: normalizeExaSearchType(elements.exaSearchType?.value),
    maxResults: maxResults >= 1 && maxResults <= 20 ? maxResults : 5,
    searchDepth: normalizeTavilySearchDepth(elements.tavilySearchDepth?.value),
  };
}

export async function saveConfig() {
  const provider = elements.provider?.value || "openai";
  const apiKey = (elements.apiKey?.value || "").trim();
  const apiUrl = (elements.apiUrl?.value || "").trim();
  const model = (elements.model?.value || "").trim();
  const customName = (elements.modelCustomName?.value || "").trim();

  if (!apiKey || !apiUrl || !model) {
    setActiveConfigTab("model");
    await showAlert("请先完成模型必填项：API Key、API 地址、模型。", {
      title: "缺少必填项",
    });
    return;
  }

  const config = {
    webSearch: {
      enabled: !!elements.enableWebSearch?.checked,
      provider: normalizeWebSearchProvider(elements.webSearchProvider?.value),
      tavilyApiKey: elements.tavilyApiKey?.value || "",
      exaApiKey: elements.exaApiKey?.value || "",
      exaSearchType: normalizeExaSearchType(elements.exaSearchType?.value),
      maxResults: parseInt(elements.tavilyMaxResults?.value) || 5,
      searchDepth: normalizeTavilySearchDepth(
        elements.tavilySearchDepth?.value
      ),
    },
    tools: {
      enabled: true,
    },
    autoTitle: {
      enabled: true,
      model: "",
    },
    model: {
      provider,
      apiKey,
      model,
      customName,
      apiUrl,
      systemPrompt: elements.roleSetting?.value || "",
    },
  };

  localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(config));
  updateConfigStatusStrip();
  await showAlert("配置已保存", {
    title: "保存成功",
  });
  closeConfigModal();
}

export function loadConfig() {
  const saved = localStorage.getItem(STORAGE_KEYS.config);
  const config = saved ? JSON.parse(saved) : {};

  try {
    // 加载联网搜索配置 - 总是设置状态，默认关闭
    if (elements.enableWebSearch) {
      const webSearchEnabled = config.webSearch?.enabled === true;
      elements.enableWebSearch.checked = webSearchEnabled;
    }
    if (config.webSearch) {
      if (elements.webSearchProvider) {
        elements.webSearchProvider.value = normalizeWebSearchProvider(
          config.webSearch.provider
        );
      }
      if (elements.tavilyApiKey)
        elements.tavilyApiKey.value = config.webSearch.tavilyApiKey || "";
      if (elements.exaApiKey)
        elements.exaApiKey.value = config.webSearch.exaApiKey || "";
      if (elements.exaSearchType)
        elements.exaSearchType.value = normalizeExaSearchType(
          config.webSearch.exaSearchType
        );
      if (elements.tavilyMaxResults)
        elements.tavilyMaxResults.value = config.webSearch.maxResults || 5;
      if (elements.tavilySearchDepth) {
        elements.tavilySearchDepth.value = normalizeTavilySearchDepth(
          config.webSearch.searchDepth
        );
      }
    } else if (elements.webSearchProvider) {
      elements.webSearchProvider.value = "tavily";
      if (elements.exaSearchType) elements.exaSearchType.value = "auto";
    }
    // 加载思考强度配置
    if (config.reasoningEffort && elements.reasoningEffortDropdown) {
      elements.reasoningEffortDropdown.querySelectorAll("button").forEach(b => {
        b.classList.toggle("active", b.dataset.value === config.reasoningEffort);
      });
      const activeBtn = elements.reasoningEffortDropdown.querySelector("button.active");
      if (activeBtn && elements.reasoningEffortValue) {
        elements.reasoningEffortValue.textContent = activeBtn.dataset.label;
      }
    } else if (elements.reasoningEffortDropdown && elements.reasoningEffortValue) {
      const defaultBtn = elements.reasoningEffortDropdown.querySelector(
        'button[data-value="medium"]'
      );
      elements.reasoningEffortDropdown.querySelectorAll("button").forEach(b => {
        b.classList.toggle("active", b === defaultBtn);
      });
      if (defaultBtn) {
        elements.reasoningEffortValue.textContent = defaultBtn.dataset.label;
      }
    }
    // 加载模型配置（兼容旧格式 config.A）
    const modelConfig = config.model || config.A;
    if (modelConfig) {
      elements.provider.value = modelConfig.provider || "openai";
      elements.apiKey.value = modelConfig.apiKey || "";
      elements.model.value = modelConfig.model || "";
      if (elements.modelCustomName) {
        elements.modelCustomName.value = modelConfig.customName || "";
      }
      elements.apiUrl.value = modelConfig.apiUrl || "";
      if (elements.roleSetting)
        elements.roleSetting.value =
          modelConfig.systemPrompt || modelConfig.roleSetting || "";
    }
    syncRoleSettingPreview(true);
  } catch (e) {
    console.error("加载配置失败:", e);
  }

  syncAllConfigSelectPickers();
  updateWebSearchProviderUi();
  updateConfigStatusStrip();
}

export async function clearConfig() {
  const confirmed = await showConfirm("确定要清除所有配置吗？", {
    title: "清除配置",
    okText: "清除",
    danger: true,
    hint: "此操作会重置当前页面所有本地配置",
  });
  if (!confirmed) return;

  localStorage.removeItem(STORAGE_KEYS.config);

  if (elements.enableWebSearch) elements.enableWebSearch.checked = false;
  if (elements.webSearchProvider) elements.webSearchProvider.value = "tavily";
  if (elements.tavilyApiKey) elements.tavilyApiKey.value = "";
  if (elements.exaApiKey) elements.exaApiKey.value = "";
  if (elements.exaSearchType) elements.exaSearchType.value = "auto";
  if (elements.tavilyMaxResults) elements.tavilyMaxResults.value = 5;
  if (elements.tavilySearchDepth) elements.tavilySearchDepth.value = "basic";

  elements.provider.value = "openai";
  elements.apiKey.value = "";
  elements.model.value = "";
  if (elements.modelCustomName) elements.modelCustomName.value = "";
  elements.apiUrl.value = "";
  if (elements.roleSetting) elements.roleSetting.value = "";
  if (elements.reasoningEffortDropdown && elements.reasoningEffortValue) {
    elements.reasoningEffortDropdown.querySelectorAll("button").forEach(b => {
      b.classList.toggle("active", b.dataset.value === "medium");
    });
    elements.reasoningEffortValue.textContent = "中";
  }
  syncRoleSettingPreview(false);

  syncAllConfigSelectPickers();
  updateProviderUi();
  updateWebSearchProviderUi();
  updateModelNames();
  updateConfigStatusStrip();
  await showAlert("配置已清除", {
    title: "操作完成",
  });
  closeConfigModal();
}
