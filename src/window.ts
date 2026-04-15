import { BrowserWindow, app, shell } from "electron";
import * as path from "path";
import * as log from "./logger";
import {
  WINDOW_WIDTH,
  WINDOW_HEIGHT,
  WINDOW_MIN_WIDTH,
  WINDOW_MIN_HEIGHT,
  resolveDevBranchTag,
} from "./constants";

interface ShowOptions {
  port: number;
}

function resolveMainWindowTitle(): string {
  const tag = resolveDevBranchTag();
  return app.getLocale().startsWith("zh")
    ? `Hermes Desktop${tag}`
    : `Hermes Desktop${tag}`;
}

export class WindowManager {
  private win: BrowserWindow | null = null;
  private allowAppQuit = false;

  // 显示主窗口（加载 WebUI）
  async show(opts: ShowOptions): Promise<void> {
    if (this.win && !this.win.isDestroyed()) {
      log.info(`复用主窗口: id=${this.win.id}`);
      this.win.show();
      this.win.focus();
      return;
    }

    log.info(`创建主窗口: port=${opts.port}`);

    const title = resolveMainWindowTitle();
    const isMac = process.platform === "darwin";
    this.win = new BrowserWindow({
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      minWidth: WINDOW_MIN_WIDTH,
      minHeight: WINDOW_MIN_HEIGHT,
      show: false,
      title,
      autoHideMenuBar: true,
      // 使用默认标题栏，避免与 WebUI 工具栏重叠
      // titleBarStyle: "hidden",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, "preload.js"),
      },
    });
    this.win.on("page-title-updated", (event) => {
      event.preventDefault();
      this.win?.setTitle(title);
    });
    this.win.setMenuBarVisibility(false);
    this.win.removeMenu();

    // DevTools 快捷键: F12 / Cmd+Shift+I / Ctrl+Shift+I
    this.win.webContents.on("before-input-event", (_event, input) => {
      if (
        input.key === "F12" ||
        (input.control && input.shift && input.key.toLowerCase() === "i") ||
        (input.meta && input.shift && input.key.toLowerCase() === "i")
      ) {
        this.win?.webContents.toggleDevTools();
      }
    });

    // 拦截外部链接 — 用系统浏览器打开
    this.win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
        return { action: "allow" };
      }
      shell.openExternal(url);
      return { action: "deny" };
    });

    // 渲染进程崩溃监控
    this.win.webContents.on("render-process-gone", (_e, details) => {
      log.error(`render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`);
    });
    this.win.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame) return;
      log.error(`WebContents 主帧加载失败: code=${code} description=${description} url=${url}`);
    });
    this.win.webContents.on("did-finish-load", () => {
      log.info("WebContents 加载完成");
    });
    this.win.on("unresponsive", () => {
      log.warn("窗口无响应");
    });

    // 关闭 → 隐藏到托盘
    this.win.on("close", (e) => {
      if (this.allowAppQuit) return;
      e.preventDefault();
      this.win?.hide();
    });
    this.win.on("closed", () => {
      this.win = null;
      this.allowAppQuit = false;
    });

    // 加载 hermes-webui
    const url = `http://127.0.0.1:${opts.port}`;
    log.info(`准备加载 WebUI: ${url}`);
    try {
      await this.win.loadURL(url);
    } catch (err) {
      log.error(`WebUI 加载失败: url=${url} err=${err}`);
      await this.loadErrorPage();
      this.win.show();
      return;
    }

    this.win.show();
    if (process.env.HERMES_DESKTOP_DEBUG) {
      this.win.webContents.openDevTools();
    }
    log.info("主窗口显示");
  }

  // 标记应用进入退出流程
  prepareForAppQuit(): void {
    this.allowAppQuit = true;
  }

  // 销毁窗口
  destroy(): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.removeAllListeners("close");
    this.win.close();
    this.win = null;
  }

  getWindow(): BrowserWindow | null {
    return this.win;
  }

  // 错误页
  private async loadErrorPage(): Promise<void> {
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hermes Desktop - Error</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0b1020; color: #e6ebff;
    }
    .card {
      width: min(680px, calc(100vw - 40px));
      border-radius: 14px; background: #111938;
      border: 1px solid #2a366f; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
      padding: 22px 20px;
    }
    h1 { margin: 0 0 10px; font-size: 20px; }
    p { margin: 0 0 10px; line-height: 1.5; color: #c8d2ff; }
    button {
      border: 0; border-radius: 8px; padding: 10px 14px;
      font-weight: 600; cursor: pointer; color: #fff; background: #8B5CF6;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>Hermes WebUI not available</h1>
    <p>Hermes WebUI 未能加载。请尝试重新启动应用。</p>
    <button id="retryBtn" type="button">Retry</button>
  </main>
  <script>
    document.getElementById("retryBtn")?.addEventListener("click", () => {
      window.location.reload();
    });
  </script>
</body>
</html>`;

    await this.win!.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }
}
