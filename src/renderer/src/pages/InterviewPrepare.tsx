import { useEffect, useRef, useState } from "react";
import { Button, Card, Description, Radio, RadioGroup } from "@heroui/react";
import {
  Check,
  Clock3,
  Mic,
  MonitorUp,
  Play,
  ShieldCheck,
  Volume2,
  X,
} from "lucide-react";
import { TranscriptPanel } from "../TranscriptPanel";
import { SystemAudioTranscription } from "../transcription";

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function InterviewPreparePage() {
  const isMac = window.desktop.platform === "darwin";
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
  const [isRunning, setIsRunning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [finalTranscripts, setFinalTranscripts] = useState<string[]>([]);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [transcriptionError, setTranscriptionError] = useState<string | null>(
    null,
  );
  const transcriptionRef = useRef<SystemAudioTranscription | null>(null);

  useEffect(() => {
    const transcription = new SystemAudioTranscription({
      onError: (message) => {
        setTranscriptionError(message);
        setIsRunning(false);
        setIsStarting(false);
      },
      onResult: (text, isFinal) => {
        if (isFinal) {
          setFinalTranscripts((current) =>
            current.at(-1) === text ? current : [...current, text],
          );
          setInterimTranscript("");
        } else {
          setInterimTranscript(text);
        }
      },
    });
    transcriptionRef.current = transcription;

    return () => {
      transcription.stop();
      transcriptionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(
      () => setElapsedSeconds((seconds) => seconds + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [isRunning]);

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

    const refresh = () => void refreshCapturePermission(kind);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [audioCapabilities.mode]);

  useEffect(() => {
    if (captureSource !== "microphone" || !isMac) return;

    const refresh = () => void refreshMicrophonePermission();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [captureSource, isMac]);

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

  const isMacAudioOnly = audioCapabilities.mode === "core-audio";
  const isLegacyMacCapture = audioCapabilities.mode === "screen-capture";
  const isUnsupported = audioCapabilities.mode === "unsupported";
  const needsSystemSettings =
    capturePermission === "denied" || capturePermission === "restricted";
  const needsMicrophoneSettings =
    microphonePermission === "denied" || microphonePermission === "restricted";

  function permissionKindForMode(
    mode: SystemAudioCaptureMode,
  ): PermissionKind | null {
    if (mode === "core-audio") return "microphone";
    if (mode === "screen-capture") return "screen";
    return null;
  }

  async function refreshCapturePermission(kind: PermissionKind) {
    const status = await window.desktop.getPermissionStatus(kind);
    setCapturePermission(status);
    return status;
  }

  async function refreshMicrophonePermission() {
    const status = await window.desktop.getPermissionStatus("microphone");
    setMicrophonePermission(status);
    return status;
  }

  async function authorizeSystemCapture() {
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
  }

  async function authorizeMicrophone() {
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
  }

  async function handleToggleRunning() {
    const transcription = transcriptionRef.current;
    if (!transcription || isStarting) return;

    if (isRunning) {
      transcription.stop();
      setIsRunning(false);
      setInterimTranscript("");
      return;
    }

    setIsStarting(true);
    setTranscriptionError(null);
    try {
      await transcription.start(audioCapabilities.mode, captureSource);
      setIsRunning(true);
    } catch (error) {
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
  }

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col px-10 py-8">
      <header className="flex items-start justify-between">
        <div>
          <p className="mb-2 text-sm font-medium text-muted">面试工作台</p>
          <h2 className="text-3xl font-semibold tracking-tight">
            准备好开始了吗？
          </h2>
        </div>
        <div className="flex items-center gap-3 rounded-full border border-black/8 bg-white px-4 py-2 shadow-sm">
          <span
            className={`size-2 rounded-full ${
              isRunning ? "animate-pulse bg-emerald-500" : "bg-zinc-400"
            }`}
          />
          <span className="text-sm font-medium">
            {isRunning ? "计时中" : "时长已暂停"}
          </span>
          <span className="font-mono text-sm text-muted">
            {formatDuration(elapsedSeconds)}
          </span>
        </div>
      </header>

      <Card className="mt-8 border border-black/6 bg-white p-0 shadow-sm">
        <div className="flex items-center justify-between border-b border-black/6 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-[#f2f2f2]">
              <Volume2 className="size-5" />
            </div>
            <div>
              <Card.Title>采集选项</Card.Title>
              <Card.Description>选择音频输入来源</Card.Description>
            </div>
          </div>
        </div>

        <div className="px-6 py-5">
          <RadioGroup
            isDisabled={isRunning}
            name="capture-source"
            value={captureSource}
            variant="secondary"
            onChange={(value) => setCaptureSource(value as AudioCaptureSource)}
          >
            <Radio value="system-audio">
              <Radio.Content>
                <Radio.Control>
                  <Radio.Indicator />
                </Radio.Control>
                系统音频输出
              </Radio.Content>
              <Description>
                采集电脑播放的音频，适用于面试官声音从本机扬声器输出的场景
              </Description>
            </Radio>
            <Radio value="microphone">
              <Radio.Content>
                <Radio.Control>
                  <Radio.Indicator />
                </Radio.Control>
                麦克风
              </Radio.Content>
              <Description>
                采集麦克风输入作为面试官输出，适用于双设备场景
              </Description>
            </Radio>
          </RadioGroup>
        </div>
      </Card>

      <Card className="mt-4 border border-black/6 bg-white p-0 shadow-sm">
        <div className="flex items-center justify-between border-b border-black/6 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-[#f2f2f2]">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <Card.Title>权限检测</Card.Title>
              <Card.Description>
                开始面试前，请确认以下权限均已开启
              </Card.Description>
            </div>
          </div>
          <span className="text-sm text-muted">
            {allPermissionsGranted ? "设备已就绪" : "等待授权"}
          </span>
        </div>

        <div className="px-6">
          {captureSource === "system-audio" ? (
            <div className="flex items-center gap-4 py-4">
              <div className="grid size-10 place-items-center rounded-xl bg-[#f5f5f5]">
                {isLegacyMacCapture ? (
                  <MonitorUp className="size-5" />
                ) : (
                  <Volume2 className="size-5" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {isMacAudioOnly
                    ? "系统录音权限"
                    : isLegacyMacCapture
                      ? "屏幕录制权限"
                      : "系统输出音频"}
                </p>
                <p className="text-xs text-muted">
                  {isMacAudioOnly
                    ? `macOS ${audioCapabilities.macOSVersion} 仅采集系统音频输出，不读取屏幕`
                    : isLegacyMacCapture
                      ? `macOS ${audioCapabilities.macOSVersion} 只能通过屏幕录制权限获取系统音频；应用不会保存或上传屏幕画面`
                      : isUnsupported
                        ? `macOS ${audioCapabilities.macOSVersion} 不支持免驱动系统音频采集，请升级至 macOS 13 或更高版本`
                        : "Windows 支持系统音频回环，无需额外授权"}
                </p>
              </div>
              {systemAudioPermissionsGranted ? (
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
                  <span className="grid size-6 place-items-center rounded-full bg-emerald-50">
                    <Check className="size-4" />
                  </span>
                  {isMac ? "已授权" : "无需授权"}
                </div>
              ) : isUnsupported ? (
                <span className="text-sm font-medium text-red-500">不支持</span>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="grid size-6 place-items-center rounded-full bg-red-50 text-red-500">
                    <X className="size-4" />
                  </span>
                  <Button
                    isPending={isAuthorizing}
                    size="sm"
                    variant="outline"
                    onPress={() => void authorizeSystemCapture()}
                  >
                    {needsSystemSettings ? "打开系统设置" : "去授权"}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-4 py-4">
              <div className="grid size-10 place-items-center rounded-xl bg-[#f5f5f5]">
                <Mic className="size-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">麦克风权限</p>
                <p className="text-xs text-muted">
                  采集麦克风输入作为面试官输出，适用于双设备场景
                  {isMac ? "；请在系统设置中允许本应用访问麦克风" : ""}
                </p>
              </div>
              {microphonePermissionsGranted ? (
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
                  <span className="grid size-6 place-items-center rounded-full bg-emerald-50">
                    <Check className="size-4" />
                  </span>
                  {isMac ? "已授权" : "无需授权"}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="grid size-6 place-items-center rounded-full bg-red-50 text-red-500">
                    <X className="size-4" />
                  </span>
                  <Button
                    isPending={isAuthorizing}
                    size="sm"
                    variant="outline"
                    onPress={() => void authorizeMicrophone()}
                  >
                    {needsMicrophoneSettings ? "打开系统设置" : "去授权"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-black text-white shadow-lg shadow-black/15">
          {isRunning ? (
            <Clock3 className="size-6" />
          ) : (
            <Play className="ml-1 size-6" />
          )}
        </div>
        <h3 className="text-xl font-semibold">
          {isRunning ? "面试正在进行中" : "一切就绪，开始你的面试"}
        </h3>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted">
          {isRunning
            ? "AI 助手正在实时聆听并为你整理关键信息。"
            : "开始后将按实际使用时长计费，你可以随时暂停。"}
        </p>
        <Button
          className="mt-7 h-12 min-w-52 bg-black px-8 text-base text-white"
          isDisabled={!allPermissionsGranted}
          isPending={isStarting}
          size="lg"
          onPress={() => void handleToggleRunning()}
        >
          {isStarting
            ? "正在连接语音识别…"
            : isRunning
              ? "暂停面试"
              : "现在开始面试"}
        </Button>
        {!allPermissionsGranted ? (
          <p className="mt-3 text-xs text-muted">请先完成全部权限授权</p>
        ) : null}
      </div>

      <TranscriptPanel
        error={transcriptionError}
        finalLines={finalTranscripts}
        interimText={interimTranscript}
        isRunning={isRunning}
      />
    </div>
  );
}
