import { app, BrowserWindow, dialog } from "electron";
import { randomUUID } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
  constants as fsConstants,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  formatInterviewRecordFileName,
  INTERVIEW_RECORD_SCHEMA_VERSION,
  isInterviewRecordFileName,
  type InterviewOverallEvaluation,
  type InterviewRecord,
  type InterviewRecordItem,
  type InterviewRecordMode,
  type InterviewRecordsConfig,
  type InterviewRecordsListResult,
  type InterviewRecordsSetDirResult,
  type InterviewRecordSummary,
} from "../shared/interview-record";

const CONFIG_FILE_NAME = "interview-records-config.json";

function configPath() {
  return join(app.getPath("userData"), CONFIG_FILE_NAME);
}

function defaultRecordsDir() {
  return join(app.getPath("documents"), "MeowInterview", "InterviewRecords");
}

let ioQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = ioQueue.then(fn, fn);
  ioQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function atomicWriteJson(filePath: string, data: unknown) {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tempPath = join(dir, `.${basename(filePath)}.${randomUUID()}.tmp`);
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  try {
    await writeFile(tempPath, payload, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readConfig(): Promise<InterviewRecordsConfig | null> {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<InterviewRecordsConfig>;
    if (typeof parsed.recordsDir !== "string" || !parsed.recordsDir.trim()) {
      return null;
    }
    return { recordsDir: resolve(parsed.recordsDir.trim()) };
  } catch {
    return null;
  }
}

async function writeConfig(config: InterviewRecordsConfig) {
  await atomicWriteJson(configPath(), config);
}

async function ensureRecordsDirUnlocked(): Promise<string> {
  const existing = await readConfig();
  if (existing) {
    await mkdir(existing.recordsDir, { recursive: true });
    return existing.recordsDir;
  }
  const recordsDir = defaultRecordsDir();
  await mkdir(recordsDir, { recursive: true });
  await writeConfig({ recordsDir });
  return recordsDir;
}

export function ensureRecordsDir(): Promise<string> {
  return enqueue(ensureRecordsDirUnlocked);
}

export async function getRecordsDir(): Promise<string> {
  return ensureRecordsDir();
}

function isRecordMode(value: unknown): value is InterviewRecordMode {
  return value === "assistant" || value === "mock";
}

function parseRecordItem(value: unknown): InterviewRecordItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<InterviewRecordItem>;
  if (typeof item.id !== "string" || typeof item.question !== "string") {
    return null;
  }
  if (typeof item.answer !== "string") return null;
  if (
    item.status !== "loading" &&
    item.status !== "ready" &&
    item.status !== "error"
  ) {
    return null;
  }
  return {
    id: item.id,
    question: item.question,
    answer: item.answer,
    status: item.status,
    error: typeof item.error === "string" ? item.error : undefined,
    evaluation: item.evaluation ?? null,
  };
}

function parseOverallEvaluation(
  value: unknown,
): InterviewOverallEvaluation | null {
  if (value == null) return null;
  if (typeof value !== "object") return null;
  const data = value as Partial<InterviewOverallEvaluation>;
  if (data.status !== "ready" && data.status !== "error") return null;
  const rawScore = Number(data.score);
  const score =
    data.score == null || !Number.isFinite(rawScore)
      ? null
      : Math.min(10, Math.max(1, Math.round(rawScore)));
  return {
    status: data.status,
    score,
    summary: typeof data.summary === "string" ? data.summary : "",
    advice: typeof data.advice === "string" ? data.advice : "",
    error: typeof data.error === "string" ? data.error : undefined,
  };
}

function parseInterviewRecord(
  value: unknown,
  fileName: string,
): InterviewRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<InterviewRecord>;
  if (record.schemaVersion !== INTERVIEW_RECORD_SCHEMA_VERSION) return null;
  if (typeof record.id !== "string" || !record.id) return null;
  if (!isRecordMode(record.mode)) return null;
  if (typeof record.startedAt !== "number" || !Number.isFinite(record.startedAt)) {
    return null;
  }
  if (
    record.endedAt != null &&
    (typeof record.endedAt !== "number" || !Number.isFinite(record.endedAt))
  ) {
    return null;
  }
  if (
    typeof record.durationSeconds !== "number" ||
    !Number.isFinite(record.durationSeconds)
  ) {
    return null;
  }
  if (!Array.isArray(record.items)) return null;
  const items: InterviewRecordItem[] = [];
  for (const entry of record.items) {
    const item = parseRecordItem(entry);
    if (!item) return null;
    items.push(item);
  }
  return {
    schemaVersion: INTERVIEW_RECORD_SCHEMA_VERSION,
    id: record.id,
    mode: record.mode,
    interviewDirection:
      typeof record.interviewDirection === "string"
        ? record.interviewDirection
        : "",
    startedAt: record.startedAt,
    endedAt: record.endedAt ?? null,
    durationSeconds: Math.max(0, Math.round(record.durationSeconds)),
    items,
    overallEvaluation: parseOverallEvaluation(record.overallEvaluation),
    fileName,
  };
}

