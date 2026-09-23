import { app, ipcMain, net, shell, type BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  compareVersions,
  currentUpdatePlatform,
  GITHUB_RELEASE_API,
  githubUpdateUrl,
  IDLE_UPDATE_STATE,
  normalizeUpdateVersion,
  qiniuUpdateUrl,
  UPDATE_PLATFORMS,
  type UpdateDownloadSource,
  type UpdateInfo,
  type UpdateState,
} from "../shared/update";

type GitHubReleaseAsset = {
  browser_download_url?: string;
  name?: string;
};

type GitHubRelease = {
  assets?: GitHubReleaseAsset[];
  tag_name?: string;
};

let cachedInfo: UpdateInfo | null = null;
let downloadedPath = "";
let downloadedVersion = "";
let downloadController: AbortController | null = null;
let lastState: UpdateState = IDLE_UPDATE_STATE;

async function detectDownloadSource(): Promise<UpdateDownloadSource> {
  try {
    const res = await net.fetch("https://www.cloudflare.com/cdn-cgi/trace", {
      cache: "no-store",
    });
    if (!res.ok) return "qiniu";
    const loc = (await res.text())
      .match(/^loc=(.*)$/m)?.[1]
      ?.trim()
      .toUpperCase();
    if (loc && loc !== "CN") return "github";
    return "qiniu";
  } catch {
    return "qiniu";
  }
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

async function downloadToFile(
  url: string,
  dest: string,
  onProgress: (received: number, total: number) => void,
  signal: AbortSignal,
) {
  if (signal.aborted) throw new Error("已取消下载");

  const response = await net.fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`下载失败（HTTP ${response.status}）`);
  }
  if (!response.body) {
    throw new Error("下载失败：空响应");
  }

  const total = Number(response.headers.get("content-length") || 0);
  const file = createWriteStream(dest);
  const reader = response.body.getReader();
  let received = 0;

  try {
    while (true) {
      if (signal.aborted) throw new Error("已取消下载");
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      onProgress(received, Number.isFinite(total) && total > 0 ? total : 0);
      if (!file.write(Buffer.from(value))) {
        await new Promise<void>((resolveWrite) => {
          file.once("drain", resolveWrite);
        });
      }
    }
    await new Promise<void>((resolveEnd, rejectEnd) => {
      file.end((error: Error | null | undefined) => {
        if (error) rejectEnd(error);
        else resolveEnd();
      });
    });
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    file.destroy();
    await unlink(dest).catch(() => undefined);
    throw error;
  }
}

function macAppBundlePath() {
  return resolve(app.getPath("exe"), "..", "..", "..");
}

async function installMac(dmgPath: string) {
  const scriptPath = join(tmpdir(), `meow-install-update-${process.pid}.sh`);
  const script = `#!/bin/bash
set -eu
while kill -0 "$MEW_PID" 2>/dev/null; do
  sleep 0.4
done
sleep 0.8
MOUNT="\${TMPDIR:-/tmp}/meow-update-mnt-$$"
mkdir -p "$MOUNT"
cleanup() {
  hdiutil detach "$MOUNT" -force >/dev/null 2>&1 || true
}
trap cleanup EXIT
if ! hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$MEW_DMG" >/dev/null; then
  open "$MEW_DMG"
  exit 1
fi
NEW_APP=$(find "$MOUNT" -maxdepth 1 -name "*.app" -print -quit)
if [ -z "$NEW_APP" ]; then
  open "$MEW_DMG"
  exit 1
fi
rm -rf "$MEW_APP"
ditto "$NEW_APP" "$MEW_APP"
xattr -cr "$MEW_APP" || true
trap - EXIT
cleanup
open "$MEW_APP"
`;
  await writeFile(scriptPath, script, { encoding: "utf8", mode: 0o755 });
  const child = spawn("/bin/bash", [scriptPath], {
    detached: true,
    env: {
      ...process.env,
      MEW_APP: macAppBundlePath(),
      MEW_DMG: dmgPath,
      MEW_PID: String(process.pid),
    },
    stdio: "ignore",
  });
  child.unref();
  app.quit();
}

