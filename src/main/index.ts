import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
  shell,
  systemPreferences,
} from "electron";
import { AudioTee, type AudioChunk } from "audiotee";
import { join } from "node:path";

type SystemAudioCaptureMode =
  | "core-audio"
  | "screen-capture"
  | "loopback"
  | "unsupported";

type PermissionKind = "microphone" | "screen";

const PERMISSION_SETTINGS_URL: Record<PermissionKind, string> = {
  microphone:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  screen:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
};

let coreAudioCapture: AudioTee | null = null;

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
    return systemPreferences.getMediaAccessStatus(kind);
  });

  ipcMain.handle(
    "permissions:request",
    async (_event, kind: PermissionKind) => {
      if (process.platform !== "darwin") return "granted";
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

    const capture = new AudioTee({
      binaryPath: app.isPackaged
        ? join(process.resourcesPath, "audiotee")
        : undefined,
      chunkDurationMs: 100,
      sampleRate: 16_000,
    });
    coreAudioCapture = capture;

    capture.on("data", (chunk: AudioChunk) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("system-audio:data", chunk.data);
      }
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
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    title: "神奇面试小抄",
    backgroundColor: "#f5f5f5",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  configureSystemAudioCapture();
  configurePermissionHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void coreAudioCapture?.stop();
  coreAudioCapture = null;
});
