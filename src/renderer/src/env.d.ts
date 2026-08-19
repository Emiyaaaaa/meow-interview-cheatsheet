/// <reference types="vite/client" />

declare module "*.css";

type MediaPermissionStatus =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown";

type PermissionKind = "microphone" | "screen";

type SystemAudioCaptureMode =
  | "core-audio"
  | "screen-capture"
  | "loopback"
  | "unsupported";

interface SystemAudioCapabilities {
  macOSVersion: string | null;
  mode: SystemAudioCaptureMode;
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
    onSystemAudioData: (listener: (data: ArrayBuffer) => void) => () => void;
    onSystemAudioError: (listener: (message: string) => void) => () => void;
  };
}
