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
  };
}
