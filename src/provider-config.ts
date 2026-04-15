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
  /** If true, the user can enter a custom base URL for the API endpoint. */
  customBaseUrl?: boolean;
  /** Default base URL (shown as placeholder). */
  defaultBaseUrl?: string;
  /** If true, the API key is optional (e.g. local models). */
  apiKeyOptional?: boolean;
  /** If true, the user can type a free-form model name instead of picking from the list. */
  customModelInput?: boolean;
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
  {
    id: "ollama",
    label: "Ollama (Local)",
    envVar: "OPENAI_API_KEY",
    defaultModel: "",
    models: [],
    customBaseUrl: true,
    defaultBaseUrl: "http://localhost:11434/v1",
    apiKeyOptional: true,
    customModelInput: true,
  },
  {
    id: "custom",
    label: "Custom (OpenAI Compatible)",
    envVar: "OPENAI_API_KEY",
    defaultModel: "",
    models: [],
    customBaseUrl: true,
    defaultBaseUrl: "http://localhost:8080/v1",
    apiKeyOptional: false,
    customModelInput: true,
  },
];
