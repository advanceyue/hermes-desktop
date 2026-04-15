/**
 * Hermes Desktop provider 配置。
 * 简化版 — Hermes 使用 YAML config + .env，不同于 OneClaw 的 JSON 配置。
 */

export interface HermesProvider {
  id: string;
  label: string;
  envVar: string;
  defaultModel: string;
  models: string[];
}

export const PROVIDERS: HermesProvider[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    envVar: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-20250514",
    models: ["claude-opus-4-20250514", "claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"],
  },
  {
    id: "openai",
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "o1", "o1-mini"],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    envVar: "GOOGLE_API_KEY",
    defaultModel: "gemini-2.5-pro",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    defaultModel: "anthropic/claude-sonnet-4",
    models: ["anthropic/claude-opus-4", "anthropic/claude-sonnet-4", "google/gemini-2.5-pro", "openai/gpt-4o"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    envVar: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
];
