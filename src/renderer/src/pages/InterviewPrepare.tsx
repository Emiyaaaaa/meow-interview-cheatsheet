import {
  Button,
  Card,
  ComboBox,
  Description,
  Input,
  Label,
  ListBox,
  Modal,
  Radio,
  RadioGroup,
  Separator,
  Spinner,
  toast,
  Tooltip,
} from "@heroui/react";
import {
  ArrowRightIcon,
  AudioLines,
  Briefcase,
  Check,
  CircleAlert,
  FileText,
  Mic,
  MonitorUp,
  Play,
  Settings,
  Volume2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { HelpTip } from "../components/HelpTip";
import { useAuth } from "../context/AuthContext";
import { useInterview } from "../context/InterviewContext";
import {
  checkAsrConnection,
  checkChatConnection,
  IS_DEBUG,
  uploadResumeFile,
  waitForFileReady,
} from "../services";

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
type ApiCheckResult = { ok: true } | { ok: false; error: string };
type ApiCheckDetail = { label: string; result: ApiCheckResult | null };
type PrepStepState = "idle" | "loading" | "ok" | "error";

function settledApiResult(
  settled: PromiseSettledResult<unknown>,
  fallback: string,
): ApiCheckResult {
  if (settled.status === "fulfilled") return { ok: true };
  return {
    ok: false,
    error: settled.reason instanceof Error ? settled.reason.message : fallback,
  };
}

async function checkApiConnections() {
  const [asrSettled, chatSettled] = await Promise.allSettled([
    checkAsrConnection(),
    checkChatConnection(),
  ]);
  if (asrSettled.status === "rejected") console.error(asrSettled.reason);
  if (chatSettled.status === "rejected") console.error(chatSettled.reason);
  return {
    asr: settledApiResult(asrSettled, "语音识别服务检测失败"),
    chat: settledApiResult(chatSettled, "对话服务检测失败"),
  };
}

function ApiCheckDetailList({ details }: { details: ApiCheckDetail[] }) {
  return (
    <div className="flex max-w-xs flex-col gap-1.5 px-1 py-1.5">
      {details.map((item) => {
        const failed = !item.result?.ok;
        const error = item.result && !item.result.ok ? item.result.error : "";
        return (
          <p key={item.label} className="text-sm">
            <span className="font-medium">{item.label}</span>
            <span className={failed ? "text-red-500" : "text-emerald-600"}>
              {failed ? ` 失败${error ? `：${error}` : ""}` : " 成功"}
            </span>
          </p>
        );
      })}
    </div>
  );
}

interface SelectedResume {
  md5: string;
  name: string;
  path: string;
}

function ApiCheckStatus({
  details,
  onCheck,
  state,
}: {
  details: ApiCheckDetail[];
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
        <Tooltip delay={0}>
          <Tooltip.Trigger className="flex max-w-40 items-center gap-1 text-xs text-red-500">
            <CircleAlert className="size-3 shrink-0" />
            检测失败
          </Tooltip.Trigger>
          <Tooltip.Content showArrow>
            <Tooltip.Arrow />
            <ApiCheckDetailList details={details} />
          </Tooltip.Content>
        </Tooltip>
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

function PrepStepRow({
  details,
  label,
  state,
  statusText,
}: {
  details?: ApiCheckDetail[];
  label: string;
  state: PrepStepState;
  statusText: string;
}) {
  const status = (
    <div className="flex min-w-0 max-w-52 items-center justify-end gap-1.5 text-xs">
      {state === "loading" ? (
        <>
          <Spinner size="sm" />
          <span className="truncate text-muted">{statusText}</span>
        </>
      ) : state === "ok" ? (
        <>
          <Check className="size-3.5 shrink-0 text-emerald-600" />
          <span className="truncate text-emerald-600">{statusText}</span>
        </>
      ) : state === "error" ? (
        <>
          <CircleAlert className="size-3.5 shrink-0 text-red-500" />
          <span className="truncate text-red-500">{statusText}</span>
        </>
      ) : null}
    </div>
  );

  return (
    <div className="flex items-center gap-3">
      <p className="text-sm">{label}</p>
      <div className="flex-1" />
      {state === "error" && details ? (
        <Tooltip delay={0}>
          <Tooltip.Trigger>{status}</Tooltip.Trigger>
          <Tooltip.Content showArrow>
            <Tooltip.Arrow />
            <ApiCheckDetailList details={details} />
          </Tooltip.Content>
        </Tooltip>
      ) : (
        status
      )}
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
    isAuthorizingMicrophone,
    isAuthorizingSystemCapture,
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
  const { user, remainingSeconds } = useAuth();
  const [resume, setResume] = useState<SelectedResume | null>(null);
  const [isPickingResume, setIsPickingResume] = useState(false);
  const [interviewDirection, setInterviewDirection] = useState("");
  const [apiCheckState, setApiCheckState] = useState<ApiCheckState>("idle");
  const [asrCheckResult, setAsrCheckResult] = useState<ApiCheckResult | null>(
    null,
  );
  const [chatCheckResult, setChatCheckResult] = useState<ApiCheckResult | null>(
    null,
  );
  const [prepOpen, setPrepOpen] = useState(false);
  const [resumeStep, setResumeStep] = useState<PrepStepState>("idle");
  const [resumeStatusText, setResumeStatusText] = useState("");
  const [resumeFileId, setResumeFileId] = useState("");
  const apiCheckDetails: ApiCheckDetail[] = [
    { label: "实时语音识别接口", result: asrCheckResult },
    { label: "回答生成接口", result: chatCheckResult },
  ];
  const apiPrepState: PrepStepState =
    apiCheckState === "ok"
      ? "ok"
      : apiCheckState === "error"
        ? "error"
        : "loading";
  const apiPrepText =
    apiCheckState === "ok"
      ? "正常"
      : apiCheckState === "error"
        ? "检测失败"
        : "检测中";

  async function runApiCheck(isCancelled?: () => boolean) {
    setApiCheckState("checking");
    setAsrCheckResult(null);
    setChatCheckResult(null);
    const { asr, chat } = await checkApiConnections();
    if (isCancelled?.()) return;
    setAsrCheckResult(asr);
    setChatCheckResult(chat);
    setApiCheckState(asr.ok && chat.ok ? "ok" : "error");
  }

  useEffect(() => {
    if (!prepOpen) return;

    const controller = new AbortController();
    let cancelled = false;

    setResumeFileId("");
    if (!resume) {
      setResumeStep("ok");
      setResumeStatusText("未选择");
    } else {
      setResumeStep("loading");
      setResumeStatusText("上传中");
    }

    async function prepareResume() {
      if (!resume) {
        if (cancelled) return;
        setResumeStep("ok");
        setResumeStatusText("未选择");
        return;
      }

      try {
        const uploaded = await uploadResumeFile(resume, {
          signal: controller.signal,
        });
        if (cancelled) return;

        if (uploaded.status === "active") {
          setResumeFileId(uploaded.id);
          setResumeStep("ok");
          setResumeStatusText("完成");
          return;
        }

        setResumeStatusText("解析中");
        const ready = await waitForFileReady(uploaded.id, controller.signal);
        if (cancelled) return;

        setResumeFileId(ready.id);
        setResumeStep("ok");
        setResumeStatusText("完成");
      } catch (error) {
        if (
          cancelled ||
          (error instanceof Error &&
            (error.name === "AbortError" || /abort/i.test(error.message)))
        ) {
          return;
        }
        setResumeStep("error");
        setResumeStatusText(
          error instanceof Error ? error.message : "文件上传失败",
        );
      }
    }

    void prepareResume();
    void runApiCheck(() => cancelled);

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [prepOpen, resume]);

  async function handlePickResume() {
    setIsPickingResume(true);
    try {
      const selected = await window.desktop.pickResumeFile();
      if (!selected) return;
      setResume({
        md5: selected.md5,
        name: selected.name,
        path: selected.path,
      });
    } finally {
      setIsPickingResume(false);
    }
  }

  function handlePrepOpenChange(open: boolean) {
    if (isStarting) return;
    setPrepOpen(open);
  }

  const canStart = remainingSeconds > 0 && allPermissionsGranted;

  function requireLogin() {
    if (user) return true;
    toast("请登录");
    return false;
  }

  function handleOpenPrep() {
    if (!requireLogin()) return;
    setPrepOpen(true);
  }

  async function handleStartFromPrep() {
    if (!canStart || resumeStep !== "ok" || apiCheckState !== "ok") return;
    await startInterview({
      interviewDirection: interviewDirection.trim() || undefined,
      resumeFileId: resumeFileId || undefined,
    });
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
                isPending={isAuthorizingMicrophone}
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
                    ? `macOS ${audioCapabilities.macOSVersion} 通过「仅系统音频录制」采集电脑播放的声音，不会读取屏幕。请在系统设置 → 隐私与安全性 → 屏幕与系统音频录制 页面底部的「仅系统音频录制」中允许本应用，不要授权麦克风。`
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
                isPending={isAuthorizingSystemCapture}
                isUnsupported={isUnsupported}
                needsSettings={needsSystemSettings}
                onAuthorize={() => void authorizeSystemCapture()}
              />
            </div>

            <div className="flex items-center gap-2">
              <AudioLines className="size-4" />
              <p className="flex items-center gap-1 text-sm">
                接口连通性检查
                <HelpTip title="接口连通性">
                  并行检测语音识别与回答生成服务是否可连接
                </HelpTip>
              </p>
              <div className="flex-1" />
              <ApiCheckStatus
                details={apiCheckDetails}
                state={apiCheckState}
                onCheck={() => void runApiCheck()}
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
                  选择你的简历文件，开始面试时再上传并解析，帮助 AI
                  更准确地理解你的背景和技能
                </HelpTip>
              </p>
              <div className="flex-1" />
              {resume ? (
                <div className="flex items-center gap-2">
                  <span className="max-w-40 truncate text-xs">
                    {resume.name}
                  </span>
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
          isDisabled={Boolean(user) && !canStart}
          size="lg"
          onPress={handleOpenPrep}
        >
          <Play size="sm" />
          开始面试
        </Button>
        {IS_DEBUG ? (
          <Button
            className="mt-2 h-8 min-w-52 text-xs text-muted"
            size="sm"
            variant="tertiary"
            onPress={() => {
              if (!requireLogin()) return;
              void startInterviewDebug({
                interviewDirection: interviewDirection.trim() || undefined,
              });
            }}
          >
            打开面试面板
          </Button>
        ) : null}
        {transcriptionError ? (
          <p className="mt-3 text-sm text-red-600">{transcriptionError}</p>
        ) : user && remainingSeconds <= 0 ? (
          <p className="mt-3 text-xs text-muted">
            时长不足，请先充值或领取体验卡
          </p>
        ) : user && !allPermissionsGranted ? (
          <p className="mt-3 text-xs text-muted">请先完成全部权限授权</p>
        ) : null}
      </div>

      <Modal.Backdrop
        isDismissable={!isStarting}
        isKeyboardDismissDisabled={isStarting}
        isOpen={prepOpen}
        onOpenChange={handlePrepOpenChange}
      >
        <Modal.Container size="sm">
          <Modal.Dialog>
            {isStarting ? null : <Modal.CloseTrigger />}
            <Modal.Header>
              <Modal.Heading>准备工作</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="gap-4">
              <PrepStepRow
                label="简历文件上传并解析"
                state={resumeStep}
                statusText={resumeStatusText}
              />
              <PrepStepRow
                details={apiCheckDetails}
                label="接口连通性检查"
                state={apiPrepState}
                statusText={apiPrepText}
              />
            </Modal.Body>
            <Modal.Footer className="flex-col gap-3">
              {transcriptionError ? (
                <div className="flex w-full items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-left text-sm text-red-600">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 wrap-break-word">
                    {transcriptionError}
                  </span>
                </div>
              ) : null}
              <Button
                className="w-full bg-emerald-600/20 text-emerald-700"
                isDisabled={resumeStep !== "ok" || apiCheckState !== "ok"}
                isPending={isStarting}
                onPress={() => void handleStartFromPrep()}
              >
                {({ isPending }) => (
                  <>
                    {isPending ? <Spinner size="sm" /> : <Play size="sm" />}
                    {isPending ? "连接服务中…" : "开始面试"}
                  </>
                )}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
