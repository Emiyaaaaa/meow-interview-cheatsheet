import {
  Button,
  Card,
  ComboBox,
  Description,
  Input,
  Label,
  ListBox,
  Radio,
  RadioGroup,
  Separator,
  Spinner,
} from "@heroui/react";
import {
  ArrowRightIcon,
  AudioLines,
  Briefcase,
  Check,
  FileText,
  MessageSquare,
  Mic,
  MonitorUp,
  Play,
  Settings,
  Volume2,
} from "lucide-react";
import { useState } from "react";
import { HelpTip } from "../components/HelpTip";
import { useInterview } from "../context/InterviewContext";
import { checkAsrConnection, checkChatConnection } from "../services";

const INTERVIEW_DIRECTIONS = [
  { id: "frontend", name: "前端开发" },
  { id: "frontend-react", name: "React 开发" },
  { id: "frontend-react", name: "Vue 开发" },
  { id: "frontend-mini-program", name: "小程序开发" },
  { id: "backend", name: "后端开发" },
  { id: "fullstack", name: "全栈开发" },
  { id: "mobile", name: "移动端开发" },
  { id: "algorithm", name: "算法与数据结构" },
  { id: "system-design", name: "系统设计" },
  { id: "java", name: "Java 开发" },
  { id: "python", name: "Python 开发" },
  { id: "go", name: "Go 开发" },
  { id: "devops", name: "运维 / DevOps" },
  { id: "data", name: "数据分析" },
  { id: "ai", name: "人工智能 / 机器学习" },
  { id: "qa", name: "测试开发" },
] as const;

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

type ApiCheckState = "idle" | "checking" | "ok" | "error";

function ApiCheckStatus({
  errorLabel,
  onCheck,
  state,
}: {
  errorLabel?: string;
  onCheck: () => void;
  state: ApiCheckState;
}) {
  const isPending = state === "checking";

  return (
    <div className="flex items-center gap-2">
      {state === "ok" ? (
        <div className="flex items-center gap-2 text-xs text-emerald-600">
          <Check className="size-3" />
          正常
        </div>
      ) : state === "error" ? (
        <span className="max-w-40 truncate text-xs text-red-500">
          {errorLabel || "检测失败"}
        </span>
      ) : null}
      <Button
        className="text-xs h-6"
        isPending={isPending}
        size="sm"
        variant={state === "error" ? "danger-soft" : "tertiary"}
        onPress={onCheck}
      >
        {isPending ? "检测中" : state === "idle" ? "检测" : "重新检测"}
      </Button>
    </div>
  );
}

