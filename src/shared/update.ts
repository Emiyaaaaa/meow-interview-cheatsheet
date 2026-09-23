export const UPDATE_REPO = "Emiyaaaaa/meow-interview-cheatsheet";
export const UPDATE_APP = "meow-interview-cheatsheet";
export const QINIU_CDN = "https://cdn.emiya.com.cn";
export const QINIU_PREFIX = "desktop";
export const GITHUB_RELEASE_API =
  `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;

export type UpdatePlatformId = "mac-arm64" | "mac-x64" | "windows";

export type UpdateDownloadSource = "qiniu" | "github";

export type UpdateInfo = {
  currentVersion: string;
  fileName: string;
  githubUrl: string;
  hasUpdate: boolean;
  latestVersion: string;
  platform: UpdatePlatformId;
  preferredSource: UpdateDownloadSource;
  qiniuUrl: string;
};

export type UpdateStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "ready"
  | "error";

export type UpdateState = {
  message?: string;
  percent: number;
  received: number;
  status: UpdateStatus;
  total: number;
};

export const UPDATE_PLATFORMS: Record<
  UpdatePlatformId,
  {
    file: (version: string) => string;
    id: UpdatePlatformId;
    match: RegExp;
  }
> = {
  "mac-arm64": {
    id: "mac-arm64",
    match: /mac-arm64\.dmg$/i,
    file: (version) => `${UPDATE_APP}-${version}-mac-arm64.dmg`,
  },
  "mac-x64": {
    id: "mac-x64",
    match: /mac-x64\.dmg$/i,
    file: (version) => `${UPDATE_APP}-${version}-mac-x64.dmg`,
  },
  windows: {
    id: "windows",
    match: /win-x64\.exe$/i,
    file: (version) => `${UPDATE_APP}-${version}-win-x64.exe`,
  },
};

export function currentUpdatePlatform(): UpdatePlatformId | null {
  if (process.platform === "win32") return "windows";
  if (process.platform !== "darwin") return null;
  return process.arch === "arm64" ? "mac-arm64" : "mac-x64";
}

export function normalizeUpdateVersion(tag: string) {
  return String(tag || "")
    .trim()
    .replace(/^v/i, "");
}

/** @returns 1 if a > b, -1 if a < b, 0 if equal */
export function compareVersions(a: string, b: string) {
  const left = normalizeUpdateVersion(a)
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const right = normalizeUpdateVersion(b)
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const da = left[i] ?? 0;
    const db = right[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export function qiniuUpdateUrl(
  platform: UpdatePlatformId,
  version: string,
  fileName?: string,
) {
  const file = fileName || UPDATE_PLATFORMS[platform].file(version);
  return `${QINIU_CDN}/${QINIU_PREFIX}/v${version}/${file}`;
}

export function githubUpdateUrl(platform: UpdatePlatformId, version: string) {
  return `https://github.com/${UPDATE_REPO}/releases/latest/download/${UPDATE_PLATFORMS[platform].file(version)}`;
}

export const IDLE_UPDATE_STATE: UpdateState = {
  percent: 0,
  received: 0,
  status: "idle",
  total: 0,
};
