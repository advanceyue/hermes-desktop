import { ChildProcess, spawn } from "child_process";
import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import { app } from "electron";
import {
  DEFAULT_PORT,
  HEALTH_TIMEOUT_MS,
  HEALTH_POLL_INTERVAL_MS,
  CRASH_COOLDOWN_MS,
  IS_WIN,
  resolveWebUILogPath,
  resolvePythonBin,
  resolveWebUIEntry,
  resolveWebUIDir,
  resolveHermesHome,
  resolveVenvPath,
  resolveResourcesPath,
  resolveWebUIPort,
  buildEnvPath,
} from "./constants";

// 诊断日志（写入 ~/.hermes/desktop.log）
const LOG_PATH = resolveWebUILogPath();
const MAX_DIAG_LOG_SIZE = 5 * 1024 * 1024;
const DIAG_ROTATION_CHECK_INTERVAL = 1000;
let diagWriteCount = 0;

function diagLog(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { process.stderr.write(line); } catch {}
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, line);
    if (++diagWriteCount >= DIAG_ROTATION_CHECK_INTERVAL) {
      if (fs.statSync(LOG_PATH).size > MAX_DIAG_LOG_SIZE) {
        fs.writeFileSync(LOG_PATH, "[truncated]\n");
      }
      diagWriteCount = 0;
    }
  } catch {}
}

export type WebUIState = "stopped" | "starting" | "running" | "stopping";

