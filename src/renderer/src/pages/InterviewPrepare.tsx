import {
  Button,
  Card,
  Description,
  Label,
  Radio,
  RadioGroup,
  Separator,
  Spinner,
} from "@heroui/react";
import {
  ArrowRightIcon,
  Check,
  Mic,
  MonitorUp,
  Play,
  Settings,
  Volume2,
} from "lucide-react";
import { HelpTip } from "../components/HelpTip";
import { useInterview } from "../context/InterviewContext";

function PermissionStatus({
  granted,
  grantedLabel,
  isPending,
  isUnsupported = false,
  needsSettings,
  onAuthorize,
}: {
  granted: boolean;
  grantedLabel: string;
  isPending: boolean;
  isUnsupported?: boolean;
  needsSettings: boolean;
  onAuthorize: () => void;
}) {
  if (granted) {
    return (
      <div className="flex items-center gap-2 text-xs text-emerald-600">
        <Check className="size-3" />
        {grantedLabel}
      </div>
    );
  }

  if (isUnsupported) {
    return <span className="text-xs text-red-500">不支持</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        className="text-xs h-6"
        isPending={isPending}
        size="sm"
        variant="danger-soft"
        onPress={onAuthorize}
      >
        {needsSettings ? (
          <>
            <Settings className="size-2" />
            {"打开系统设置"}
          </>
        ) : (
          <>
            {"去授权"}
            <ArrowRightIcon className="size-3" />
          </>
        )}
      </Button>
    </div>
  );
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function InterviewPreparePage() {
  const {
    allPermissionsGranted,
    audioCapabilities,
    authorizeMicrophone,
    authorizeSystemCapture,
    captureSource,
    elapsedSeconds,
    isAuthorizing,
    isLegacyMacCapture,
    isMac,
    isMacAudioOnly,
    isStarting,
    isUnsupported,
    microphonePermissionsGranted,
    needsMicrophoneSettings,
    needsSystemSettings,
    setCaptureSource,
    startInterview,
    systemAudioPermissionsGranted,
    transcriptionError,
  } = useInterview();

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col px-10 py-8">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">
            准备好开始了吗？
          </h2>
        </div>
        <div className="flex items-center gap-3 rounded-full border border-black/8 bg-white px-4 py-2 shadow-sm">
          <span className="size-2 rounded-full bg-zinc-400" />
          <span className="text-sm font-medium">时长已暂停</span>
          <span className="font-mono text-sm text-muted">
            剩余 {formatDuration(elapsedSeconds)}
          </span>
        </div>
      </header>

      <Card className="mt-6">
        <RadioGroup
          className="p-2"
          name="capture-source"
          value={captureSource}
          variant="secondary"
          onChange={(value) => setCaptureSource(value as AudioCaptureSource)}
        >
          <div className="flex flex-col gap-1">
            <Label>采集设置</Label>
            <Description>选择面试官声音来源</Description>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              {
                description:
                  "采集电脑播放的音频，适用于面试官声音从本机扬声器输出的场景",
                title: "系统音频输出",
                value: "system-audio",
              },
              {
                description: "采集麦克风输入作为面试官输出，适用于双设备场景",
                title: "麦克风",
                value: "microphone",
              },
            ].map((option) => (
              <Radio key={option.value} value={option.value}>
                <Radio.Content className="group relative flex w-full flex-col gap-6 rounded-xl border border-transparent bg-surface px-5 py-4 transition-all data-[selected=true]:border-accent data-[selected=true]:bg-accent/10 data-[focus-visible=true]:border-accent data-[focus-visible=true]:bg-accent/10">
                  <Radio.Control className="absolute inset-e-4 top-3 size-5">
                    <Radio.Indicator />
                  </Radio.Control>
                  <div className="flex flex-col gap-1 pr-8">
                    <span>{option.title}</span>
                    <Description>{option.description}</Description>
                  </div>
                </Radio.Content>
              </Radio>
            ))}
          </div>
        </RadioGroup>
      </Card>

      <Card className="mt-4">
        <div className="p-2">
          <div className="flex flex-col gap-1">
            <Label>前置检查</Label>
            <Description>开始面试前，请确认以下各项均正常</Description>
          </div>
          <Separator className="my-4" />
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Mic className="size-4" />
              <p className="flex items-center gap-1 text-sm">
                麦克风权限
                <HelpTip title="麦克风权限">
                  采集麦克风输入作为面试官输出，适用于双设备场景
                  {isMac ? "；请在系统设置中允许本应用访问麦克风" : ""}
                </HelpTip>
              </p>
              <div className="flex-1" />
              <PermissionStatus
                granted={microphonePermissionsGranted}
                grantedLabel={isMac ? "已授权" : "无需授权"}
                isPending={isAuthorizing}
                needsSettings={needsMicrophoneSettings}
                onAuthorize={() => void authorizeMicrophone()}
              />
            </div>

            <div className="flex items-center gap-2">
              {isLegacyMacCapture ? (
                <MonitorUp className="size-4" />
              ) : (
                <Volume2 className="size-4" />
              )}
              <p className="flex items-center gap-1 text-sm">
                {isMacAudioOnly
                  ? "系统录音权限"
                  : isLegacyMacCapture
                    ? "屏幕录制权限"
                    : "系统输出音频"}
                <HelpTip
                  title={
                    isMacAudioOnly
                      ? "系统录音权限"
                      : isLegacyMacCapture
                        ? "屏幕录制权限"
                        : "系统输出音频"
                  }
                >
                  {isMacAudioOnly
                    ? `macOS ${audioCapabilities.macOSVersion} 仅采集系统音频输出，不读取屏幕`
                    : isLegacyMacCapture
                      ? `macOS ${audioCapabilities.macOSVersion} 只能通过屏幕录制权限获取系统音频；应用不会保存或上传屏幕画面`
                      : isUnsupported
                        ? `macOS ${audioCapabilities.macOSVersion} 不支持免驱动系统音频采集，请升级至 macOS 13 或更高版本`
                        : "Windows 支持系统音频回环，无需额外授权"}
                </HelpTip>
              </p>
              <div className="flex-1" />
              <PermissionStatus
                granted={systemAudioPermissionsGranted}
                grantedLabel={isMac ? "已授权" : "无需授权"}
                isPending={isAuthorizing}
                isUnsupported={isUnsupported}
                needsSettings={needsSystemSettings}
                onAuthorize={() => void authorizeSystemCapture()}
              />
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Button
          className="mt-7 h-12 min-w-52 bg-black px-8 text-base text-white"
          isDisabled={!allPermissionsGranted}
          isPending={isStarting}
          size="lg"
          onPress={() => void startInterview()}
        >
          {({ isPending }) => (
            <>
              {isPending ? <Spinner size="sm" /> : <Play size="sm" />}
              {isPending ? "连接语音识别" : "现在开始面试"}
            </>
          )}
        </Button>
        <Description className="mt-2">
          开始后将按实际使用时长计费，你可以随时暂停。
        </Description>
        {transcriptionError ? (
          <p className="mt-3 text-sm text-red-600">{transcriptionError}</p>
        ) : !allPermissionsGranted ? (
          <p className="mt-3 text-xs text-muted">请先完成全部权限授权</p>
        ) : null}
      </div>
    </div>
  );
}
