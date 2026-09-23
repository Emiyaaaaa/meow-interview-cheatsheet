import { app, ipcMain, net, shell, type BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
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
let downloadController: AbortController | null = null;
let downloadTask: Promise<void> | null = null;
let lastState: UpdateState = IDLE_UPDATE_STATE;
let pauseRequested = false;
let resumePath = "";
let resumeUrl = "";

const UPDATE_MANIFEST = "manifest.json";

type DownloadManifest = {
  fileName: string;
  size: number;
  version: string;
};

function updateDir() {
  return join(app.getPath("userData"), "updates");
}

function manifestPath() {
  return join(updateDir(), UPDATE_MANIFEST);
}

async function readManifest(): Promise<DownloadManifest | null> {
  try {
    const data = JSON.parse(
      await readFile(manifestPath(), "utf8"),
    ) as DownloadManifest;
    if (
      !data ||
      typeof data.fileName !== "string" ||
      typeof data.version !== "string"
    ) {
      return null;
    }
    if (!Number.isFinite(data.size) || data.size <= 0) return null;
    return data;
  } catch {
    return null;
  }
}

async function writeManifest(manifest: DownloadManifest) {
  await mkdir(updateDir(), { recursive: true });
  await writeFile(manifestPath(), JSON.stringify(manifest), "utf8");
}

async function readyInstaller(fileName: string, version: string) {
  const manifest = await readManifest();
  if (
    !manifest ||
    manifest.fileName !== fileName ||
    manifest.version !== version
  ) {
    return null;
  }
  const path = join(updateDir(), fileName);
  const size = await fileSize(path);
  if (size !== manifest.size) return null;
  return { path, size };
}

async function pruneUpdateDir(keepFileName: string) {
  let names: string[] = [];
  try {
    names = await readdir(updateDir());
  } catch {
    return;
  }
  await Promise.all(
    names.map(async (name) => {
      if (name === UPDATE_MANIFEST || name === keepFileName) return;
      await unlink(join(updateDir(), name)).catch(() => undefined);
    }),
  );
}

function emitReadyDownload(
  emit: (state: UpdateState) => void,
  path: string,
  size: number,
) {
  downloadedPath = path;
  resumePath = "";
  resumeUrl = "";
  emit({
    percent: 100,
    received: size,
    status: "ready",
    total: size,
  });
}

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

function endWriteStream(file: WriteStream) {
  return new Promise<void>((resolveEnd, rejectEnd) => {
    file.end((error: Error | null | undefined) => {
      if (error) rejectEnd(error);
      else resolveEnd();
    });
  });
}

async function fileSize(path: string) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function downloadToFile(
  url: string,
  dest: string,
  onProgress: (received: number, total: number) => void,
  signal: AbortSignal,
  startAt = 0,
): Promise<"complete" | "paused"> {
  if (signal.aborted)
    return pauseRequested ? "paused" : Promise.reject(new Error("已取消下载"));
  if (startAt > 0 && (await fileSize(dest)) !== startAt) startAt = 0;

  let response: Response;
  try {
    response = await net.fetch(url, {
      headers: startAt > 0 ? { Range: `bytes=${startAt}-` } : undefined,
      signal,
    });
  } catch (error) {
    if (pauseRequested || signal.aborted) return "paused";
    throw error;
  }

  if (response.status === 416 && startAt > 0) {
    await unlink(dest).catch(() => undefined);
    return downloadToFile(url, dest, onProgress, signal, 0);
  }

  const appending = startAt > 0 && response.status === 206;
  if (!response.ok && !appending) {
    throw new Error(`下载失败（HTTP ${response.status}）`);
  }
  if (!response.body) throw new Error("下载失败：空响应");

  const contentLength = Number(response.headers.get("content-length") || 0);
  const rangeTotal = Number(
    (response.headers.get("content-range") || "").match(/\/(\d+)$/)?.[1] || 0,
  );
  const offset = appending ? startAt : 0;
  const total =
    rangeTotal > 0
      ? rangeTotal
      : appending && contentLength > 0
        ? offset + contentLength
        : contentLength > 0
          ? contentLength
          : 0;

  const file = createWriteStream(dest, { flags: appending ? "a" : "w" });
  const reader = response.body.getReader();
  let received = offset;
  let closed = false;

  async function closeFile(keepPartial: boolean) {
    if (closed) return;
    closed = true;
    await reader.cancel().catch(() => undefined);
    if (keepPartial) {
      await endWriteStream(file).catch(() => {
        file.destroy();
      });
      return;
    }
    file.destroy();
    await unlink(dest).catch(() => undefined);
  }

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;
      received += value.byteLength;
      onProgress(received, total);
      if (!file.write(Buffer.from(value))) {
        await new Promise<void>((resolveWrite) => {
          file.once("drain", resolveWrite);
        });
      }
    }
    if (signal.aborted) {
      await closeFile(pauseRequested);
      if (pauseRequested) return "paused";
      throw new Error("已取消下载");
    }
    closed = true;
    await endWriteStream(file);
    return "complete";
  } catch (error) {
    if (pauseRequested || signal.aborted) {
      await closeFile(true);
      return "paused";
    }
    await closeFile(false);
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

  async function emitPaused(dest: string) {
    const received = await fileSize(dest);
    const total = lastState.total;
    const percent =
      total > 0 ? Math.min(100, (received / total) * 100) : lastState.percent;
    emit({
      percent,
      received,
      status: "paused",
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
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;
    const localFileName = UPDATE_PLATFORMS[platform].file(latestVersion);
    const ready = hasUpdate
      ? await readyInstaller(localFileName, latestVersion)
      : null;
    const info: UpdateInfo = {
      alreadyDownloaded: Boolean(ready),
      currentVersion,
      fileName,
      githubUrl,
      hasUpdate,
      latestVersion,
      platform,
      preferredSource: source,
      qiniuUrl: qiniuUpdateUrl(platform, latestVersion, fileName),
    };
    cachedInfo = info;
    if (ready) {
      emitReadyDownload(emit, ready.path, ready.size);
      await pruneUpdateDir(localFileName);
      return info;
    }
    downloadedPath = "";
    emit(IDLE_UPDATE_STATE);
    return info;
  });

  ipcMain.handle("update:start-download", async () => {
    const info = cachedInfo;
    if (!info) throw new Error("请先检查更新");
    if (!info.hasUpdate) throw new Error("当前已是最新版本");

    const localFileName = UPDATE_PLATFORMS[info.platform].file(
      info.latestVersion,
    );
    const existing = await readyInstaller(localFileName, info.latestVersion);
    if (existing) {
      emitReadyDownload(emit, existing.path, existing.size);
      return;
    }

    if (downloadTask) {
      if (downloadController && !pauseRequested) return;
      await downloadTask.catch(() => undefined);
    }

    pauseRequested = false;
    const controller = new AbortController();
    downloadController = controller;

    const destDir = updateDir();
    await mkdir(destDir, { recursive: true });
    const finalPath = join(destDir, localFileName);
    const dest = join(destDir, `${localFileName}.part`);
    downloadedPath = "";

    const preferred =
      info.preferredSource === "github" ? info.githubUrl : info.qiniuUrl;
    const fallback =
      info.preferredSource === "github" ? info.qiniuUrl : info.githubUrl;
    const canResume = Boolean(resumeUrl) && resumePath === dest;
    const primary = canResume ? resumeUrl : preferred;
    const secondary = primary === preferred ? fallback : preferred;

    let lastSent = 0;
    const onProgress = (received: number, total: number) => {
      const now = Date.now();
      if (now - lastSent < 120 && received !== total && received !== 0) {
        return;
      }
      lastSent = now;
      emitProgress(received, total);
    };

    const task = (async () => {
      if (!canResume) await unlink(dest).catch(() => undefined);
      const startAt = canResume ? await fileSize(dest) : 0;
      emitProgress(startAt, canResume ? lastState.total : 0);
      try {
        let result: "complete" | "paused";
        try {
          resumeUrl = primary;
          resumePath = dest;
          result = await downloadToFile(
            primary,
            dest,
            onProgress,
            controller.signal,
            startAt,
          );
        } catch (error) {
          if (controller.signal.aborted || pauseRequested) throw error;
          resumeUrl = secondary;
          emitProgress(0, 0);
          result = await downloadToFile(
            secondary,
            dest,
            onProgress,
            controller.signal,
            0,
          );
        }
        if (result === "paused") {
          await emitPaused(dest);
          return;
        }
        const size = await fileSize(dest);
        if (size <= 0) throw new Error("下载失败：文件为空");
        await unlink(finalPath).catch(() => undefined);
        await rename(dest, finalPath);
        await writeManifest({
          fileName: localFileName,
          size,
          version: info.latestVersion,
        });
        await pruneUpdateDir(localFileName);
        emitReadyDownload(emit, finalPath, size);
      } catch (error) {
        if (pauseRequested || controller.signal.aborted) {
          await emitPaused(dest);
          return;
        }
        resumeUrl = "";
        resumePath = "";
        emit({
          ...IDLE_UPDATE_STATE,
          message: errorMessage(error, "下载失败，请使用下方链接手动下载"),
          status: "error",
        });
        throw error;
      } finally {
        pauseRequested = false;
        if (downloadController === controller) downloadController = null;
      }
    })();

    downloadTask = task;
    try {
      await task;
    } finally {
      if (downloadTask === task) downloadTask = null;
    }
  });

  ipcMain.handle("update:pause-download", async () => {
    if (!downloadController) return;
    pauseRequested = true;
    const pending = downloadTask;
    downloadController.abort();
    await pending?.catch(() => undefined);
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
