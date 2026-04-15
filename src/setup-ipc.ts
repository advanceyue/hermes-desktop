import { ipcMain } from "electron";
import * as fs from "fs";
import { resolveHermesHome, resolveUserConfigPath, resolveUserEnvPath } from "./constants";
import { SetupManager } from "./setup-manager";
import * as log from "./logger";

interface SetupIpcOptions {
  setupManager: SetupManager;
}

export function registerSetupIpc(opts: SetupIpcOptions): void {
  const { setupManager } = opts;

  // Setup 完成
  ipcMain.handle("setup:complete", async (_e, config: {
    provider: string;
    apiKey: string;
    model: string;
  }) => {
    try {
      const hermesHome = resolveHermesHome();
      fs.mkdirSync(hermesHome, { recursive: true });

      // 写入 config.yaml
      const configYaml = [
        "model:",
        `  default: ${config.model}`,
        `  provider: ${config.provider}`,
        "agent:",
        "  max_turns: 90",
        "  reasoning_effort: medium",
        "terminal:",
        "  backend: local",
        "compression:",
        "  enabled: true",
        "  threshold: 0.5",
        "",
      ].join("\n");

      fs.writeFileSync(resolveUserConfigPath(), configYaml, "utf-8");

      // 写入 .env
      const envPath = resolveUserEnvPath();
      const keyEnvMap: Record<string, string> = {
        openrouter: "OPENROUTER_API_KEY",
        anthropic: "ANTHROPIC_API_KEY",
        openai: "OPENAI_API_KEY",
        gemini: "GOOGLE_API_KEY",
        google: "GOOGLE_API_KEY",
      };
      const envVar = keyEnvMap[config.provider] || `${config.provider.toUpperCase()}_API_KEY`;
      fs.writeFileSync(envPath, `${envVar}=${config.apiKey}\n`, "utf-8");

      log.info(`[setup] 配置写入完成: provider=${config.provider} model=${config.model}`);
      const ok = await setupManager.complete();
      return { success: ok };
    } catch (err: any) {
      log.error(`[setup] 配置写入失败: ${err?.message ?? err}`);
      return { success: false, error: err?.message ?? String(err) };
    }
  });

  // 验证 API key
  ipcMain.handle("setup:validate-key", async (_e, _provider: string, apiKey: string) => {
    return { valid: Boolean(apiKey?.trim()) };
  });
}
