import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import type { MockInterviewOptions } from "../shared/mock-interview";

const WINDOW_SIZE = { width: 720, height: 800, minWidth: 480, minHeight: 560 };

let mockWindow: BrowserWindow | null = null;
let mockOptions: MockInterviewOptions | null = null;
let pendingShow = false;
let onClosed: (() => void) | null = null;

export function setMockInterviewClosedHandler(handler: (() => void) | null) {
  onClosed = handler;
}

export function isMockInterviewOpen() {
  return Boolean(
    mockWindow && !mockWindow.isDestroyed() && mockWindow.isVisible(),
  );
}

export function getMockInterviewOptions() {
  return mockOptions;
}

function getBounds() {
  const cursor = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(cursor).workArea;
  const width = Math.min(WINDOW_SIZE.width, area.width - 48);
  const height = Math.min(WINDOW_SIZE.height, area.height - 48);
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

function loadTarget() {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    url.searchParams.set("mock", "1");
    return { kind: "url" as const, value: url.toString() };
  }
  return {
    kind: "file" as const,
    value: join(__dirname, "../renderer/index.html"),
  };
}

function present(win: BrowserWindow) {
  if (win.isDestroyed()) return;
  win.show();
  win.focus();
}

export function createMockInterviewWindow(
  preloadPath: string,
  iconPath: string,
) {
  if (mockWindow && !mockWindow.isDestroyed()) {
    return mockWindow;
  }

  const bounds = getBounds();
  mockWindow = new BrowserWindow({
    ...bounds,
    minWidth: WINDOW_SIZE.minWidth,
    minHeight: WINDOW_SIZE.minHeight,
    title: "模拟面试",
    backgroundColor: "#f4f4f4",
    icon: iconPath,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  const created = mockWindow;

  const target = loadTarget();
  if (target.kind === "url") {
    void mockWindow.loadURL(target.value);
  } else {
    void mockWindow.loadFile(target.value, { query: { mock: "1" } });
  }

  mockWindow.once("ready-to-show", () => {
    if (!mockWindow || mockWindow.isDestroyed()) return;
    if (pendingShow) {
      pendingShow = false;
      present(mockWindow);
    }
  });

  mockWindow.on("closed", () => {
    if (mockWindow === created) {
      mockWindow = null;
      mockOptions = null;
      pendingShow = false;
      onClosed?.();
    }
  });

  return mockWindow;
}

export function showMockInterviewWindow(
  preloadPath: string,
  iconPath: string,
  options: MockInterviewOptions,
) {
  if (mockWindow && !mockWindow.isDestroyed()) {
    destroyMockInterviewWindow();
  }
  mockOptions = options;
  const win = createMockInterviewWindow(preloadPath, iconPath);
  win.setBounds(getBounds(), false);
  if (win.webContents.isLoading()) {
    pendingShow = true;
    return win;
  }
  present(win);
  return win;
}

export function hideMockInterviewWindow() {
  pendingShow = false;
  if (!mockWindow || mockWindow.isDestroyed()) return;
  mockWindow.close();
}

export function destroyMockInterviewWindow() {
  pendingShow = false;
  mockOptions = null;
  if (!mockWindow || mockWindow.isDestroyed()) {
    mockWindow = null;
    return;
  }
  mockWindow.destroy();
  mockWindow = null;
}
