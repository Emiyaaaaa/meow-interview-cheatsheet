import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  session,
  shell,
  systemPreferences,
} from "electron";
import { AudioTee, type AudioChunk } from "audiotee";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { FILES_URL } from "../shared/api";
import type { OverlayInterviewState } from "../shared/overlay";
import type { PermissionKind } from "../shared/permissions";
import {
  getAudioCapturePermissionStatus,
  isAudioCaptureDecided,
} from "./audio-capture-permission";
import {
  configureCaptureExclusion,
  destroyOverlayWindow,
  getLastOverlayState,
  hideOverlayWindow,
  isOverlayVisible,
  setLastOverlayState,
  setOverlayDismissHandler,
  showOverlayWindow,
} from "./overlay";

configureCaptureExclusion(app);

type SystemAudioCaptureMode =
  "core-audio" | "screen-capture" | "loopback" | "unsupported";

const PERMISSION_SETTINGS_URL: Record<PermissionKind, string> = {
  microphone:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  screen:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  "audio-capture":
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture",
};

const AUTH_PROTOCOL = "interview-cheatsheet";

let coreAudioCapture: AudioTee | null = null;
let mainWindow: BrowserWindow | null = null;
const fileUploadAbortControllers = new Map<string, AbortController>();
const abortedFileUploads = new Set<string>();
let pendingAuthUrl: string | null = null;

function isAuthUrl(value: string) {
  return value.startsWith(`${AUTH_PROTOCOL}://`);
}

function findAuthUrl(argv: string[]) {
  return argv.find(isAuthUrl) ?? null;
}

function deliverAuthUrl(url: string) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingAuthUrl = url;
    return;
  }
  pendingAuthUrl = null;
  restoreMainWindow();
  mainWindow.webContents.send("auth:callback", url);
}

function registerAuthProtocol() {
  if (process.defaultApp) {
    const appPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
    if (appPath) {
      app.setAsDefaultProtocolClient(AUTH_PROTOCOL, process.execPath, [
        appPath,
      ]);
      return;
    }
  }
  app.setAsDefaultProtocolClient(AUTH_PROTOCOL);
}

function isAllowedExternalUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === `${AUTH_PROTOCOL}:`) return true;
    if (parsed.protocol === "https:") return true;
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function preloadPath() {
  return join(__dirname, "../preload/index.cjs");
}

function restoreMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setSkipTaskbar(false);
  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setSkipTaskbar(true);
  mainWindow.hide();
}

function abortError() {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function mimeTypeForName(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "doc") return "application/msword";
  if (ext === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (ext === "txt") return "text/plain";
  if (ext === "md") return "text/markdown";
  return "application/octet-stream";
}

function getSystemAudioCapabilities(): {
  macOSVersion: string | null;
  mode: SystemAudioCaptureMode;
} {
  if (process.platform !== "darwin") {
    return { macOSVersion: null, mode: "loopback" };
  }

  const macOSVersion = process.getSystemVersion();
  const [major = 0, minor = 0] = macOSVersion.split(".").map(Number);

  if (major > 14 || (major === 14 && minor >= 2)) {
    return { macOSVersion, mode: "core-audio" };
  }
  if (major >= 13) {
    return { macOSVersion, mode: "screen-capture" };
  }
  return { macOSVersion, mode: "unsupported" };
}

function getAudioteeBinaryPath() {
  return app.isPackaged ? join(process.resourcesPath, "audiotee") : undefined;
}

function createAudioTee() {
  return new AudioTee({
    binaryPath: getAudioteeBinaryPath(),
    chunkDurationMs: 100,
    sampleRate: 16_000,
  });
}

function waitForAudioCaptureDecision(timeoutMs: number, isDone: () => boolean) {
  return new Promise<void>((resolve) => {
    if (isDone()) {
      resolve();
      return;
    }

    const poll = setInterval(() => {
      if (!isDone()) return;
      clearInterval(poll);
      clearTimeout(timer);
      resolve();
    }, 300);
    const timer = setTimeout(() => {
      clearInterval(poll);
      resolve();
    }, timeoutMs);
  });
}

async function requestAudioCapturePermission(): Promise<
  ReturnType<typeof getAudioCapturePermissionStatus>
> {
  const current = getAudioCapturePermissionStatus();
  if (isAudioCaptureDecided(current)) return current;
  if (coreAudioCapture?.isActive()) return "granted";

  const capture = createAudioTee();
  let finished = false;
  const markFinished = () => {
    finished = true;
  };

  capture.once("start", markFinished);
  capture.once("error", markFinished);

  try {
    await capture.start();
    await waitForAudioCaptureDecision(
      120_000,
      () => finished || isAudioCaptureDecided(getAudioCapturePermissionStatus()),
    );
    if (!isAudioCaptureDecided(getAudioCapturePermissionStatus())) {
      await waitForAudioCaptureDecision(2_000, () =>
        isAudioCaptureDecided(getAudioCapturePermissionStatus()),
      );
    }
  } catch {
    // 以 TCC 状态为准，启动失败也走同一套查询。
  } finally {
    capture.removeAllListeners();
    try {
      await capture.stop();
    } catch {
      /* ignore */
    }
  }

  const status = getAudioCapturePermissionStatus();
  if (isAudioCaptureDecided(status)) return status;
  // TCC SPI 不可用时，只能以 Core Audio tap 是否真正启动作为回退。
  if (status === "unknown" && finished) return "granted";
  return status;
}

function configureSystemAudioCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const [screen] = await desktopCapturer.getSources({
          types: ["screen"],
        });

        if (!screen) {
          callback({});
          return;
        }

        callback({ audio: "loopback", video: screen });
      } catch (error) {
        console.error("无法获取系统音频源:", error);
        callback({});
      }
    },
  );
}

