import { contextBridge, ipcRenderer } from "electron";
import type {
  InterviewRecord,
  InterviewRecordsListResult,
  InterviewRecordsSetDirResult,
} from "../shared/interview-record";
import type { MockInterviewOptions } from "../shared/mock-interview";
import type { OverlayInterviewState } from "../shared/overlay";
import type { PermissionKind } from "../shared/permissions";
import type { UpdateInfo, UpdateState } from "../shared/update";

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  getSystemAudioCapabilities: () =>
    ipcRenderer.invoke("system-audio:get-capabilities"),
  getPermissionStatus: (kind: PermissionKind) =>
    ipcRenderer.invoke("permissions:get-status", kind),
  requestPermission: (kind: PermissionKind) =>
    ipcRenderer.invoke("permissions:request", kind),
  openPermissionSettings: (kind: PermissionKind) =>
    ipcRenderer.invoke("permissions:open-settings", kind),
  startCoreAudioCapture: () =>
    ipcRenderer.invoke("system-audio:start-core-audio"),
  stopCoreAudioCapture: () =>
    ipcRenderer.invoke("system-audio:stop-core-audio"),
  onSystemAudioData: (listener: (data: Uint8Array) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: Uint8Array) => {
      listener(data);
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
  pickResumeFile: () => ipcRenderer.invoke("dialog:pick-resume-file"),
  uploadResumeFile: (
    requestId: string,
    filePath: string,
    accessToken: string,
  ) => ipcRenderer.invoke("files:upload", requestId, filePath, accessToken),
  abortResumeUpload: (requestId: string) => {
    ipcRenderer.send("files:upload:abort", requestId);
  },
  showOverlay: () => ipcRenderer.invoke("overlay:show"),
  hideOverlay: () => ipcRenderer.invoke("overlay:hide"),
  publishOverlayState: (state: OverlayInterviewState) => {
    ipcRenderer.send("overlay:publish-state", state);
  },
  getOverlayState: () => ipcRenderer.invoke("overlay:get-state"),
  requestStopInterview: () => ipcRenderer.invoke("overlay:request-stop"),
  onOverlayState: (listener: (state: OverlayInterviewState) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: OverlayInterviewState,
    ) => {
      listener(state);
    };
    ipcRenderer.on("overlay:state", handler);
    return () => ipcRenderer.removeListener("overlay:state", handler);
  },
  onOverlayStop: (listener: () => void) => {
    const handler = () => {
      listener();
    };
    ipcRenderer.on("overlay:stop", handler);
    return () => ipcRenderer.removeListener("overlay:stop", handler);
  },
  showMockInterview: (options?: MockInterviewOptions) =>
    ipcRenderer.invoke("mock:show", options ?? {}),
  hideMockInterview: () => ipcRenderer.invoke("mock:hide"),
  isMockInterviewOpen: () => ipcRenderer.invoke("mock:is-open"),
  getMockInterviewOptions: () => ipcRenderer.invoke("mock:get-options"),
  publishMockRemaining: (seconds: number) => {
    ipcRenderer.send("mock:remaining", seconds);
  },
  onMockInterviewVisibility: (listener: (open: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, open: boolean) => {
      listener(open);
    };
    ipcRenderer.on("mock:visibility", handler);
    return () => ipcRenderer.removeListener("mock:visibility", handler);
  },
  onMockInterviewRemaining: (listener: (seconds: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, seconds: number) => {
      listener(seconds);
    };
    ipcRenderer.on("mock:remaining", handler);
    return () => ipcRenderer.removeListener("mock:remaining", handler);
  },
  getInterviewRecordsDir: () =>
    ipcRenderer.invoke("interview-records:get-dir"),
  pickInterviewRecordsDir: () =>
    ipcRenderer.invoke("interview-records:pick-dir") as Promise<
      InterviewRecordsSetDirResult | null
    >,
  saveInterviewRecord: (record: InterviewRecord) =>
    ipcRenderer.invoke("interview-records:save", record) as Promise<{
      fileName: string;
    }>,
  listInterviewRecords: () =>
    ipcRenderer.invoke(
      "interview-records:list",
    ) as Promise<InterviewRecordsListResult>,
  getInterviewRecord: (fileName: string) =>
    ipcRenderer.invoke("interview-records:get", fileName) as Promise<
      InterviewRecord | null
    >,
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
  onAuthCallback: (listener: (url: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string) => {
      listener(url);
    };
    ipcRenderer.on("auth:callback", handler);
    return () => ipcRenderer.removeListener("auth:callback", handler);
  },
  checkForUpdates: () => ipcRenderer.invoke("update:check") as Promise<UpdateInfo>,
  startUpdateDownload: () => ipcRenderer.invoke("update:start-download"),
  pauseUpdateDownload: () => ipcRenderer.invoke("update:pause-download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateState: (listener: (state: UpdateState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => {
      listener(state);
    };
    ipcRenderer.on("update:state", handler);
    return () => ipcRenderer.removeListener("update:state", handler);
  },
});
