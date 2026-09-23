/// <reference types="vite/client" />

declare module "*.css";

type MediaPermissionStatus =
  "not-determined" | "granted" | "denied" | "restricted" | "unknown";

type PermissionKind = "microphone" | "screen" | "audio-capture";

type AudioCaptureSource = "system-audio" | "microphone";

type SystemAudioCaptureMode =
  "core-audio" | "screen-capture" | "loopback" | "unsupported";

interface SystemAudioCapabilities {
  macOSVersion: string | null;
  mode: SystemAudioCaptureMode;
}

interface ResumeFileSelection {
  md5: string;
  name: string;
  path: string;
}

interface OverlayQaItem {
  answer: string;
  error?: string;
  id: string;
  question: string;
  status: "loading" | "ready" | "error";
}

interface OverlayInterviewState {
  elapsedSeconds: number;
  interimTranscript: string;
  qaItems: OverlayQaItem[];
  transcriptionError: string | null;
}

interface MockInterviewOptions {
  interviewDirection?: string;
  resumeFileId?: string;
}

interface InterviewRecordEvaluation {
  advice: string;
  error?: string;
  improvements: string | null;
  score: number | null;
  status: "loading" | "ready" | "error";
}

interface InterviewOverallEvaluation {
  advice: string;
  error?: string;
  score: number | null;
  status: "ready" | "error";
  summary: string;
}

interface InterviewRecordItem {
  answer: string;
  error?: string;
  evaluation?: InterviewRecordEvaluation | null;
  id: string;
  question: string;
  status: "loading" | "ready" | "error";
}

interface InterviewRecord {
  durationSeconds: number;
  endedAt: number | null;
  fileName?: string;
  id: string;
  interviewDirection: string;
  items: InterviewRecordItem[];
  mode: "assistant" | "mock";
  overallEvaluation?: InterviewOverallEvaluation | null;
  schemaVersion: 1;
  startedAt: number;
}

interface InterviewRecordSummary {
  durationSeconds: number;
  endedAt: number | null;
  fileName: string;
  id: string;
  interviewDirection: string;
  itemCount: number;
  mode: "assistant" | "mock";
  startedAt: number;
}

interface InterviewRecordsListResult {
  corrupted: Array<{ fileName: string; error: string }>;
  records: InterviewRecordSummary[];
  recordsDir: string;
}

interface InterviewRecordsSetDirResult {
  migrated: number;
  recordsDir: string;
}

interface UpdateInfo {
  alreadyDownloaded: boolean;
  currentVersion: string;
  fileName: string;
  githubUrl: string;
  hasUpdate: boolean;
  latestVersion: string;
  platform: "mac-arm64" | "mac-x64" | "windows";
  preferredSource: "qiniu" | "github";
  qiniuUrl: string;
}

interface UpdateState {
  message?: string;
  percent: number;
  received: number;
  status: "idle" | "checking" | "downloading" | "paused" | "ready" | "error";
  total: number;
}

interface Window {
  desktop: {
    platform: string;
    getSystemAudioCapabilities: () => Promise<SystemAudioCapabilities>;
    getPermissionStatus: (
      kind: PermissionKind,
    ) => Promise<MediaPermissionStatus>;
    requestPermission: (kind: PermissionKind) => Promise<MediaPermissionStatus>;
    openPermissionSettings: (kind: PermissionKind) => Promise<void>;
    startCoreAudioCapture: () => Promise<void>;
    stopCoreAudioCapture: () => Promise<void>;
    onSystemAudioData: (listener: (data: Uint8Array) => void) => () => void;
    onSystemAudioError: (listener: (message: string) => void) => () => void;
    setWindowTitle: (title: string) => Promise<void>;
    pickResumeFile: () => Promise<ResumeFileSelection | null>;
    uploadResumeFile: (
      requestId: string,
      filePath: string,
      accessToken: string,
    ) => Promise<{ body: string; ok: boolean; status: number }>;
    openExternal: (url: string) => Promise<void>;
    onAuthCallback: (listener: (url: string) => void) => () => void;
    abortResumeUpload: (requestId: string) => void;
    showOverlay: () => Promise<void>;
    hideOverlay: () => Promise<void>;
    publishOverlayState: (state: OverlayInterviewState) => void;
    getOverlayState: () => Promise<OverlayInterviewState | null>;
    requestStopInterview: () => Promise<void>;
    onOverlayState: (
      listener: (state: OverlayInterviewState) => void,
    ) => () => void;
    onOverlayStop: (listener: () => void) => () => void;
    showMockInterview: (options?: MockInterviewOptions) => Promise<void>;
    hideMockInterview: () => Promise<void>;
    isMockInterviewOpen: () => Promise<boolean>;
    getMockInterviewOptions: () => Promise<MockInterviewOptions | null>;
    publishMockRemaining: (seconds: number) => void;
    onMockInterviewVisibility: (
      listener: (open: boolean) => void,
    ) => () => void;
    onMockInterviewRemaining: (
      listener: (seconds: number) => void,
    ) => () => void;
    getInterviewRecordsDir: () => Promise<string>;
    pickInterviewRecordsDir: () => Promise<InterviewRecordsSetDirResult | null>;
    saveInterviewRecord: (
      record: InterviewRecord,
    ) => Promise<{ fileName: string }>;
    listInterviewRecords: () => Promise<InterviewRecordsListResult>;
    getInterviewRecord: (fileName: string) => Promise<InterviewRecord | null>;
    checkForUpdates: () => Promise<UpdateInfo>;
    startUpdateDownload: () => Promise<void>;
    pauseUpdateDownload: () => Promise<void>;
    installUpdate: () => Promise<void>;
    onUpdateState: (listener: (state: UpdateState) => void) => () => void;
  };
}
