// ============================================
// Hermes Desktop Setup — 配置向导
// ============================================

(function () {
  "use strict";

  // ── 状态 ──

  let currentStep = 1;
  let selectedProvider = null;
  let selectedModel = null;

  // ── DOM ──

  const steps = document.querySelectorAll(".step");
  const progressFill = document.getElementById("progressFill");
  const providerCards = document.querySelectorAll(".provider-card");
  const apiKeyInput = document.getElementById("apiKeyInput");
  const apiKeyError = document.getElementById("apiKeyError");
  const apikeySubtitle = document.getElementById("apikeySubtitle");
  const btnStart = document.getElementById("btnStart");
  const btnBackToProvider = document.getElementById("btnBackToProvider");
  const btnFinish = document.getElementById("btnFinish");
  const btnToggleKey = document.getElementById("btnToggleKey");

  // ── 国际化 ──

  const lang = new URLSearchParams(window.location.search).get("lang") || "en";

  const I18N = {
    zh: {
      "welcome.title": "欢迎使用 Hermes Desktop",
      "welcome.subtitle": "Nous Research 出品的一键 AI 助手。让我们开始配置。",
      "welcome.start": "开始配置",
      "provider.title": "选择 AI 服务商",
      "provider.subtitle": "选择你要使用的大模型提供商。",
      "apikey.title": "输入 API Key",
      "apikey.finish": "完成配置",
      "common.back": "返回",
      "done.title": "配置完成！",
      "done.subtitle": "Hermes Agent 正在启动，请稍候...",
    },
    en: {},
  };

  function applyI18n() {
    const strings = I18N[lang] || {};
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (strings[key]) el.textContent = strings[key];
    });
  }

  // ── 步骤导航 ──

  function goToStep(n) {
    currentStep = n;
    steps.forEach((s, i) => {
      s.classList.toggle("active", i === n - 1);
    });
    const totalSteps = 4;
    progressFill.style.width = `${((n - 1) / (totalSteps - 1)) * 100}%`;
  }

  // ── Provider 选择 ──

  providerCards.forEach((card) => {
    card.addEventListener("click", () => {
      providerCards.forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedProvider = card.dataset.provider;
      selectedModel = card.dataset.model;

      const providerLabels = {
        anthropic: "Anthropic",
        openai: "OpenAI",
        gemini: "Google AI Studio",
        openrouter: "OpenRouter",
        deepseek: "DeepSeek",
      };
      const label = providerLabels[selectedProvider] || selectedProvider;
      apikeySubtitle.textContent = lang === "zh"
        ? `请粘贴你的 ${label} API Key。`
        : `Paste your ${label} API key below.`;

      goToStep(3);
    });
  });

  // ── API Key 输入 ──

  apiKeyInput.addEventListener("input", () => {
    const val = apiKeyInput.value.trim();
    btnFinish.disabled = val.length < 8;
    apiKeyError.style.display = "none";
  });

  btnToggleKey.addEventListener("click", () => {
    apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
  });

  // ── 按钮事件 ──

  btnStart.addEventListener("click", () => goToStep(2));
  btnBackToProvider.addEventListener("click", () => goToStep(2));

  btnFinish.addEventListener("click", async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey || !selectedProvider) return;

    btnFinish.disabled = true;
    btnFinish.textContent = lang === "zh" ? "保存中..." : "Saving...";

    try {
      const result = await window.electronAPI.invoke("setup:complete", {
        provider: selectedProvider,
        apiKey: apiKey,
        model: selectedModel,
      });

      if (result.success) {
        goToStep(4);
      } else {
        apiKeyError.textContent = result.error || "Setup failed";
        apiKeyError.style.display = "block";
        btnFinish.disabled = false;
        btnFinish.textContent = lang === "zh" ? "完成配置" : "Complete Setup";
      }
    } catch (err) {
      apiKeyError.textContent = err.message || "Unknown error";
      apiKeyError.style.display = "block";
      btnFinish.disabled = false;
      btnFinish.textContent = lang === "zh" ? "完成配置" : "Complete Setup";
    }
  });

  // ── 初始化 ──

  applyI18n();
  goToStep(1);
})();
