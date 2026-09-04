import { authHeaders, getSessionToken } from "../../../shared/session";
import { FILES_URL } from "./config";

const FILE_CACHE_KEY = "ark-file-cache";
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 120_000;

export interface UploadedFile {
  id: string;
  status: string;
  url: string;
}

interface FileCacheEntry extends UploadedFile {
  md5: string;
}

interface FileApiErrorBody {
  error?: { message?: string };
  message?: string;
}

interface FileApiObject {
  file_url?: string | { url?: string };
  id?: string;
  status?: string;
  url?: string;
}

export class FileRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FileRequestError";
    this.status = status;
  }
}

export async function uploadResumeFile(
  file: ResumeFileSelection,
  options?: { signal?: AbortSignal },
): Promise<UploadedFile> {
  const cached = getCachedFile(file.md5);
  if (cached) {
    try {
      const latest = toUploadedFile(
        await retrieveFile(cached.id, options?.signal),
        cached,
      );
      setCachedFile(file.md5, latest);
      return latest;
    } catch (error) {
      if (isAbortError(error)) throw error;
      removeCachedFile(file.md5);
    }
  }

  const uploaded = await postFile(file.path, options?.signal);
  setCachedFile(file.md5, uploaded);
  return uploaded;
}

export async function waitForFileReady(
  fileId: string,
  signal?: AbortSignal,
): Promise<UploadedFile> {
  const startedAt = Date.now();

  while (true) {
    const file = toUploadedFile(await retrieveFile(fileId, signal));
    if (file.status === "failed" || file.status === "error") {
      throw new FileRequestError("文件解析失败", 200);
    }
    if (file.status === "active") {
      updateCachedById(file);
      return file;
    }
    if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
      throw new FileRequestError("文件解析超时", 408);
    }
    await sleep(POLL_INTERVAL_MS, signal);
  }
}

async function postFile(filePath: string, signal?: AbortSignal) {
  const requestId = crypto.randomUUID();
  const abort = () => window.desktop.abortResumeUpload(requestId);

  if (signal?.aborted) {
    abort();
    throw new DOMException("Aborted", "AbortError");
  }

  signal?.addEventListener("abort", abort, { once: true });

  try {
    const response = await window.desktop.uploadResumeFile(
      requestId,
      filePath,
      getSessionToken() ?? "",
    );
    if (!response.ok) {
      throw new FileRequestError(
        readErrorMessage(response.body, response.status),
        response.status,
      );
    }
    const uploaded = toUploadedFile(
      parseFileObject(response.body, response.status),
    );
    if (!uploaded.id) {
      throw new FileRequestError("上传成功但未返回文件 ID", 200);
    }
    return uploaded;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export async function deleteResumeFile(fileId: string) {
  const response = await fetch(`${FILES_URL}/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const text = await response.text();
  if (!response.ok && response.status !== 404) {
    throw new FileRequestError(
      readErrorMessage(text, response.status),
      response.status,
    );
  }
  removeCachedById(fileId);
}

async function retrieveFile(fileId: string, signal?: AbortSignal) {
  const response = await fetch(`${FILES_URL}/${encodeURIComponent(fileId)}`, {
    headers: authHeaders(),
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new FileRequestError(
      readErrorMessage(text, response.status),
      response.status,
    );
  }
  return parseFileObject(text, response.status);
}

function parseFileObject(text: string, status: number): FileApiObject {
  try {
    return JSON.parse(text) as FileApiObject;
  } catch {
    throw new FileRequestError("文件服务返回了无法解析的内容", status);
  }
}

function toUploadedFile(
  payload: FileApiObject,
  fallback?: UploadedFile,
): UploadedFile {
  return {
    id: payload.id || fallback?.id || "",
    status: payload.status || fallback?.status || "processing",
    url: readFileUrl(payload) || fallback?.url || "",
  };
}

function readFileUrl(payload: FileApiObject) {
  if (typeof payload.url === "string") return payload.url;
  if (typeof payload.file_url === "string") return payload.file_url;
  if (payload.file_url && typeof payload.file_url === "object") {
    return payload.file_url.url || "";
  }
  return "";
}

function getCachedFile(md5: string): FileCacheEntry | null {
  try {
    const raw = window.localStorage.getItem(FILE_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as Record<string, FileCacheEntry>;
    return cache[md5]?.id ? cache[md5] : null;
  } catch {
    return null;
  }
}

function setCachedFile(md5: string, file: UploadedFile) {
  try {
    const raw = window.localStorage.getItem(FILE_CACHE_KEY);
    const cache = raw
      ? (JSON.parse(raw) as Record<string, FileCacheEntry>)
      : {};
    cache[md5] = { ...file, md5 };
    window.localStorage.setItem(FILE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota / private mode
  }
}

function removeCachedFile(md5: string) {
  try {
    const raw = window.localStorage.getItem(FILE_CACHE_KEY);
    if (!raw) return;
    const cache = JSON.parse(raw) as Record<string, FileCacheEntry>;
    delete cache[md5];
    window.localStorage.setItem(FILE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

function removeCachedById(fileId: string) {
  try {
    const raw = window.localStorage.getItem(FILE_CACHE_KEY);
    if (!raw) return;
    const cache = JSON.parse(raw) as Record<string, FileCacheEntry>;
    for (const [md5, entry] of Object.entries(cache)) {
      if (entry.id === fileId) delete cache[md5];
    }
    window.localStorage.setItem(FILE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

function updateCachedById(file: UploadedFile) {
  try {
    const raw = window.localStorage.getItem(FILE_CACHE_KEY);
    if (!raw) return;
    const cache = JSON.parse(raw) as Record<string, FileCacheEntry>;
    for (const [md5, entry] of Object.entries(cache)) {
      if (entry.id === file.id) {
        cache[md5] = { ...entry, ...file };
      }
    }
    window.localStorage.setItem(FILE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error &&
      (error.name === "AbortError" || /abort/i.test(error.message)))
  );
}

function readErrorMessage(bodyText: string, status: number) {
  try {
    const body = JSON.parse(bodyText) as FileApiErrorBody;
    return body.error?.message || body.message || `file error: ${status}`;
  } catch {
    return `file error: ${bodyText || status}`;
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
