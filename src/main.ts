import * as fs from "fs";
import * as path from "path";

// 最早期调试：写到文件确认 main.js 是否被加载
try {
  const home = process.env.HOME || "/tmp";
  fs.appendFileSync(path.join(home, ".hermes", "boot.log"),
    `[${new Date().toISOString()}] main.ts loaded, argv=${process.argv.join(" ")}\n`);
} catch {}

import { app, ipcMain, shell, Menu, BrowserWindow } from "electron";
import { WebUIProcess } from "./webui-process";
import { WindowManager } from "./window";
import { TrayManager } from "./tray";
import { SetupManager } from "./setup-manager";
import { registerSetupIpc } from "./setup-ipc";
import {
  setupAutoUpdater,
  checkForUpdates,
  downloadAndInstallUpdate,
  getUpdateBannerState,
  startAutoCheckSchedule,
  stopAutoCheckSchedule,
  setBeforeQuitForInstallCallback,
  setProgressCallback,
  setUpdateBannerStateCallback,
} from "./auto-updater";
import { isSetupComplete, resolveWebUIPort, resolveWebUILogPath, resolveHermesHome } from "./constants";
import * as log from "./logger";

// ── 单实例锁 ──

if (!process.env.HERMES_DESKTOP_MULTI_INSTANCE && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ── 全局错误兜底 ──

process.on("uncaughtException", (err) => {
  if ((err as NodeJS.ErrnoException).code === "EPIPE") return;
  log.error(`uncaughtException: ${err.stack || err.message}`);
});
process.on("unhandledRejection", (reason) => {
  log.error(`unhandledRejection: ${reason}`);
});

// ── 核心组件 ──

const webui = new WebUIProcess({
  port: resolveWebUIPort(),
  onStateChange: (state) => {
    tray.updateMenu();
    if (state === "running") {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send("webui:ready");
      }
    }
  },
});
const windowManager = new WindowManager();
const tray = new TrayManager();
const setupManager = new SetupManager();

// ── 显示主窗口的统一入口 ──

function showMainWindow(): Promise<void> {
  return windowManager.show({ port: webui.getPort() });
}

// ── 启动链路：启动 WebUI → 打开主窗口 ──

const MAX_START_ATTEMPTS = 3;

async function ensureWebUIRunning(source: string): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt++) {
    if (attempt === 1) {
      await webui.start();
    } else {
      log.warn(`WebUI 启动重试 ${attempt}/${MAX_START_ATTEMPTS}: ${source}`);
      await webui.restart();
    }
    if (webui.getState() === "running") {
      log.info(`WebUI 启动成功（第 ${attempt} 次尝试）: ${source}`);
      return true;
    }
  }
  return false;
}

async function startWebUIAndShowMain(source: string): Promise<boolean> {
  log.info(`启动链路开始: ${source}`);
  const running = await ensureWebUIRunning(source);
  if (!running) {
    log.error(`WebUI 启动失败: ${source}`);
    log.error(`诊断日志: ${resolveWebUILogPath()}`);
  }
  await showMainWindow();
  return running;
}

// ── IPC 注册 ──

ipcMain.on("webui:restart", () => {
  webui.restart().catch((err) => log.error(`WebUI 重启失败: ${err}`));
});
ipcMain.handle("webui:state", () => webui.getState());
ipcMain.handle("webui:port", () => webui.getPort());
ipcMain.on("app:check-updates", () => checkForUpdates(true));
ipcMain.handle("app:get-update-state", () => getUpdateBannerState());
ipcMain.handle("app:download-and-install-update", () => downloadAndInstallUpdate());
ipcMain.handle("app:open-external", (_e, url: string) => shell.openExternal(url));
ipcMain.handle("app:open-path", (_e, filePath: string) => shell.openPath(filePath));

registerSetupIpc({ setupManager });

// ── 退出 ──

async function quit(): Promise<void> {
  stopAutoCheckSchedule();
  windowManager.destroy();
  await webui.stop();
  tray.destroy();
  app.quit();
}

// ── Setup 完成后：启动 WebUI → 打开主窗口 ──

setupManager.setOnComplete(async () => {
  const running = await ensureWebUIRunning("setup:complete");
  if (!running) return false;
  await showMainWindow();
  return true;
});

// ── macOS Dock 可见性 ──

function updateDockVisibility(): void {
  if (process.platform !== "darwin" || !app.dock) return;
  const anyVisible = BrowserWindow.getAllWindows().some(
    (w) => !w.isDestroyed() && w.isVisible(),
  );
  if (anyVisible) {
    app.dock.show();
  } else {
    app.dock.hide();
  }
}

// ── 应用就绪 ──

app.whenReady().then(async () => {
  log.info("app ready");

  // Dock 可见性管理
  app.on("browser-window-created", (_e, win) => {
    win.on("show", updateDockVisibility);
    win.on("hide", updateDockVisibility);
    win.on("closed", updateDockVisibility);
  });

  // macOS 应用菜单
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      { role: "windowMenu" },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }

  // 自动更新
  setupAutoUpdater();
  setUpdateBannerStateCallback((_state) => {
    // 可扩展：推送更新状态到渲染层
  });
  startAutoCheckSchedule();
  setBeforeQuitForInstallCallback(() => {
    stopAutoCheckSchedule();
    windowManager.prepareForAppQuit();
  });
  setProgressCallback((pct) => {
    tray.setTooltip(pct != null ? `Hermes Desktop — 下载更新 ${pct.toFixed(0)}%` : "Hermes Desktop");
  });

  // 托盘
  tray.create({
    windowManager,
    webui,
    onRestartWebUI: () => webui.restart().catch((err) => log.error(`WebUI 重启失败: ${err}`)),
    onQuit: quit,
    onCheckUpdates: () => checkForUpdates(true),
  });

  // 确保 ~/.hermes 存在
  fs.mkdirSync(resolveHermesHome(), { recursive: true });

  // 启动判定
  if (isSetupComplete()) {
    await startWebUIAndShowMain("app:startup");
  } else {
    setupManager.showSetup();
  }
});

// ── 二次启动 → 聚焦已有窗口 ──

app.on("second-instance", () => {
  if (setupManager.isSetupOpen()) {
    setupManager.focusSetup();
  } else {
    showMainWindow().catch((err) => {
      log.error(`second-instance 打开主窗口失败: ${err}`);
    });
  }
});

// ── macOS: 点击 Dock 图标时恢复窗口 ──

app.on("activate", () => {
  if (setupManager.isSetupOpen()) {
    setupManager.focusSetup();
  } else {
    showMainWindow().catch((err) => {
      log.error(`activate 打开主窗口失败: ${err}`);
    });
  }
});

// ── 托盘应用：所有窗口关闭不退出 ──

app.on("window-all-closed", () => {
  // 不退出 — 后台保持运行
});

// ── 退出前清理 ──

app.on("before-quit", () => {
  windowManager.prepareForAppQuit();
  windowManager.destroy();
  webui.stop().catch(() => {});
});