interface WebUIOptions {
  port?: number;
  onStateChange?: (state: WebUIState) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WebUIProcess {
  private proc: ChildProcess | null = null;
  private state: WebUIState = "stopped";
  private port: number;
  private lastCrashTime = 0;
  private onStateChange?: (state: WebUIState) => void;
  private startedAt: number | null = null;

  // 世代计数器：每次 spawn 递增，exit handler 只处理同代进程的退出
  private generation = 0;

  constructor(opts: WebUIOptions) {
    this.port = opts.port ?? DEFAULT_PORT;
    this.onStateChange = opts.onStateChange;
  }

  getState(): WebUIState {
    return this.state;
  }

  getPort(): number {
    return this.port;
  }

  getStartedAt(): number | null {
    return this.startedAt;
  }

  setPort(port: number): void {
    if (port > 0 && port <= 65535) {
      this.port = port;
    }
  }

  private setState(newState: WebUIState): void {
    const prev = this.state;
    this.state = newState;
    if (newState === "running") {
      this.startedAt = Date.now();
    }
    diagLog(`state: ${prev} -> ${newState}`);
    this.onStateChange?.(newState);
  }

  // 启动 WebUI 子进程
  async start(): Promise<void> {
    if (this.state === "running" || this.state === "starting") return;

    // 前一次 stop 还未完成，等待其结束再启动
    if (this.state === "stopping") {
      diagLog("start() 等待前一次 stop 完成");
      const deadline = Date.now() + 6000;
      while (this.state === "stopping" && Date.now() < deadline) {
        await sleep(100);
      }
      if (this.state === "stopping") {
        diagLog("WARN: start() 等待 stop 超时，强制标记 stopped");
        this.proc = null;
        this.setState("stopped");
      }
    }

    // 崩溃冷却期
    const elapsed = Date.now() - this.lastCrashTime;
    if (this.lastCrashTime > 0 && elapsed < CRASH_COOLDOWN_MS) {
      await sleep(CRASH_COOLDOWN_MS - elapsed);
    }

    this.setState("starting");

    // 使用 standalone Python（不依赖 @rpath），而非 venv 的 Python
    // macOS SIP/hardened runtime 会清除 DYLD_LIBRARY_PATH，导致 venv python 找不到 libpython
    const pythonBin = resolvePythonBin();
    const entry = resolveWebUIEntry();
    const cwd = resolveWebUIDir();
    const hermesHome = resolveHermesHome();

    // 诊断：打印所有关键路径
    diagLog(`--- webui start ---`);
    diagLog(`platform=${process.platform} arch=${process.arch} packaged=${app.isPackaged}`);
    diagLog(`resourcesPath=${resolveResourcesPath()}`);
    diagLog(`pythonBin=${pythonBin} exists=${fs.existsSync(pythonBin)}`);
    diagLog(`entry=${entry} exists=${fs.existsSync(entry)}`);
    diagLog(`cwd=${cwd} exists=${fs.existsSync(cwd)}`);
    diagLog(`hermesHome=${hermesHome}`);
    diagLog(`port=${this.port}`);

    // 检查关键文件
    if (!fs.existsSync(pythonBin)) {
      diagLog(`FATAL: Python 二进制不存在: ${pythonBin}`);
      this.setState("stopped");
      return;
    }
    if (!fs.existsSync(entry)) {
      diagLog(`FATAL: WebUI 入口不存在: ${entry}`);
      this.setState("stopped");
      return;
    }

    // 确保 ~/.hermes 目录存在
    fs.mkdirSync(hermesHome, { recursive: true });

    // 递增世代
    const gen = ++this.generation;

    const envPath = buildEnvPath();
    const args = [entry];

    diagLog(`spawn: ${pythonBin} ${args.join(" ")} (gen=${gen})`);

    this.proc = spawn(pythonBin, args, {
      cwd,
      env: {
        ...process.env,
        HERMES_HOME: hermesHome,
        HERMES_WEBUI_PORT: String(this.port),
        HERMES_WEBUI_HOST: "127.0.0.1",
        VIRTUAL_ENV: resolveVenvPath(),
        PATH: envPath,
        // 告诉 hermes-agent 安装位置
        HERMES_INSTALL_ROOT: resolveResourcesPath(),
        // 确保 Python 不缓冲输出
        PYTHONUNBUFFERED: "1",
        // 使用 standalone python 但加载 venv 的 site-packages
        // Windows: Lib/site-packages, macOS/Linux: lib/python3.11/site-packages
        PYTHONPATH: IS_WIN
          ? path.join(resolveVenvPath(), "Lib", "site-packages")
          : path.join(resolveVenvPath(), "lib", "python3.11", "site-packages"),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const childPid = this.proc.pid ?? -1;

    // 捕获 spawn 错误
    this.proc.on("error", (err) => {
      diagLog(`spawn error: ${err.message}`);
    });

    // 转发日志
    this.proc.stdout?.on("data", (d: Buffer) => {
      const s = d.toString();
      try { process.stdout.write(`[webui] ${s}`); } catch {}
      diagLog(`stdout: ${s.trimEnd()}`);
    });
    this.proc.stderr?.on("data", (d: Buffer) => {
      const s = d.toString();
      try { process.stderr.write(`[webui] ${s}`); } catch {}
      diagLog(`stderr: ${s.trimEnd()}`);
    });

    // 退出处理
    this.proc.on("exit", (code, signal) => {
      diagLog(`child exit: code=${code} signal=${signal} gen=${gen} currentGen=${this.generation} prevState=${this.state}`);
      if (gen !== this.generation) {
        diagLog(`SKIP: 旧世代 exit 事件 (gen=${gen}, current=${this.generation})`);
        return;
      }
      if (this.state === "stopping") {
        this.setState("stopped");
      } else if (this.state === "running") {
        diagLog("WARN: WebUI 运行中意外退出");
        this.lastCrashTime = Date.now();
        this.setState("stopped");
      } else {
        this.lastCrashTime = Date.now();
        this.setState("stopped");
      }
      this.proc = null;
    });

    // 轮询健康检查
    const healthy = await this.waitForHealth(HEALTH_TIMEOUT_MS, childPid);
    if (healthy) {
      await sleep(300);
      if (this.isChildAlive(childPid)) {
        diagLog("health check passed, child alive");
        this.setState("running");
      } else {
        diagLog("WARN: health check passed 但子进程已退出");
        this.setState("stopped");
      }
    } else {
      diagLog("FATAL: health check timeout");
      await this.stop();
    }
  }

  // 停止 WebUI
  async stop(): Promise<void> {
    if (!this.proc || this.state === "stopped" || this.state === "stopping") return;

    const pid = this.proc.pid ?? 0;
    this.setState("stopping");

    // 发送终止信号
    if (IS_WIN && pid > 0) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    } else {
      try {
        this.proc.kill("SIGTERM");
      } catch {}
    }

    // 等待退出（最多 5 秒）
    const deadline = Date.now() + 5000;
    while (this.proc && Date.now() < deadline) {
      await sleep(100);
    }

    // 超时强杀
    if (this.proc && pid > 0) {
      diagLog(`WARN: 子进程未在 5s 内退出，强制终止 (pid=${pid})`);
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }

    this.proc = null;
    if ((this.state as WebUIState) !== "stopped") {
      this.setState("stopped");
    }
  }

  // 重启
  async restart(): Promise<void> {
    diagLog("restart requested");
    await this.stop();
    await this.start();
  }

  // HTTP 健康检查
  private probeHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(
        `http://127.0.0.1:${this.port}/health`,
        { timeout: 3000 },
        (res) => {
          resolve(res.statusCode === 200);
          res.resume();
        },
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  // 等待健康检查通过
  private async waitForHealth(timeout: number, childPid: number): Promise<boolean> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (!this.isChildAlive(childPid)) {
        diagLog("child exited during health poll");
        return false;
      }
      if (await this.probeHealth()) return true;
      await sleep(HEALTH_POLL_INTERVAL_MS);
    }
    return false;
  }

  // 检查子进程是否存活
  private isChildAlive(pid: number): boolean {
    if (pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
