import * as fs from "fs";
import * as path from "path";
import { resolveResourcesPath, resolveVenvPath, resolveUserBinDir, IS_WIN } from "./constants";

/**
 * 生成 hermes CLI 包装脚本，让用户在终端里直接运行 `hermes` 命令。
 */
export function ensureHermesCliWrapper(): void {
  const binDir = resolveUserBinDir();
  fs.mkdirSync(binDir, { recursive: true });

  if (IS_WIN) {
    // Windows: 生成 .cmd 脚本
    const cmdPath = path.join(binDir, "hermes.cmd");
    const res = resolveResourcesPath();
    const script = [
      "@echo off",
      `set "VIRTUAL_ENV=${path.join(res, "venv")}"`,
      `set "PATH=${path.join(res, "venv", "Scripts")};${path.join(res, "python")};${path.join(res, "runtime")};${path.join(res, "tools")};%PATH%"`,
      `"${path.join(res, "python", "python.exe")}" -m hermes_cli.main %*`,
    ].join("\r\n") + "\r\n";
    fs.writeFileSync(cmdPath, script, "utf-8");
  } else {
    // macOS / Linux: 生成 shell 脚本
    const shPath = path.join(binDir, "hermes");
    const res = resolveResourcesPath();
    const script = [
      "#!/usr/bin/env bash",
      "# Hermes Desktop CLI wrapper — auto-generated",
      `APP_RES="${res}"`,
      `export VIRTUAL_ENV="$APP_RES/venv"`,
      `export PATH="$APP_RES/venv/bin:$APP_RES/python/bin:$APP_RES/runtime:$APP_RES/tools:$PATH"`,
      `exec "$APP_RES/python/bin/python3.11" -m hermes_cli.main "$@"`,
      "",
    ].join("\n");
    fs.writeFileSync(shPath, script, "utf-8");
    fs.chmodSync(shPath, 0o755);
  }
}

/**
 * 应用启动时确保 CLI wrapper 存在且指向当前安装路径。
 */
export async function reconcileCliOnAppLaunch(): Promise<void> {
  try {
    ensureHermesCliWrapper();
  } catch {}
}
