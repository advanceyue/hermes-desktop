import { Tray, Menu, app, nativeImage } from "electron";
import * as path from "path";
import { execSync } from "child_process";
import { WebUIProcess, WebUIState } from "./webui-process";
import { WindowManager } from "./window";

// Dev 模式诊断信息（延迟初始化，避免模块加载时 app 未就绪）
let devInfo: { branch: string; startedAt: Date } | null = null;
let devInfoResolved = false;
function getDevInfo() {
  if (devInfoResolved) return devInfo;
  devInfoResolved = true;
  try {
    if (app.isPackaged) return null;
    const startedAt = new Date();
    let branch = "unknown";
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: app.getAppPath(),
        encoding: "utf-8",
        timeout: 3000,
      }).trim();
    } catch {}
    devInfo = { branch, startedAt };
  } catch {}
  return devInfo;
}

interface TrayOptions {
  windowManager: WindowManager;
  webui: WebUIProcess;
  onRestartWebUI: () => void;
  onQuit: () => void;
  onCheckUpdates: () => void;
}

type TrayStrings = {
  stateRunning: string;
  stateStarting: string;
  stateStopping: string;
  stateStopped: string;
  openApp: string;
  restartWebUI: string;
  checkUpdates: string;
  quit: string;
};

const I18N: Record<string, TrayStrings> = {
  en: {
    stateRunning: "Hermes: Running",
    stateStarting: "Hermes: Starting…",
    stateStopping: "Hermes: Stopping…",
    stateStopped: "Hermes: Stopped",
    openApp: "Open Hermes Desktop",
    restartWebUI: "Restart Hermes",
    checkUpdates: "Check for Updates",
    quit: "Quit Hermes Desktop",
  },
  zh: {
    stateRunning: "Hermes: 运行中",
    stateStarting: "Hermes: 启动中…",
    stateStopping: "Hermes: 停止中…",
    stateStopped: "Hermes: 已停止",
    openApp: "打开 Hermes Desktop",
    restartWebUI: "重启 Hermes",
    checkUpdates: "检查更新",
    quit: "退出 Hermes Desktop",
  },
};

function getTrayStrings(): TrayStrings {
  const locale = app.getLocale();
  return locale.startsWith("zh") ? I18N.zh : I18N.en;
}

function getStateLabel(state: WebUIState): string {
  const s = getTrayStrings();
  const map: Record<WebUIState, string> = {
    running: s.stateRunning,
    starting: s.stateStarting,
    stopping: s.stateStopping,
    stopped: s.stateStopped,
  };
  return map[state];
}

export class TrayManager {
  private tray: Tray | null = null;
  private opts: TrayOptions | null = null;

  create(opts: TrayOptions): void {
    this.opts = opts;

    const iconName =
      process.platform === "darwin" ? "tray-iconTemplate@2x.png" : "tray-icon@2x.png";
    const iconPath = path.join(app.getAppPath(), "assets", iconName);

    let icon: Electron.NativeImage;
    try {
      icon = nativeImage.createFromPath(iconPath);
      if (process.platform === "darwin") icon.setTemplateImage(true);
    } catch {
      icon = nativeImage.createEmpty();
    }

    this.tray = new Tray(icon);
    this.tray.setToolTip("Hermes Desktop");

    this.tray.on("click", () => {
      opts.windowManager.show({ port: opts.webui.getPort() });
    });

    this.updateMenu();
  }

  updateMenu(): void {
    if (!this.tray || !this.opts) return;

    const { windowManager, webui, onRestartWebUI, onQuit, onCheckUpdates } = this.opts;
    const t = getTrayStrings();
    const state = webui.getState();
    const inTransition = state === "starting" || state === "stopping";

    const di = getDevInfo();
    const devItems: Electron.MenuItemConstructorOptions[] = di
      ? [
          { label: `dev: ${di.branch}`, enabled: false },
          { label: `started: ${di.startedAt.toLocaleTimeString()}`, enabled: false },
          { type: "separator" },
        ]
      : [];

    const menu = Menu.buildFromTemplate([
      ...devItems,
      {
        label: t.openApp,
        click: () => windowManager.show({ port: webui.getPort() }),
      },
      { type: "separator" },
      { label: getStateLabel(state), enabled: false },
      { label: t.restartWebUI, enabled: !inTransition, click: onRestartWebUI },
      { type: "separator" },
      { label: t.checkUpdates, click: onCheckUpdates },
      { type: "separator" },
      { label: t.quit, click: onQuit },
    ]);

    this.tray.setContextMenu(menu);
  }

  setTooltip(text: string): void {
    this.tray?.setToolTip(text);
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