function toSummary(record: InterviewRecord): InterviewRecordSummary {
  return {
    id: record.id,
    fileName: record.fileName ?? "",
    mode: record.mode,
    interviewDirection: record.interviewDirection,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    durationSeconds: record.durationSeconds,
    itemCount: record.items.length,
  };
}

function safeRecordFilePath(recordsDir: string, fileName: string) {
  if (!isInterviewRecordFileName(fileName)) {
    throw new Error("无效的记录文件名");
  }
  const recordsRoot = resolve(recordsDir);
  const fullPath = resolve(recordsRoot, fileName);
  if (basename(fullPath) !== fileName) {
    throw new Error("无效的记录路径");
  }
  const rel = relative(recordsRoot, fullPath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("无效的记录路径");
  }
  return fullPath;
}

export async function saveInterviewRecord(
  record: InterviewRecord,
): Promise<{ fileName: string }> {
  const recordsDir = await ensureRecordsDir();
  const fileName =
    record.fileName && isInterviewRecordFileName(record.fileName)
      ? record.fileName
      : formatInterviewRecordFileName(record.startedAt, record.id);
  const filePath = safeRecordFilePath(recordsDir, fileName);

  const toWrite: InterviewRecord = {
    schemaVersion: INTERVIEW_RECORD_SCHEMA_VERSION,
    id: record.id,
    mode: record.mode,
    interviewDirection: record.interviewDirection ?? "",
    startedAt: record.startedAt,
    endedAt: record.endedAt ?? null,
    durationSeconds: Math.max(0, Math.round(record.durationSeconds ?? 0)),
    items: Array.isArray(record.items) ? record.items : [],
    overallEvaluation: parseOverallEvaluation(record.overallEvaluation),
  };

  await atomicWriteJson(filePath, toWrite);
  return { fileName };
}

export async function listInterviewRecords(): Promise<InterviewRecordsListResult> {
  const recordsDir = await ensureRecordsDir();
  let entries: string[] = [];
  try {
    entries = await readdir(recordsDir);
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "无法读取面试记录目录",
    );
  }

  const records: InterviewRecordSummary[] = [];
  const corrupted: Array<{ fileName: string; error: string }> = [];

  for (const name of entries) {
    if (!isInterviewRecordFileName(name)) continue;
    try {
      const raw = await readFile(safeRecordFilePath(recordsDir, name), "utf8");
      const parsed = parseInterviewRecord(JSON.parse(raw), name);
      if (!parsed) {
        corrupted.push({ fileName: name, error: "记录格式无效" });
        continue;
      }
      records.push(toSummary(parsed));
    } catch (error) {
      corrupted.push({
        fileName: name,
        error: error instanceof Error ? error.message : "读取失败",
      });
    }
  }

  records.sort((a, b) => b.startedAt - a.startedAt);
  return { recordsDir, records, corrupted };
}

export async function getInterviewRecord(
  fileName: string,
): Promise<InterviewRecord | null> {
  const recordsDir = await ensureRecordsDir();
  const filePath = safeRecordFilePath(recordsDir, fileName);
  try {
    const raw = await readFile(filePath, "utf8");
    return parseInterviewRecord(JSON.parse(raw), fileName);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code === "ENOENT") return null;
    throw error;
  }
}

async function listMigratableFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter(isInterviewRecordFileName);
  } catch {
    return [];
  }
}

export async function pickAndSetRecordsDir(
  browserWindow: BrowserWindow | null,
): Promise<InterviewRecordsSetDirResult | null> {
  const currentDir = await ensureRecordsDir();
  const result = browserWindow
    ? await dialog.showOpenDialog(browserWindow, {
        properties: ["openDirectory", "createDirectory"],
        title: "选择面试记录保存文件夹",
        defaultPath: currentDir,
      })
    : await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
        title: "选择面试记录保存文件夹",
        defaultPath: currentDir,
      });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const nextDir = resolve(result.filePaths[0]);
  if (nextDir === resolve(currentDir)) {
    return { recordsDir: nextDir, migrated: 0 };
  }

  await mkdir(nextDir, { recursive: true });
  const files = await listMigratableFiles(currentDir);
  const copied: string[] = [];

  try {
    for (const name of files) {
      const source = safeRecordFilePath(currentDir, name);
      const target = safeRecordFilePath(nextDir, name);
      try {
        await access(target, fsConstants.F_OK);
        // Target already has a file with the same name — skip overwrite.
        continue;
      } catch {
        // Target missing — proceed to copy.
      }
      await copyFile(source, target);
      // Verify copy is readable JSON before counting as migrated.
      const raw = await readFile(target, "utf8");
      JSON.parse(raw);
      copied.push(name);
    }
  } catch (error) {
    // Best-effort cleanup of partial copies on failure; keep source intact.
    for (const name of copied) {
      try {
        await rm(safeRecordFilePath(nextDir, name), { force: true });
      } catch {
        /* ignore */
      }
    }
    throw new Error(
      error instanceof Error ? error.message : "迁移面试记录失败",
    );
  }

  await writeConfig({ recordsDir: nextDir });

  for (const name of copied) {
    try {
      await rm(safeRecordFilePath(currentDir, name), { force: true });
    } catch {
      /* keep source if delete fails after successful copy+config switch */
    }
  }

  return { recordsDir: nextDir, migrated: copied.length };
}
