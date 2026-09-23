export const INTERVIEW_RECORD_SCHEMA_VERSION = 1 as const;

export const INTERVIEW_RECORD_FILE_PREFIX = "interview-";
export const INTERVIEW_RECORD_FILE_SUFFIX = ".json";

export type InterviewRecordMode = "assistant" | "mock";

export type InterviewRecordItemStatus = "loading" | "ready" | "error";

export interface InterviewRecordEvaluation {
  advice: string;
  error?: string;
  improvements: string | null;
  score: number | null;
  status: InterviewRecordItemStatus;
}

/** Whole-interview review. Omitted or null on records saved before this field existed. */
export interface InterviewOverallEvaluation {
  advice: string;
  error?: string;
  score: number | null;
  status: Exclude<InterviewRecordItemStatus, "loading">;
  summary: string;
}

export interface InterviewRecordItem {
  answer: string;
  error?: string;
  evaluation?: InterviewRecordEvaluation | null;
  id: string;
  question: string;
  status: InterviewRecordItemStatus;
}

export interface InterviewRecord {
  durationSeconds: number;
  endedAt: number | null;
  id: string;
  interviewDirection: string;
  items: InterviewRecordItem[];
  mode: InterviewRecordMode;
  /** Null while the interview is still in progress, or on older records. */
  overallEvaluation?: InterviewOverallEvaluation | null;
  schemaVersion: typeof INTERVIEW_RECORD_SCHEMA_VERSION;
  startedAt: number;
  /** Absolute path basename; set by main process when reading from disk. */
  fileName?: string;
}

export interface InterviewRecordSummary {
  durationSeconds: number;
  endedAt: number | null;
  fileName: string;
  id: string;
  interviewDirection: string;
  itemCount: number;
  mode: InterviewRecordMode;
  startedAt: number;
}

export interface InterviewRecordsConfig {
  recordsDir: string;
}

export interface InterviewRecordsListResult {
  corrupted: Array<{ fileName: string; error: string }>;
  records: InterviewRecordSummary[];
  recordsDir: string;
}

export interface InterviewRecordsSetDirResult {
  migrated: number;
  recordsDir: string;
}

export function isInterviewRecordFileName(name: string): boolean {
  return (
    name.startsWith(INTERVIEW_RECORD_FILE_PREFIX) &&
    name.endsWith(INTERVIEW_RECORD_FILE_SUFFIX) &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("..")
  );
}

export function formatInterviewRecordFileName(
  startedAt: number,
  id: string,
): string {
  const stamp = new Date(startedAt)
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
  const shortId = id.replace(/-/g, "").slice(0, 8);
  return `${INTERVIEW_RECORD_FILE_PREFIX}${stamp}-${shortId}${INTERVIEW_RECORD_FILE_SUFFIX}`;
}