export function InterviewPreparePage() {
  const {
    allPermissionsGranted,
    audioCapabilities,
    authorizeMicrophone,
    authorizeSystemCapture,
    captureSource,
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
    startInterviewDebug,
    systemAudioPermissionsGranted,
    transcriptionError,
  } = useInterview();
  const [resume, setResume] = useState<ResumeFileSelection | null>(null);
  const [isPickingResume, setIsPickingResume] = useState(false);
  const [interviewDirection, setInterviewDirection] = useState("");
  const [asrCheckState, setAsrCheckState] = useState<ApiCheckState>("idle");
  const [asrCheckError, setAsrCheckError] = useState("");
  const [chatCheckState, setChatCheckState] = useState<ApiCheckState>("idle");
  const [chatCheckError, setChatCheckError] = useState("");

  async function handleCheckAsr() {
    setAsrCheckState("checking");
    setAsrCheckError("");
    try {
      await checkAsrConnection();
      setAsrCheckState("ok");
    } catch (error) {
      setAsrCheckState("error");
      setAsrCheckError(
        error instanceof Error ? error.message : "语音识别服务检测失败",
      );
      console.error(error);
    }
  }

  async function handleCheckChat() {
    setChatCheckState("checking");
    setChatCheckError("");
    try {
      await checkChatConnection();
      setChatCheckState("ok");
    } catch (error) {
      setChatCheckState("error");
      setChatCheckError(
        error instanceof Error ? error.message : "对话服务检测失败",
      );
      console.error(error);
    }
  }

  async function handlePickResume() {
    setIsPickingResume(true);
    try {
      const selected = await window.desktop.pickResumeFile();
      if (selected) {
        setResume(selected);
      }
    } finally {
      setIsPickingResume(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col p-4 gap-4">
      <Card>
        <div className="p-2">
          <div className="flex flex-col gap-1">
            <Label>权限检查</Label>
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

            <div className="flex items-center gap-2">
              <AudioLines className="size-4" />
              <p className="flex items-center gap-1 text-sm">
                实时语音识别接口
                <HelpTip title="ASR 接口">
                  检测语音识别服务是否可连接，用于将面试官语音转成文字
                </HelpTip>
              </p>
              <div className="flex-1" />
              <ApiCheckStatus
                errorLabel={asrCheckError}
                state={asrCheckState}
                onCheck={() => void handleCheckAsr()}
              />
            </div>

            <div className="flex items-center gap-2">
              <MessageSquare className="size-4" />
              <p className="flex items-center gap-1 text-sm">
                回答生成接口
                <HelpTip title="Chat 接口">
                  检测对话服务是否可用，用于生成面试回答建议
                </HelpTip>
              </p>
              <div className="flex-1" />
              <ApiCheckStatus
                errorLabel={chatCheckError}
                state={chatCheckState}
                onCheck={() => void handleCheckChat()}
              />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <RadioGroup
          className="p-2"
          name="capture-source"
          value={captureSource}
          variant="secondary"
          onChange={(value) => setCaptureSource(value as AudioCaptureSource)}
        >
          <div className="mb-4">
            <Label>选择面试官声音来源</Label>
          </div>
          <div className="grid gap-1 md:grid-cols-2">
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
              <Radio className={"mt-0"} key={option.value} value={option.value}>
                <Radio.Content className="items-start h-full group relative flex w-full flex-col gap-6 rounded-xl border border-transparent px-5 py-4 transition-all data-[selected=true]:border-emerald-600/70 data-[selected=true]:bg-emerald-600/5 data-[focus-visible=true]:border-accent data-[focus-visible=true]:bg-accent/10">
                  <Radio.Control className="absolute inset-e-4 top-3 size-5 rounded-full border border-border bg-default shadow-none group-data-[pressed=true]:scale-95 group-data-[selected=true]:border-transparent group-data-[selected=true]:bg-emerald-500">
                    <Radio.Indicator className="before:rounded-full before:bg-default group-data-[selected=true]:before:scale-50 group-data-[selected=true]:group-data-[pressed=true]:before:scale-[0.57]" />
                  </Radio.Control>
                  <div className="flex flex-col gap-1 pr-8">
                    <span>{option.title}</span>
                    <Description className="font-normal">
                      {option.description}
                    </Description>
                  </div>
                </Radio.Content>
              </Radio>
            ))}
          </div>
        </RadioGroup>
      </Card>
      <Card>
        <div className="p-2">
          <div className="flex flex-col gap-1">
            <Label>补充面试信息（非必填）</Label>
          </div>
          <Separator className="my-4" />
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <FileText className="size-4" />
              <p className="flex items-center gap-1 text-sm">
                选择简历
                <HelpTip title="选择简历">
                  上传你的简历文件，帮助 AI 更准确地理解你的背景和技能
                </HelpTip>
              </p>
              <div className="flex-1" />
              {resume ? (
                <div className="flex items-center gap-2">
                  <div className="flex shrink items-center gap-2 text-xs text-emerald-600">
                    <Check className="size-3 shrink-0" />
                    <span className="truncate">{resume.name}</span>
                  </div>
                  <Button
                    className="text-xs h-6"
                    isPending={isPickingResume}
                    size="sm"
                    variant="secondary"
                    onPress={() => void handlePickResume()}
                  >
                    重新选择
                  </Button>
                </div>
              ) : (
                <Button
                  className="text-xs h-6"
                  isPending={isPickingResume}
                  size="sm"
                  variant="tertiary"
                  onPress={() => void handlePickResume()}
                >
                  选择文件
                  <ArrowRightIcon className="size-3" />
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Briefcase className="size-4" />
              <p className="flex items-center gap-1 text-sm">
                面试岗位
                <HelpTip title="面试方向">
                  选择或输入本次面试的岗位岗位，AI 将据此调整回答重点
                </HelpTip>
              </p>
              <div className="flex-1" />
              <ComboBox
                allowsCustomValue
                className={"w-36"}
                inputValue={interviewDirection}
                onInputChange={setInterviewDirection}
              >
                <ComboBox.InputGroup>
                  <Input
                    placeholder="选择或输入方向…"
                    className="text-xs py-1"
                  />
                  <ComboBox.Trigger />
                </ComboBox.InputGroup>
                <ComboBox.Popover>
                  <ListBox>
                    {INTERVIEW_DIRECTIONS.map((direction) => (
                      <ListBox.Item
                        key={direction.id}
                        id={direction.id}
                        textValue={direction.name}
                      >
                        {direction.name}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </ComboBox.Popover>
              </ComboBox>
            </div>
          </div>
        </div>
      </Card>
      <div className="flex flex-col items-center justify-center py-2 text-center">
        <Button
          className="mt-4 h-12 min-w-52 bg-emerald-600/20 px-8 text-base text-emerald-700"
          isDisabled={!allPermissionsGranted}
          isPending={isStarting}
          size="lg"
          onPress={() =>
            void startInterview({
              interviewDirection: interviewDirection.trim() || undefined,
            })
          }
        >
          {({ isPending }) => (
            <>
              {isPending ? <Spinner size="sm" /> : <Play size="sm" />}
              {isPending ? "连接服务" : "开始面试"}
            </>
          )}
        </Button>
        <Button
          className="mt-2 h-8 min-w-52 text-xs text-muted"
          size="sm"
          variant="tertiary"
          onPress={() =>
            startInterviewDebug({
              interviewDirection: interviewDirection.trim() || undefined,
            })
          }
        >
          Debug
        </Button>
        {transcriptionError ? (
          <p className="mt-3 text-sm text-red-600">{transcriptionError}</p>
        ) : !allPermissionsGranted ? (
          <p className="mt-3 text-xs text-muted">请先完成全部权限授权</p>
        ) : null}
      </div>
    </div>
  );
}
