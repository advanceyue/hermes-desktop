import { autoUpdater } from "electron-updater";
import { dialog } from "electron";
import * as log from "./logger";

// ── 类型 ──

export type UpdateBannerState = {
  status: "idle" | "available" | "downloading" | "ready" | "failed";
  version?: string;
  percent?: number;
};

// ── 常量 ──

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 30 * 1000;

// ── 状态 ──

let isManualCheck = false;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let progressCallback: ((percent: number | null) => void) | null = null;
let beforeQuitForInstallCallback: (() => void) | null = null;
let updateBannerStateCallback: ((state: UpdateBannerState) => void) | null = null;
let updateBannerState: UpdateBannerState = { status: "idle" };

function formatUpdaterError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function publishState(state: Partial<UpdateBannerState>): void {
  updateBannerState = { ...updateBannerState, ...state };
  updateBannerStateCallback?.({ ...updateBannerState });
}

export function setupAutoUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.logger = {
    info: (msg: unknown) => log.info(`[updater] ${msg}`),
    warn: (msg: unknown) => log.warn(`[updater] ${msg}`),
    error: (msg: unknown) => log.error(`[updater] ${msg}`),
  };

  autoUpdater.on("checking-for-update", () => {
    log.info("[updater] 正在检查更新...");
  });

  autoUpdater.on("update-available", (info) => {
    log.info(`[updater] 发现新版本 ${info.version}`);
    publishState({ status: "available", version: info.version });
    isManualCheck = false;
  });

  autoUpdater.on("update-not-available", (info) => {
    log.info(`[updater] 已是最新版本 ${info.version}`);
    publishState({ status: "idle" });
    if (isManualCheck) {
      void dialog.showMessageBox({
        type: "info",
        title: "No Updates",
        message: `当前已是最新版本 (${info.version})`,
      });
    }
    isManualCheck = false;
  });

  autoUpdater.on("download-progress", (progress) => {
    const pct = Math.max(0, Math.min(100, progress.percent || 0));
    progressCallback?.(pct);
    publishState({ status: "downloading", percent: pct });
  });

  autoUpdater.on("update-downloaded", () => {
    log.info("[updater] 更新下载完成");
    progressCallback?.(null);
    publishState({ status: "ready" });
    beforeQuitForInstallCallback?.();
    autoUpdater.quitAndInstall(false, true);
  });

  autoUpdater.on("error", (err) => {
    log.error(`[updater] 更新失败: ${err.message}`);
    progressCallback?.(null);
    publishState({ status: "failed" });
    if (isManualCheck) {
      void dialog.showMessageBox({
        type: "error",
        title: "Update Error",
        message: "检查更新失败",
        detail: err.message,
      });
    }
    isManualCheck = false;
  });
}

export function checkForUpdates(manual = false): void {
  isManualCheck = manual;
  void autoUpdater.checkForUpdates().catch((err) => {
    log.error(`[updater] 检查更新调用失败: ${formatUpdaterError(err)}`);
    if (manual) {
      void dialog.showMessageBox({
        type: "error",
        title: "Update Error",
        message: "检查更新失败",
        detail: formatUpdaterError(err),
      });
    }
    isManualCheck = false;
  });
}

export async function downloadAndInstallUpdate(): Promise<boolean> {
  if (updateBannerState.status !== "available") return false;
  publishState({ status: "downloading", percent: 0 });
  try {
    await autoUpdater.downloadUpdate();
    return true;
  } catch (err) {
    log.error(`[updater] 下载更新失败: ${formatUpdaterError(err)}`);
    publishState({ status: "failed" });
    return false;
  }
}

export function startAutoCheckSchedule(): void {
  startupTimer = setTimeout(() => {
    checkForUpdates(false);
    intervalTimer = setInterval(() => checkForUpdates(false), CHECK_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
}

export function stopAutoCheckSchedule(): void {
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
  if (intervalTimer) { clearInterval(intervalTimer); intervalTimer = null; }
}

export function setProgressCallback(cb: (percent: number | null) => void): void {
  progressCallback = cb;
}

export function setBeforeQuitForInstallCallback(cb: () => void): void {
  beforeQuitForInstallCallback = cb;
}

export function setUpdateBannerStateCallback(cb: (state: UpdateBannerState) => void): void {
  updateBannerStateCallback = cb;
  updateBannerStateCallback({ ...updateBannerState });
}

export function getUpdateBannerState(): UpdateBannerState {
  return { ...updateBannerState };
}
