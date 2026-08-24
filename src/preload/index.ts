import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  getSystemAudioCapabilities: () =>
    ipcRenderer.invoke("system-audio:get-capabilities"),
  getPermissionStatus: (kind: "microphone" | "screen") =>
    ipcRenderer.invoke("permissions:get-status", kind),
  requestPermission: (kind: "microphone" | "screen") =>
    ipcRenderer.invoke("permissions:request", kind),
  openPermissionSettings: (kind: "microphone" | "screen") =>
    ipcRenderer.invoke("permissions:open-settings", kind),
  startCoreAudioCapture: () =>
    ipcRenderer.invoke("system-audio:start-core-audio"),
  stopCoreAudioCapture: () =>
    ipcRenderer.invoke("system-audio:stop-core-audio"),
  onSystemAudioData: (listener: (data: ArrayBuffer) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: Uint8Array) => {
      listener(Uint8Array.from(data).buffer);
    };
    ipcRenderer.on("system-audio:data", handler);
    return () => ipcRenderer.removeListener("system-audio:data", handler);
  },
  onSystemAudioError: (listener: (message: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => {
      listener(message);
    };
    ipcRenderer.on("system-audio:error", handler);
    return () => ipcRenderer.removeListener("system-audio:error", handler);
  },
  setWindowTitle: (title: string) =>
    ipcRenderer.invoke("app:set-window-title", title),
});
