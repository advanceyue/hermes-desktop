import { BrowserWindow, app } from "electron";
import * as path from "path";
import { resolveDevBranchTag } from "./constants";

// Setup 窗口生命周期管理
export class SetupManager {
  private setupWin: BrowserWindow | null = null;
  private onComplete?: () => boolean | Promise<boolean>;
  private completing = false;

  setOnComplete(cb: () => boolean | Promise<boolean>): void {
    this.onComplete = cb;
  }

  showSetup(): void {
    const lang = app.getLocale().startsWith("zh") ? "zh" : "en";
    const tag = resolveDevBranchTag();
    const title = lang === "zh" ? `Hermes Desktop 安装引导${tag}` : `Hermes Desktop Setup${tag}`;

    this.setupWin = new BrowserWindow({
      width: 580,
      height: 680,
      resizable: false,
      title,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, "preload.js"),
      },
    });
    this.setupWin.on("page-title-updated", (event) => {
      event.preventDefault();
      this.setupWin?.setTitle(title);
    });
    this.setupWin.setMenuBarVisibility(false);
    this.setupWin.removeMenu();

    this.setupWin.on("close", () => {
      app.quit();
    });

    this.setupWin.loadFile(path.join(__dirname, "..", "setup", "index.html"), {
      query: { lang },
    });
    this.setupWin.show();
  }

  async complete(): Promise<boolean> {
    if (this.completing) return false;
    this.completing = true;

    try {
      const ok = this.onComplete ? await this.onComplete() : true;
      if (!ok) return false;

      if (this.setupWin && !this.setupWin.isDestroyed()) {
        this.setupWin.removeAllListeners("close");
        this.setupWin.close();
      }
      this.setupWin = null;
      return true;
    } catch (err) {
      console.error("[setup] onComplete 回调错误:", err);
      return false;
    } finally {
      this.completing = false;
    }
  }

  isSetupOpen(): boolean {
    return this.setupWin != null && !this.setupWin.isDestroyed();
  }

  focusSetup(): void {
    if (this.isSetupOpen()) {
      this.setupWin!.show();
      this.setupWin!.focus();
    }
  }
}
