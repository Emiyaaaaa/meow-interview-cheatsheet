import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { chat, isChatAbortError } from "../services/chat";
import { DEFAULT_CHAT_MODEL } from "../services/config";
import { deleteResumeFile } from "../services/files";
import { sendUsageHeartbeat } from "../services/account";
import { SystemAudioTranscription } from "../transcription";
import { useAuth } from "./AuthContext";

export type InterviewQaStatus = "loading" | "ready" | "error";

export interface InterviewQaItem {
  answer: string;
  error?: string;
  id: string;
  question: string;
  status: InterviewQaStatus;
}

interface InterviewContextValue {
  allPermissionsGranted: boolean;
  audioCapabilities: SystemAudioCapabilities;
  capabilitiesLoaded: boolean;
  capturePermission: MediaPermissionStatus;
  captureSource: AudioCaptureSource;
  elapsedSeconds: number;
  finalTranscripts: string[];
  interimTranscript: string;
  isAuthorizing: boolean;
  isLegacyMacCapture: boolean;
  isMac: boolean;
  isMacAudioOnly: boolean;
  isStarted: boolean;
  isStarting: boolean;
  isUnsupported: boolean;
  microphonePermission: MediaPermissionStatus;
  microphonePermissionsGranted: boolean;
  needsMicrophoneSettings: boolean;
  needsSystemSettings: boolean;
  qaItems: InterviewQaItem[];
  systemAudioPermissionsGranted: boolean;
  transcriptionError: string | null;
  authorizeMicrophone: () => Promise<void>;
  authorizeSystemCapture: () => Promise<void>;
  setCaptureSource: (source: AudioCaptureSource) => void;
  startInterview: (options?: {
    interviewDirection?: string;
    resumeFileId?: string;
  }) => Promise<void>;
  startInterviewDebug: (options?: { interviewDirection?: string }) => void;
  stopInterview: () => void;
}

const InterviewContext = createContext<InterviewContextValue | null>(null);

function permissionKindForMode(
  mode: SystemAudioCaptureMode,
): PermissionKind | null {
  if (mode === "core-audio") return "microphone";
  if (mode === "screen-capture") return "screen";
  return null;
}