function configurePermissionHandlers() {
  ipcMain.handle("system-audio:get-capabilities", () =>
    getSystemAudioCapabilities(),
  );

  ipcMain.handle("permissions:get-status", (_event, kind: PermissionKind) => {
    if (process.platform !== "darwin") return "granted";
    if (kind === "audio-capture") return getAudioCapturePermissionStatus();
    return systemPreferences.getMediaAccessStatus(kind);
  });

  ipcMain.handle(
    "permissions:request",
    async (_event, kind: PermissionKind) => {
      if (process.platform !== "darwin") return "granted";
      if (kind === "audio-capture") {
        return requestAudioCapturePermission();
      }
      // 屏幕录制没有请求 API，只能由实际的采集调用触发系统弹窗。
      if (kind === "microphone") {
        await systemPreferences.askForMediaAccess("microphone");
      }
      return systemPreferences.getMediaAccessStatus(kind);
    },
  );

  ipcMain.handle(
    "permissions:open-settings",
    async (_event, kind: PermissionKind) => {
      if (process.platform !== "darwin") return;
      await shell.openExternal(PERMISSION_SETTINGS_URL[kind]);
    },
  );

  ipcMain.handle("system-audio:start-core-audio", async (event) => {
    if (getSystemAudioCapabilities().mode !== "core-audio") {
      throw new Error("当前系统不支持仅系统录音模式");
    }
    if (coreAudioCapture?.isActive()) return;

    const capture = createAudioTee();
    coreAudioCapture = capture;

    // AudioTee / Core Audio Tap 需要「仅系统音频录制」权限（NSAudioCapture）。
    // 系统音频在主进程采集，PCM 送到渲染进程再走 WebSocket。
    capture.on("data", (chunk: AudioChunk) => {
      if (event.sender.isDestroyed()) return;
      const copy = new Uint8Array(chunk.data.byteLength);
      copy.set(chunk.data);
      event.sender.send("system-audio:data", copy);
    });
    capture.on("error", (error) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("system-audio:error", error.message);
      }
    });

    try {
      await capture.start();
    } catch (error) {
      capture.removeAllListeners();
      coreAudioCapture = null;
      throw error;
    }
  });

  ipcMain.handle("system-audio:stop-core-audio", async () => {
    const capture = coreAudioCapture;
    coreAudioCapture = null;
    if (!capture) return;
    capture.removeAllListeners("data");
    await capture.stop();
    capture.removeAllListeners();
  });

  ipcMain.handle("app:set-window-title", (event, title: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && title.trim()) {
      window.setTitle(title.trim());
    }
  });

  ipcMain.handle("dialog:pick-resume-file", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = window
      ? await dialog.showOpenDialog(window, {
          properties: ["openFile"],
          filters: [
            {
              extensions: ["pdf", "doc", "docx", "txt", "md"],
              name: "简历文件",
            },
          ],
          title: "选择简历文件",
        })
      : await dialog.showOpenDialog({
          properties: ["openFile"],
          filters: [
            {
              extensions: ["pdf", "doc", "docx", "txt", "md"],
              name: "简历文件",
            },
          ],
          title: "选择简历文件",
        });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const data = await readFile(filePath);
    return {
      md5: createHash("md5").update(data).digest("hex"),
      name: basename(filePath),
      path: filePath,
    };
  });

  ipcMain.handle("shell:open-external", async (_event, url: string) => {
    if (!isAllowedExternalUrl(url)) {
      throw new Error("不允许打开该链接");
    }
    await shell.openExternal(url);
  });

  ipcMain.handle(
    "files:upload",
    async (
      _event,
      requestId: string,
      filePath: string,
      accessToken: string,
    ) => {
      const controller = new AbortController();
      fileUploadAbortControllers.set(requestId, controller);

      if (abortedFileUploads.delete(requestId)) {
        fileUploadAbortControllers.delete(requestId);
        throw abortError();
      }

      try {
        const data = await readFile(filePath);
        const name = basename(filePath);
        const copy = new ArrayBuffer(data.byteLength);
        new Uint8Array(copy).set(data);
        const body = new FormData();
        body.append("purpose", "user_data");
        body.append(
          "file",
          new Blob([copy], { type: mimeTypeForName(name) }),
          name,
        );

        const response = await fetch(FILES_URL, {
          method: "POST",
          headers: accessToken
            ? { Authorization: `Bearer ${accessToken}` }
            : undefined,
          body,
          signal: controller.signal,
        });

        return {
          body: await response.text(),
          ok: response.ok,
          status: response.status,
        };
      } catch (error) {
        if (controller.signal.aborted) {
          throw abortError();
        }
        throw error;
      } finally {
        fileUploadAbortControllers.delete(requestId);
        abortedFileUploads.delete(requestId);
      }
    },
  );

  ipcMain.on("files:upload:abort", (_event, requestId: string) => {
    const controller = fileUploadAbortControllers.get(requestId);
    if (controller) {
      controller.abort();
      return;
    }
    abortedFileUploads.add(requestId);
  });
}

