import { BrowserWindow, screen, type App } from "electron";
import { join } from "node:path";

const OVERLAY_SIZE = { width: 520, height: 560, minWidth: 360, minHeight: 280 };
const FRONT_REASSERT_LEVEL = 1;
const FRONT_REASSERT_DURATION_MS = 5000;
const FRONT_REASSERT_INTERVAL_MS = 500;

let overlayWindow: BrowserWindow | null = null;
let frontReassertTimer: ReturnType<typeof setInterval> | null = null;
let lastOverlayState: import("../shared/overlay").OverlayInterviewState | null =
  null;
let allowOverlayClose = false;
let pendingOverlayShow = false;
let onOverlayDismiss: (() => void) | null = null;

export function setOverlayDismissHandler(handler: (() => void) | null) {
  onOverlayDismiss = handler;
}

export function configureCaptureExclusion(app: App) {
  if (process.platform === "win32") {
    app.commandLine.appendSwitch("enable-transparent-visuals");
  }

  // ScreenCaptureKitMac 会跳过 setContentProtection 的窗口。
  // 关掉旧采集器，避免绕过 NSWindowSharingNone。
  app.commandLine.appendSwitch("enable-features", "ScreenCaptureKitMac");
  app.commandLine.appendSwitch(
    "disable-features",
    "CalculateNativeWinOcclusion,IOSurfaceCapturer,DesktopCaptureMacV2",
  );
}

export function isOverlayVisible() {
  return Boolean(
    overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible(),
  );
}

export function getLastOverlayState() {
  return lastOverlayState;
}

export function setLastOverlayState(
  state: import("../shared/overlay").OverlayInterviewState,
) {
  lastOverlayState = state;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("overlay:state", state);
  }
}

function applyContentProtection(win: BrowserWindow) {
  if (win.isDestroyed()) return;
  win.setContentProtection(true);
}

function applyOverlayStealth(win: BrowserWindow) {
  if (win.isDestroyed()) return;
  applyContentProtection(win);
  win.setBackgroundColor("#00000000");
  win.setAlwaysOnTop(true, "screen-saver", FRONT_REASSERT_LEVEL);
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  if (process.platform === "darwin") {
    try {
      win.setHiddenInMissionControl(true);
    } catch {
      /* older Electron */
    }
  }
}

function keepOverlayInFront(win: BrowserWindow) {
  if (frontReassertTimer) {
    clearInterval(frontReassertTimer);
    frontReassertTimer = null;
  }
  applyOverlayStealth(win);
  win.moveTop();
  const startedAt = Date.now();
  frontReassertTimer = setInterval(() => {
    if (
      !overlayWindow ||
      overlayWindow.isDestroyed() ||
      Date.now() - startedAt > FRONT_REASSERT_DURATION_MS
    ) {
      if (frontReassertTimer) {
        clearInterval(frontReassertTimer);
        frontReassertTimer = null;
      }
      return;
    }
    applyOverlayStealth(overlayWindow);
    overlayWindow.moveTop();
  }, FRONT_REASSERT_INTERVAL_MS);
}

function getOverlayBounds() {
  const cursor = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(cursor).workArea;
  const width = OVERLAY_SIZE.width;
  const height = Math.min(OVERLAY_SIZE.height, area.height - 48);
  return {
    x: area.x + area.width - width - 24,
    y: area.y + 36,
    width,
    height,
  };
}

function overlayLoadTarget() {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    url.searchParams.set("overlay", "1");
    return { kind: "url" as const, value: url.toString() };
  }
  return {
    kind: "file" as const,
    value: join(__dirname, "../renderer/index.html"),
  };
}

export function createOverlayWindow(preloadPath: string) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  const isWindows = process.platform === "win32";
  const bounds = getOverlayBounds();

  overlayWindow = new BrowserWindow({
    ...bounds,
    minWidth: OVERLAY_SIZE.minWidth,
    minHeight: OVERLAY_SIZE.minHeight,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: !isWindows,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hiddenInMissionControl: true,
    show: false,
    autoHideMenuBar: true,
    roundedCorners: true,
    ...(isWindows ? { thickFrame: false } : {}),
    ...(process.platform === "darwin"
      ? {
          type: "panel" as const,
          vibrancy: "fullscreen-ui" as const,
          visualEffectState: "active" as const,
        }
      : {}),
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  applyOverlayStealth(overlayWindow);

  const target = overlayLoadTarget();
  if (target.kind === "url") {
    void overlayWindow.loadURL(target.value);
  } else {
    void overlayWindow.loadFile(target.value, { query: { overlay: "1" } });
  }

  overlayWindow.once("ready-to-show", () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    applyOverlayStealth(overlayWindow);
    if (pendingOverlayShow) {
      pendingOverlayShow = false;
      presentOverlayWindow(overlayWindow);
    }
  });

  overlayWindow.webContents.on("did-finish-load", () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    applyOverlayStealth(overlayWindow);
    if (lastOverlayState) {
      overlayWindow.webContents.send("overlay:state", lastOverlayState);
    }
  });

  overlayWindow.on("show", () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    applyOverlayStealth(overlayWindow);
  });

  overlayWindow.on("close", (event) => {
    if (allowOverlayClose) return;
    event.preventDefault();
    hideOverlayWindow();
    onOverlayDismiss?.();
  });

  overlayWindow.on("closed", () => {
    overlayWindow = null;
    allowOverlayClose = false;
    if (frontReassertTimer) {
      clearInterval(frontReassertTimer);
      frontReassertTimer = null;
    }
  });

  return overlayWindow;
}

function presentOverlayWindow(win: BrowserWindow) {
  if (win.isDestroyed()) return;
  applyOverlayStealth(win);
  if (process.platform === "darwin" || process.platform === "win32") {
    win.showInactive();
  } else {
    win.show();
  }
  keepOverlayInFront(win);
}

export function showOverlayWindow(preloadPath: string) {
  const win = createOverlayWindow(preloadPath);
  applyOverlayStealth(win);
  win.setBounds(getOverlayBounds(), false);
  if (win.webContents.isLoading()) {
    pendingOverlayShow = true;
    return win;
  }
  presentOverlayWindow(win);
  return win;
}

export function hideOverlayWindow() {
  if (frontReassertTimer) {
    clearInterval(frontReassertTimer);
    frontReassertTimer = null;
  }
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  pendingOverlayShow = false;
  overlayWindow.hide();
}

export function destroyOverlayWindow() {
  if (frontReassertTimer) {
    clearInterval(frontReassertTimer);
    frontReassertTimer = null;
  }
  pendingOverlayShow = false;
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = null;
    return;
  }
  allowOverlayClose = true;
  overlayWindow.destroy();
  overlayWindow = null;
}