export function InterviewProvider({ children }: { children: ReactNode }) {
  const isMac = window.desktop.platform === "darwin";
  const { setRemainingSeconds } = useAuth();
  const [captureSource, setCaptureSource] =
    useState<AudioCaptureSource>("system-audio");
  const [capturePermission, setCapturePermission] =
    useState<MediaPermissionStatus>(isMac ? "not-determined" : "granted");
  const [microphonePermission, setMicrophonePermission] =
    useState<MediaPermissionStatus>(isMac ? "not-determined" : "granted");
  const [audioCapabilities, setAudioCapabilities] =
    useState<SystemAudioCapabilities>({
      macOSVersion: null,
      mode: isMac ? "unsupported" : "loopback",
    });
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(!isMac);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [finalTranscripts, setFinalTranscripts] = useState<string[]>([]);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [qaItems, setQaItems] = useState<InterviewQaItem[]>([]);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(
    null,
  );
  const transcriptionRef = useRef<SystemAudioTranscription | null>(null);
  const interviewDirectionRef = useRef("");
  const resumeFileIdRef = useRef("");
  const lastFinalTranscriptRef = useRef("");
  const chatControllersRef = useRef(new Map<string, AbortController>());
  const chatGenerationRef = useRef(0);

  const abortPendingChats = useCallback(() => {
    for (const controller of chatControllersRef.current.values()) {
      controller.abort();
    }
    chatControllersRef.current.clear();
    chatGenerationRef.current += 1;
  }, []);

  const requestAnswer = useCallback((question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;

    const id = crypto.randomUUID();
    const generation = chatGenerationRef.current;
    const controller = new AbortController();
    chatControllersRef.current.set(id, controller);

    setQaItems((current) => [
      ...current,
      {
        id,
        question: trimmed,
        answer: "",
        status: "loading",
      },
    ]);

    const direction = interviewDirectionRef.current;
    const systemPrompt = [
      "你是候选人的面试答题助手。根据面试官的问题给出可直接口述的回答，重点清晰、简洁专业，不要复述问题。",
      direction ? `面试方向：${direction}。` : "",
    ]
      .filter(Boolean)
      .join("");

    void chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: trimmed },
      ],
      {
        model: DEFAULT_CHAT_MODEL,
        signal: controller.signal,
        onDelta: (answer) => {
          if (chatGenerationRef.current !== generation) return;
          setQaItems((current) =>
            current.map((item) =>
              item.id === id ? { ...item, answer } : item,
            ),
          );
        },
      },
    )
      .then(({ content }) => {
        if (chatGenerationRef.current !== generation) return;
        setQaItems((current) =>
          current.map((item) =>
            item.id === id
              ? { ...item, answer: content, status: "ready" }
              : item,
          ),
        );
      })
      .catch((error: unknown) => {
        if (
          chatGenerationRef.current !== generation ||
          isChatAbortError(error)
        ) {
          return;
        }
        const message = error instanceof Error ? error.message : "获取回答失败";
        setQaItems((current) =>
          current.map((item) =>
            item.id === id
              ? { ...item, status: "error", error: message }
              : item,
          ),
        );
      })
      .finally(() => {
        chatControllersRef.current.delete(id);
      });
  }, []);

  useEffect(() => {
    const transcription = new SystemAudioTranscription({
      onError: (message) => {
        setTranscriptionError(message);
        setIsStarting(false);
      },
      onResult: (text, isFinal) => {
        console.log("[transcription]", isFinal ? "final" : "interim", text);
        if (!isFinal) {
          setInterimTranscript(text);
          return;
        }

        if (lastFinalTranscriptRef.current !== text) {
          lastFinalTranscriptRef.current = text;
          setFinalTranscripts((current) => [...current, text]);
          requestAnswer(text);
        }
        setInterimTranscript("");
      },
    });
    transcriptionRef.current = transcription;

    return () => {
      transcription.stop();
      transcriptionRef.current = null;
      abortPendingChats();
    };
  }, [abortPendingChats, requestAnswer]);

  useEffect(() => {
    if (!isStarted) return;
    const timer = window.setInterval(
      () => setElapsedSeconds((seconds) => seconds + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [isStarted]);

  useEffect(() => {
    let active = true;
    void window.desktop
      .getSystemAudioCapabilities()
      .then(async (capabilities) => {
        if (!active) return;
        setAudioCapabilities(capabilities);
        setCapabilitiesLoaded(true);

        const kind = permissionKindForMode(capabilities.mode);
        if (kind) {
          const status = await window.desktop.getPermissionStatus(kind);
          if (active) setCapturePermission(status);
        } else if (capabilities.mode === "loopback") {
          setCapturePermission("granted");
        } else {
          setCapturePermission("restricted");
        }

        if (isMac) {
          const micStatus =
            await window.desktop.getPermissionStatus("microphone");
          if (active) setMicrophonePermission(micStatus);
        }
      });
    return () => {
      active = false;
    };
  }, [isMac]);

  useEffect(() => {
    const kind = permissionKindForMode(audioCapabilities.mode);
    if (!kind) return;

    const refresh = () => {
      void window.desktop.getPermissionStatus(kind).then(setCapturePermission);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [audioCapabilities.mode]);

  useEffect(() => {
    if (captureSource !== "microphone" || !isMac) return;

    const refresh = () => {
      void window.desktop
        .getPermissionStatus("microphone")
        .then(setMicrophonePermission);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [captureSource, isMac]);

  const refreshCapturePermission = useCallback(async (kind: PermissionKind) => {
    const status = await window.desktop.getPermissionStatus(kind);
    setCapturePermission(status);
    return status;
  }, []);

  const refreshMicrophonePermission = useCallback(async () => {
    const status = await window.desktop.getPermissionStatus("microphone");
    setMicrophonePermission(status);
    return status;
  }, []);

  const authorizeSystemCapture = useCallback(async () => {
    const kind = permissionKindForMode(audioCapabilities.mode);
    if (!isMac || !kind || isAuthorizing) return;

    setIsAuthorizing(true);
    setTranscriptionError(null);
    try {
      const current = await refreshCapturePermission(kind);
      if (current === "granted") {
        return;
      }

      // 系统只会在「尚未询问」时弹窗，被拒绝后必须去系统设置里手动开启。
      if (current !== "not-determined") {
        await window.desktop.openPermissionSettings(kind);
        return;
      }

      if (kind === "microphone") {
        setCapturePermission(await window.desktop.requestPermission(kind));
        return;
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true,
      });
      for (const track of stream.getTracks()) track.stop();
      if ((await refreshCapturePermission(kind)) !== "granted") {
        await window.desktop.openPermissionSettings(kind);
      }
    } catch (error) {
      await refreshCapturePermission(kind);
      setTranscriptionError(
        error instanceof Error ? error.message : "系统录制权限授权失败",
      );
    } finally {
      setIsAuthorizing(false);
    }
  }, [audioCapabilities.mode, isAuthorizing, isMac, refreshCapturePermission]);

  const authorizeMicrophone = useCallback(async () => {
    if (!isMac || isAuthorizing) return;

    setIsAuthorizing(true);
    setTranscriptionError(null);
    try {
      const current = await refreshMicrophonePermission();
      if (current === "granted") {
        return;
      }

      if (current !== "not-determined") {
        await window.desktop.openPermissionSettings("microphone");
        return;
      }

      setMicrophonePermission(
        await window.desktop.requestPermission("microphone"),
      );
    } catch (error) {
      await refreshMicrophonePermission();
      setTranscriptionError(
        error instanceof Error ? error.message : "麦克风权限授权失败",
      );
    } finally {
      setIsAuthorizing(false);
    }
  }, [isAuthorizing, isMac, refreshMicrophonePermission]);

  const resetInterviewSession = useCallback(
    (options?: { interviewDirection?: string; resumeFileId?: string }) => {
      setTranscriptionError(null);
      abortPendingChats();
      interviewDirectionRef.current = options?.interviewDirection?.trim() ?? "";
      resumeFileIdRef.current = options?.resumeFileId?.trim() ?? "";
      lastFinalTranscriptRef.current = "";
      setFinalTranscripts([]);
      setQaItems([]);
      setInterimTranscript("");
      setElapsedSeconds(0);
    },
    [abortPendingChats],
  );

  const startInterview = useCallback(
    async (options?: {
      interviewDirection?: string;
      resumeFileId?: string;
    }) => {
      const transcription = transcriptionRef.current;
      if (!transcription || isStarting || isStarted) return;

      setIsStarting(true);
      resetInterviewSession(options);
      try {
        await transcription.start(audioCapabilities.mode, captureSource, {
          interviewDirection: options?.interviewDirection,
        });
        setIsStarted(true);
        try {
          await window.desktop.showOverlay();
        } catch (error) {
          console.error("无法打开面试悬浮窗", error);
        }
      } catch (error) {
        resumeFileIdRef.current = "";
        transcription.stop();
        setTranscriptionError(
          error instanceof Error
            ? error.message
            : captureSource === "microphone"
              ? "无法开始麦克风转写"
              : "无法开始系统音频转写",
        );
      } finally {
        setIsStarting(false);
      }
    },
    [
      audioCapabilities.mode,
      captureSource,
      isStarted,
      isStarting,
      resetInterviewSession,
    ],
  );

  const startInterviewDebug = useCallback(
    (options?: { interviewDirection?: string }) => {
      if (isStarted || isStarting) return;
      resetInterviewSession(options);
      setIsStarted(true);
      void window.desktop.showOverlay().catch((error: unknown) => {
        console.error("无法打开面试悬浮窗", error);
      });
    },
    [isStarted, isStarting, resetInterviewSession],
  );

  const stopInterview = useCallback(() => {
    transcriptionRef.current?.stop();
    setIsStarted(false);
    setInterimTranscript("");
    void window.desktop.hideOverlay().catch((error: unknown) => {
      console.error("无法关闭面试悬浮窗", error);
    });
    const fileId = resumeFileIdRef.current;
    resumeFileIdRef.current = "";
    if (!fileId) return;
    void deleteResumeFile(fileId).catch((error: unknown) => {
      console.error("删除简历文件失败", error);
    });
  }, []);

  useEffect(() => {
    if (!isStarted) return;

    let lastAt = Date.now();
    let stoppingForQuota = false;

    async function flush() {
      const now = Date.now();
      const seconds = Math.round((now - lastAt) / 1000);
      lastAt = now;
      if (seconds < 1) return;
      try {
        const result = await sendUsageHeartbeat(Math.min(seconds, 90));
        setRemainingSeconds(result.remaining_seconds);
        if (result.remaining_seconds <= 0 && !stoppingForQuota) {
          stoppingForQuota = true;
          setTranscriptionError("面试时长已用完，请充值后继续");
          stopInterview();
        }
      } catch (error) {
        console.error("同步面试时长失败", error);
      }
    }

    const timer = window.setInterval(() => {
      void flush();
    }, 30_000);

    return () => {
      window.clearInterval(timer);
      void flush();
    };
  }, [isStarted, setRemainingSeconds, stopInterview]);

  useEffect(() => {
    return window.desktop.onOverlayStop(() => {
      stopInterview();
    });
  }, [stopInterview]);

  useEffect(() => {
    if (!isStarted) return;
    window.desktop.publishOverlayState({
      elapsedSeconds,
      interimTranscript,
      qaItems,
      transcriptionError,
    });
  }, [
    elapsedSeconds,
    interimTranscript,
    isStarted,
    qaItems,
    transcriptionError,
  ]);

  const systemAudioPermissionsGranted =
    audioCapabilities.mode !== "unsupported" &&
    (audioCapabilities.mode === "loopback" || capturePermission === "granted");

  const microphonePermissionsGranted =
    !isMac || microphonePermission === "granted";

  const allPermissionsGranted =
    capabilitiesLoaded &&
    (captureSource === "microphone"
      ? microphonePermissionsGranted
      : systemAudioPermissionsGranted);

  const value = useMemo<InterviewContextValue>(
    () => ({
      allPermissionsGranted,
      audioCapabilities,
      capabilitiesLoaded,
      capturePermission,
      captureSource,
      elapsedSeconds,
      finalTranscripts,
      interimTranscript,
      isAuthorizing,
      isLegacyMacCapture: audioCapabilities.mode === "screen-capture",
      isMac,
      isMacAudioOnly: audioCapabilities.mode === "core-audio",
      isStarted,
      isStarting,
      isUnsupported: audioCapabilities.mode === "unsupported",
      microphonePermission,
      microphonePermissionsGranted,
      needsMicrophoneSettings:
        microphonePermission === "denied" ||
        microphonePermission === "restricted",
      needsSystemSettings:
        capturePermission === "denied" || capturePermission === "restricted",
      qaItems,
      systemAudioPermissionsGranted,
      transcriptionError,
      authorizeMicrophone,
      authorizeSystemCapture,
      setCaptureSource,
      startInterview,
      startInterviewDebug,
      stopInterview,
    }),
    [
      allPermissionsGranted,
      audioCapabilities,
      authorizeMicrophone,
      authorizeSystemCapture,
      capabilitiesLoaded,
      capturePermission,
      captureSource,
      elapsedSeconds,
      finalTranscripts,
      interimTranscript,
      isAuthorizing,
      isMac,
      isStarted,
      isStarting,
      microphonePermission,
      microphonePermissionsGranted,
      qaItems,
      startInterview,
      startInterviewDebug,
      stopInterview,
      systemAudioPermissionsGranted,
      transcriptionError,
    ],
  );

  return (
    <InterviewContext.Provider value={value}>
      {children}
    </InterviewContext.Provider>
  );
}

// Context consumers live next to the provider by design.
// eslint-disable-next-line react-refresh/only-export-components
export function useInterview() {
  const context = useContext(InterviewContext);
  if (!context) {
    throw new Error("useInterview must be used within InterviewProvider");
  }
  return context;
}