function installWindows(exePath: string) {
  const child = spawn(exePath, ["--updated", "/S"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  app.quit();
}

export function configureUpdateHandlers(
  getMainWindow: () => BrowserWindow | null,
) {
  function emit(state: UpdateState) {
    lastState = state;
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send("update:state", state);
  }

  function emitProgress(received: number, total: number) {
    const percent = total > 0 ? Math.min(100, (received / total) * 100) : 0;
    emit({
      percent,
      received,
      status: "downloading",
      total,
    });
  }

  ipcMain.handle("update:check", async (): Promise<UpdateInfo> => {
    const platform = currentUpdatePlatform();
    if (!platform) {
      throw new Error("当前系统暂不支持应用内更新");
    }

    emit({ ...IDLE_UPDATE_STATE, status: "checking" });

    const [source, response] = await Promise.all([
      detectDownloadSource(),
      net.fetch(GITHUB_RELEASE_API, {
        headers: { Accept: "application/vnd.github+json" },
      }),
    ]);

    if (!response.ok) {
      emit({
        ...IDLE_UPDATE_STATE,
        message: `无法获取最新版本（HTTP ${response.status}）`,
        status: "error",
      });
      throw new Error(`无法获取最新版本（HTTP ${response.status}）`);
    }

    const data = (await response.json()) as GitHubRelease;
    const latestVersion = normalizeUpdateVersion(data.tag_name || "");
    if (!latestVersion) {
      emit({
        ...IDLE_UPDATE_STATE,
        message: "最新版本信息无效",
        status: "error",
      });
      throw new Error("最新版本信息无效");
    }

    const assets = Array.isArray(data.assets) ? data.assets : [];
    let fileName = "";
    let githubUrl = "";
    for (const asset of assets) {
      const name = String(asset?.name || "");
      if (!UPDATE_PLATFORMS[platform].match.test(name)) continue;
      fileName = name;
      githubUrl = String(asset?.browser_download_url || "");
      break;
    }

    if (!fileName) fileName = UPDATE_PLATFORMS[platform].file(latestVersion);
    if (!githubUrl) githubUrl = githubUpdateUrl(platform, latestVersion);

    const currentVersion = app.getVersion();
    const info: UpdateInfo = {
      currentVersion,
      fileName,
      githubUrl,
      hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
      latestVersion,
      platform,
      preferredSource: source,
      qiniuUrl: qiniuUpdateUrl(platform, latestVersion, fileName),
    };
    cachedInfo = info;
    emit(IDLE_UPDATE_STATE);
    return info;
  });

  ipcMain.handle("update:start-download", async () => {
    const info = cachedInfo;
    if (!info) throw new Error("请先检查更新");
    if (!info.hasUpdate) throw new Error("当前已是最新版本");

    if (
      downloadedPath &&
      downloadedVersion === info.latestVersion &&
      lastState.status === "ready"
    ) {
      emit({
        percent: 100,
        received: lastState.received || lastState.total,
        status: "ready",
        total: lastState.total,
      });
      return;
    }

    if (downloadController) return;

    const controller = new AbortController();
    downloadController = controller;

    const destDir = join(app.getPath("temp"), "meow-interview-cheatsheet-updates");
    await mkdir(destDir, { recursive: true });
    const dest = join(destDir, info.fileName);
    downloadedPath = "";
    downloadedVersion = "";

    const preferred =
      info.preferredSource === "github" ? info.githubUrl : info.qiniuUrl;
    const fallback =
      info.preferredSource === "github" ? info.qiniuUrl : info.githubUrl;

    let lastSent = 0;
    const onProgress = (received: number, total: number) => {
      const now = Date.now();
      if (
        now - lastSent < 120 &&
        received !== total &&
        received !== 0
      ) {
        return;
      }
      lastSent = now;
      emitProgress(received, total);
    };

    emitProgress(0, 0);

    try {
      try {
        await downloadToFile(preferred, dest, onProgress, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) throw error;
        emitProgress(0, 0);
        await downloadToFile(fallback, dest, onProgress, controller.signal);
      }
      downloadedPath = dest;
      downloadedVersion = info.latestVersion;
      emit({
        percent: 100,
        received: lastState.received,
        status: "ready",
        total: lastState.total,
      });
    } catch (error) {
      if (downloadController === controller) downloadController = null;
      if (controller.signal.aborted && lastState.status !== "error") return;
      emit({
        ...IDLE_UPDATE_STATE,
        message: errorMessage(error, "下载失败，请使用下方链接手动下载"),
        status: "error",
      });
      throw error;
    } finally {
      if (downloadController === controller) downloadController = null;
    }
  });

  ipcMain.handle("update:install", async () => {
    if (!downloadedPath) throw new Error("尚未下载完成");
    if (!app.isPackaged) {
      await shell.openPath(downloadedPath);
      return;
    }
    if (process.platform === "darwin") {
      await installMac(downloadedPath);
      return;
    }
    if (process.platform === "win32") {
      installWindows(downloadedPath);
      return;
    }
    await shell.openPath(downloadedPath);
  });
}
