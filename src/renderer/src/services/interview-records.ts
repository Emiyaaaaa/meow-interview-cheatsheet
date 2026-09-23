import {
  formatInterviewRecordFileName,
  INTERVIEW_RECORD_SCHEMA_VERSION,
  type InterviewOverallEvaluation,
  type InterviewRecord,
  type InterviewRecordItem,
  type InterviewRecordMode,
  type InterviewRecordsListResult,
  type InterviewRecordsSetDirResult,
} from "../../../shared/interview-record";

const SAVE_THROTTLE_MS = 800;

export type {
  InterviewOverallEvaluation,
  InterviewRecord,
  InterviewRecordItem,
  InterviewRecordSummary,
} from "../../../shared/interview-record";

export interface ActiveInterviewSession {
  fileName: string;
  id: string;
  interviewDirection: string;
  mode: InterviewRecordMode;
  startedAt: number;
}

export function beginInterviewSession(
  mode: InterviewRecordMode,
  interviewDirection = "",
): ActiveInterviewSession {
  const id = crypto.randomUUID();
  const startedAt = Date.now();
  return {
    id,
    mode,
    interviewDirection: interviewDirection.trim(),
    startedAt,
    fileName: formatInterviewRecordFileName(startedAt, id),
  };
}

export function buildInterviewRecord(options: {
  durationSeconds: number;
  endedAt?: number | null;
  items: InterviewRecordItem[];
  overallEvaluation?: InterviewOverallEvaluation | null;
  session: ActiveInterviewSession;
}): InterviewRecord {
  return {
    schemaVersion: INTERVIEW_RECORD_SCHEMA_VERSION,
    id: options.session.id,
    mode: options.session.mode,
    interviewDirection: options.session.interviewDirection,
    startedAt: options.session.startedAt,
    endedAt: options.endedAt ?? null,
    durationSeconds: Math.max(0, Math.round(options.durationSeconds)),
    items: options.items,
    overallEvaluation: options.overallEvaluation ?? null,
    fileName: options.session.fileName,
  };
}

export async function persistInterviewRecord(
  record: InterviewRecord,
): Promise<{ fileName: string }> {
  return window.desktop.saveInterviewRecord(record);
}

export function createThrottledRecordSaver() {
  let timer: number | null = null;
  let pending: InterviewRecord | null = null;
  let chain: Promise<void> = Promise.resolve();
  let finalized = false;

  function flush() {
    if (!pending || finalized) return;
    const next = pending;
    pending = null;
    chain = chain
      .then(async () => {
        if (finalized) return;
        await persistInterviewRecord(next);
      })
      .catch((error: unknown) => {
        console.error("保存面试记录失败", error);
      });
  }

  return {
    schedule(record: InterviewRecord) {
      if (finalized) return;
      pending = record;
      if (timer != null) return;
      timer = window.setTimeout(() => {
        timer = null;
        flush();
      }, SAVE_THROTTLE_MS);
    },
    async finalize(record: InterviewRecord) {
      if (finalized) return;
      finalized = true;
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
      pending = null;
      await chain.catch(() => undefined);
      try {
        await persistInterviewRecord(record);
      } catch (error) {
        console.error("保存面试记录失败", error);
      }
    },
    reset() {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
      pending = null;
      chain = Promise.resolve();
      finalized = false;
    },
  };
}

export async function fetchInterviewRecordsDir(): Promise<string> {
  return window.desktop.getInterviewRecordsDir();
}

export async function pickInterviewRecordsDir(): Promise<InterviewRecordsSetDirResult | null> {
  return window.desktop.pickInterviewRecordsDir();
}

export async function fetchInterviewRecords(): Promise<InterviewRecordsListResult> {
  return window.desktop.listInterviewRecords();
}

export async function fetchInterviewRecord(
  fileName: string,
): Promise<InterviewRecord | null> {
  return window.desktop.getInterviewRecord(fileName);
}
