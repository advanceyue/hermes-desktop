import { contextBridge, ipcRenderer } from "electron";

// 安全桥接 — 向渲染进程暴露有限 API
contextBridge.exposeInMainWorld("electronAPI", {
  // 通用 invoke
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),

  // WebUI 控制
  restartWebUI: () => ipcRenderer.send("webui:restart"),
  getWebUIState: () => ipcRenderer.invoke("webui:state"),
  getWebUIPort: () => ipcRenderer.invoke("webui:port"),

  // 自动更新
  checkForUpdates: () => ipcRenderer.send("app:check-updates"),
  getUpdateState: () => ipcRenderer.invoke("app:get-update-state"),
  downloadAndInstallUpdate: () => ipcRenderer.invoke("app:download-and-install-update"),

  // 外部链接
  openExternal: (url: string) => ipcRenderer.invoke("app:open-external", url),
  openPath: (filePath: string) => ipcRenderer.invoke("app:open-path", filePath),

  // WebUI 就绪通知
  onWebUIReady: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("webui:ready", listener);
    return () => ipcRenderer.removeListener("webui:ready", listener);
  },
});