function configureOverlayHandlers() {
  ipcMain.handle("overlay:show", () => {
    hideMainWindow();
    try {
      showOverlayWindow(preloadPath());
    } catch (error) {
      restoreMainWindow();
      throw error;
    }
  });

  ipcMain.handle("overlay:hide", () => {
    hideOverlayWindow();
    restoreMainWindow();
  });

  ipcMain.on("overlay:publish-state", (_event, state: OverlayInterviewState) => {
    setLastOverlayState(state);
  });

  ipcMain.handle("overlay:get-state", () => getLastOverlayState());

  ipcMain.handle("overlay:request-stop", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("overlay:stop");
    }
  });

  setOverlayDismissHandler(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("overlay:stop");
    }
  });
}

const UA_APP_NAME = "interview-cheatsheet";

function applyAsciiUserAgent() {
  const version = app.getVersion();
  const next = session.defaultSession
    .getUserAgent()
    .replace(/\s\S+\/[\d.]+(?=\sChrome\/)/, ` ${UA_APP_NAME}/${version}`);
  app.userAgentFallback = next;
  session.defaultSession.setUserAgent(next);
}

function getAppIconPath() {
  return app.isPackaged
    ? join(process.resourcesPath, "icon.png")
    : join(__dirname, "../../assets/icon.png");
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    title: "喵喵面试助手",
    backgroundColor: "#f5f5f5",
    icon: getAppIconPath(),
    webPreferences: {
      preload: preloadPath(),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  mainWindow = window;

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
    destroyOverlayWindow();
  });

  window.webContents.once("did-finish-load", () => {
    if (pendingAuthUrl) {
      deliverAuthUrl(pendingAuthUrl);
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  registerAuthProtocol();
  const launchAuthUrl = findAuthUrl(process.argv);
  if (launchAuthUrl) pendingAuthUrl = launchAuthUrl;

  app.on("second-instance", (_event, argv) => {
    const url = findAuthUrl(argv);
    if (url) deliverAuthUrl(url);
    else restoreMainWindow();
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (isAuthUrl(url)) deliverAuthUrl(url);
  });

  app.whenReady().then(() => {
    applyAsciiUserAgent();
    if (process.platform === "darwin" && !app.isPackaged) {
      app.dock?.setIcon(getAppIconPath());
    }
    configureSystemAudioCapture();
    configurePermissionHandlers();
    configureOverlayHandlers();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        return;
      }
      if (isOverlayVisible()) return;
      restoreMainWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void coreAudioCapture?.stop();
  coreAudioCapture = null;
  destroyOverlayWindow();
});
