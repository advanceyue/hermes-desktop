import { app } from "electron";
import * as path from "path";
import * as fs from "fs";
import { execFileSync } from "child_process";

// ── 网络端口 ──

export const DEFAULT_PORT = 8787;
export const DEFAULT_BIND = "127.0.0.1";

// ── 健康检查 ──

export const HEALTH_TIMEOUT_MS = 60_000;
export const HEALTH_POLL_INTERVAL_MS = 500;

// ── 崩溃冷却 ──

export const CRASH_COOLDOWN_MS = 5_000;

// ── 窗口加载重试 ──

export const WINDOW_LOAD_MAX_RETRIES = 20;
export const WINDOW_LOAD_RETRY_INTERVAL_MS = 1_500;

// ── 窗口尺寸 ──

export const WINDOW_WIDTH = 1200;
export const WINDOW_HEIGHT = 800;
export const WINDOW_MIN_WIDTH = 800;
export const WINDOW_MIN_HEIGHT = 600;

// ── 平台判断 ──

export const IS_WIN = process.platform === "win32";

// ── 路径解析（自动适配 dev / packaged 两种环境） ──

/** 资源根目录（dev 模式指向 targets/<platform-arch>，打包后 afterPack 已拍平） */
export function resolveResourcesPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "resources");
  }
  const target = process.env.HERMES_DESKTOP_TARGET ?? `${process.platform}-${process.arch}`;
  return path.join(app.getAppPath(), "resources", "targets", target);
}

/** dev 模式下的目标产物目录 */
function resolveDevTargetPath(): string {
  return path.join(app.getAppPath(), "resources", "targets", `${process.platform}-${process.arch}`);
}

// ── Python 路径 ──

/** 捆绑的 Python 3.11 二进制 */
export function resolvePythonBin(): string {
  const res = resolveResourcesPath();
  if (IS_WIN) {
    return path.join(res, "python", "python.exe");
  }
  return path.join(res, "python", "bin", "python3.11");
}

/** 虚拟环境路径 */
export function resolveVenvPath(): string {
  return path.join(resolveResourcesPath(), "venv");
}

/** venv 内的 Python 二进制 */
export function resolveVenvPythonBin(): string {
  const venv = resolveVenvPath();
  if (IS_WIN) {
    return path.join(venv, "Scripts", "python.exe");
  }
  return path.join(venv, "bin", "python3.11");
}

// ── Node.js 路径（用于 browser tools） ──

/** Node.js 二进制（捆绑的 Node.js 22） */
export function resolveNodeBin(): string {
  const exe = IS_WIN ? "node.exe" : "node";
  const bundled = path.join(resolveResourcesPath(), "runtime", exe);
  if (fs.existsSync(bundled)) return bundled;
  // dev 模式回退到系统 node
  return "node";
}

// ── WebUI 路径 ──

/** hermes-webui 目录（包含 server.py, api/, static/） */
export function resolveWebUIDir(): string {
  return path.join(resolveResourcesPath(), "webui");
}

/** hermes-webui 入口脚本 */
export function resolveWebUIEntry(): string {
  return path.join(resolveWebUIDir(), "server.py");
}

// ── ripgrep 路径 ──

/** ripgrep 二进制 */
export function resolveRipgrepBin(): string {
  const exe = IS_WIN ? "rg.exe" : "rg";
  return path.join(resolveResourcesPath(), "tools", exe);
}

// ── Hermes 用户数据路径 ──

/** 用户状态目录（~/.hermes/） */
export function resolveHermesHome(): string {
  if (process.env.HERMES_HOME) return process.env.HERMES_HOME;
  const home = IS_WIN ? process.env.USERPROFILE : process.env.HOME;
  return path.join(home ?? "", ".hermes");
}

/** 用户 bin 目录（~/.hermes/bin/，存放 CLI wrapper 脚本） */
export function resolveUserBinDir(): string {
  return path.join(resolveHermesHome(), "bin");
}

/** 用户配置文件路径（config.yaml） */
export function resolveUserConfigPath(): string {
  return path.join(resolveHermesHome(), "config.yaml");
}

/** 用户环境配置（.env） */
export function resolveUserEnvPath(): string {
  return path.join(resolveHermesHome(), ".env");
}

/** 配置备份目录 */
export function resolveConfigBackupDir(): string {
  return path.join(resolveHermesHome(), "config-backups");
}

/** WebUI 诊断日志 */
export function resolveWebUILogPath(): string {
  return path.join(resolveHermesHome(), "desktop.log");
}

/** WebUI 端口解析 */
export function resolveWebUIPort(): number {
  const envRaw = process.env.HERMES_WEBUI_PORT?.trim();
  if (envRaw) {
    const parsed = Number.parseInt(envRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_PORT;
}

// ── 构建 PATH 环境变量 ──

/** 组装 PATH：venv/bin + python/bin + runtime(node) + tools(rg) + 原 PATH */
export function buildEnvPath(): string {
  const res = resolveResourcesPath();
  const venvBin = IS_WIN
    ? path.join(resolveVenvPath(), "Scripts")
    : path.join(resolveVenvPath(), "bin");
  const pythonBin = IS_WIN
    ? path.join(res, "python")
    : path.join(res, "python", "bin");
  const runtimeBin = path.join(res, "runtime");
  const toolsBin = path.join(res, "tools");
  const userBin = resolveUserBinDir();

  return [userBin, venvBin, pythonBin, runtimeBin, toolsBin, process.env.PATH ?? ""]
    .join(path.delimiter);
}

// ── Setup 完成判断 ──

/** 检查 Setup 是否已完成（config.yaml 和 .env 都存在） */
export function isSetupComplete(): boolean {
  const configPath = resolveUserConfigPath();
  const envPath = resolveUserEnvPath();
  // 基本检查：config.yaml 存在且非空
  if (!fs.existsSync(configPath)) return false;
  try {
    const stat = fs.statSync(configPath);
    return stat.size > 10; // 非空文件
  } catch {
    return false;
  }
}

// ── 开发分支标识 ──

export function resolveDevBranchTag(): string {
  if (!process.env.HERMES_DESKTOP_MULTI_INSTANCE) return "";
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: app.getAppPath(),
      timeout: 3000,
      encoding: "utf-8",
    }).trim();
    return branch ? ` [${branch}]` : "";
  } catch {
    return "";
  }
}
