import { Button, Card, Input, Spinner, TextField } from "@heroui/react";
import { ArrowRight, Square } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useAuth } from "../context/AuthContext";
import { sendUsageHeartbeat } from "../services/account";
import { chat, isChatAbortError } from "../services/chat";
import { DEFAULT_CHAT_MODEL } from "../services/config";
import { deleteResumeFile } from "../services/files";
import {
  beginInterviewSession,
  buildInterviewRecord,
  createThrottledRecordSaver,
  type ActiveInterviewSession,
  type InterviewOverallEvaluation,
} from "../services/interview-records";
import { SystemAudioTranscription } from "../transcription";

const SCROLL_THRESHOLD_PX = 48;
let mockSessionGeneration = 0;

type QuestionStatus = "loading" | "ready" | "error";
type SessionPhase = "live" | "completed";

interface OverallEvaluation {
  advice: string;
  error?: string;
  score: number | null;
  status: "loading" | "ready" | "error";
  summary: string;
}

interface MockRound {
  id: string;
  question: string;
  questionStatus: QuestionStatus;
  questionError?: string;
  answer: string;
  manualAnswer: string;
}

function appendTranscript(base: string, next: string) {
  const a = base.trimEnd();
  const b = next.trim();
  if (!a) return b;
  if (!b) return a;
  const needSpace = /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b);
  return needSpace ? `${a} ${b}` : `${a}${b}`;
}

function composeAnswer(...parts: string[]) {
  return parts.reduce((acc, part) => appendTranscript(acc, part), "");
}

function parseOverallEvaluation(text: string): {
  score: number | null;
  summary: string;
  advice: string;
} {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { score: null, summary: text.trim(), advice: "" };
  }
  try {
    const data = JSON.parse(jsonMatch[0]) as {
      score?: unknown;
      summary?: unknown;
      advice?: unknown;
    };
    const rawScore = Number(data.score);
    const score = Number.isFinite(rawScore)
      ? Math.min(10, Math.max(1, Math.round(rawScore)))
      : null;
    const summary = String(data.summary ?? "").trim() || text.trim();
    const advice = String(data.advice ?? "").trim();
    return { score, summary, advice };
  } catch {
    return { score: null, summary: text.trim(), advice: "" };
  }
}

function hasEvaluableAnswer(rounds: MockRound[]) {
  return rounds.some((round) =>
    composeAnswer(round.answer, round.manualAnswer).trim(),
  );
}

function interviewerSystemPrompt(direction: string, hasResume: boolean) {
  return [
    "你是一位严谨、专业的技术面试官，正在进行模拟面试。",
    "每次只提出一个问题，语言自然口语化，适合口头提问，不要一次问多个问题。",
    direction ? `面试方向：${direction}。` : "",
    hasResume ? "已通过文件提供候选人简历，请结合简历中的经历与技能提问。" : "",
    "当用户请求面试总评时，只输出 JSON，不要输出问题，不要使用 Markdown。JSON 字段：score（1-10 整数）、summary（整体评价）、advice（改进建议）。",
  ]
    .filter(Boolean)
    .join("");
}

function RoundCard({
  canFill,
  draftText,
  inputEnabled,
  inputPlaceholder,
  interimText,
  isCurrent,
  listening,
  manualInputFocused,
  onDraftBlur,
  onDraftChange,
  onDraftFocus,
  onDraftKeyDown,
  onFill,
  round,
}: {
  canFill: boolean;
  draftText: string;
  inputEnabled: boolean;
  inputPlaceholder: string;
  interimText: string;
  isCurrent: boolean;
  listening: boolean;
  manualInputFocused: boolean;
  onDraftBlur: () => void;
  onDraftChange: (value: string) => void;
  onDraftFocus: () => void;
  onDraftKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onFill: () => void;
  round: MockRound;
}) {
  const showInterim = isCurrent && round.questionStatus === "ready";
  const displayAnswer = showInterim
    ? composeAnswer(round.answer, interimText, round.manualAnswer)
    : composeAnswer(round.answer, round.manualAnswer);
  const showRecordingStatus = showInterim && (listening || manualInputFocused);

  return (
    <Card
      className="border border-black/6 bg-[#f8f8f8] shadow-none"
      variant="secondary"
    >
      <Card.Header className="gap-1">
        {showRecordingStatus ? (
          <div className="flex h-4 items-center">
            {manualInputFocused ? (
              <span className="text-xs text-muted">
                手动输入中，录音已暂停
              </span>
            ) : (
              <span
                aria-label="录音中"
                className="size-2 animate-pulse rounded-full bg-brand"
              />
            )}
          </div>
        ) : null}
        <Card.Title className="text-sm">面试官</Card.Title>
        <Card.Description className="text-sm leading-6 text-foreground">
          {round.questionStatus === "error" ? (
            <span className="text-red-600">
              {round.questionError ?? "生成问题失败"}
            </span>
          ) : round.questionStatus === "loading" && !round.question ? (
            <span className="inline-flex items-center gap-2 text-muted">
              <Spinner size="sm" />
              正在生成问题…
            </span>
          ) : (
            round.question
          )}
        </Card.Description>
      </Card.Header>
      {round.questionStatus === "ready" ? (
        <Card.Content className="border-t border-black/6 pt-3">
          <p className="mb-2 text-xs font-medium text-muted">你的回答</p>
          {displayAnswer ? (
            <p className="text-sm leading-7 text-foreground whitespace-pre-wrap">
              {displayAnswer}
              {showInterim && interimText ? (
                <Spinner size="sm" className="ml-2 inline-block align-middle" />
              ) : null}
            </p>
          ) : (
            <p className="text-sm text-muted">
              {showInterim ? "正在聆听你的回答…" : "未作答"}
            </p>
          )}
          {showInterim && inputEnabled ? (
            <div className="mt-3 flex items-center gap-2">
              <TextField
                aria-label="手动输入回答"
                className="min-w-0 flex-1"
                name="mock-answer"
                value={draftText}
                onChange={onDraftChange}
              >
                <Input
                  fullWidth
                  className="w-full text-sm"
                  placeholder={inputPlaceholder}
                  onBlur={onDraftBlur}
                  onFocus={onDraftFocus}
                  onKeyDown={onDraftKeyDown}
                />
              </TextField>
              <Button
                className="shrink-0 bg-brand/20 text-brand"
                isDisabled={!canFill}
                onPointerDown={(event) => event.preventDefault()}
                onPress={onFill}
              >
                填入
              </Button>
            </div>
          ) : null}
        </Card.Content>
      ) : null}
    </Card>
  );
}

export function MockInterviewSessionPage() {
  const { setRemainingSeconds } = useAuth();
  const [rounds, setRounds] = useState<MockRound[]>([]);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [draftAnswer, setDraftAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const transcriptionRef = useRef<SystemAudioTranscription | null>(null);
  const resumeFileIdRef = useRef("");
  const directionRef = useRef("");
  const previousResponseIdRef = useRef("");
  const chatControllersRef = useRef(new Map<string, AbortController>());
  const generationRef = useRef(0);
  const listeningRef = useRef(false);
  const [listening, setListening] = useState(false);
  const currentRoundIdRef = useRef("");
  const cleanedRef = useRef(false);
  const lastFinalRef = useRef("");
  const interimTranscriptRef = useRef("");
  const draftAnswerRef = useRef("");
  const manualInputFocusedRef = useRef(false);
  const [manualInputFocused, setManualInputFocused] = useState(false);
  const stoppingForQuotaRef = useRef(false);
  const heartbeatLastAtRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const recordSessionRef = useRef<ActiveInterviewSession | null>(null);
  const recordSaverRef = useRef(createThrottledRecordSaver());
  const roundsRef = useRef<MockRound[]>([]);
  const phaseRef = useRef<SessionPhase>("live");
  const overallRef = useRef<InterviewOverallEvaluation | null>(null);
  const recordFinalizedRef = useRef(false);
  const flushHeartbeatRef = useRef<() => Promise<void>>(async () => undefined);
  const [phase, setPhase] = useState<SessionPhase>("live");
  const [overall, setOverall] = useState<OverallEvaluation | null>(null);

  const setListeningState = useCallback((value: boolean) => {
    listeningRef.current = value;
    setListening(value);
  }, []);

  const setInterimText = useCallback((text: string) => {
    interimTranscriptRef.current = text;
    setInterimTranscript(text);
  }, []);

  const setDraftText = useCallback((text: string) => {
    draftAnswerRef.current = text;
    setDraftAnswer(text);
  }, []);

  const setManualInputFocusedState = useCallback(
    (value: boolean) => {
      manualInputFocusedRef.current = value;
      setManualInputFocused(value);
      if (value) setInterimText("");
    },
    [setInterimText],
  );

  const abortPendingChats = useCallback(() => {
    for (const controller of chatControllersRef.current.values()) {
      controller.abort();
    }
    chatControllersRef.current.clear();
    generationRef.current += 1;
  }, []);

  const runChat = useCallback(
    async (
      userContent: string,
      options?: { attachResume?: boolean; signal?: AbortSignal },
    ) => {
      const resumeFileId = resumeFileIdRef.current;
      const { content, responseId } = await chat(
        [
          {
            role: "system",
            content: interviewerSystemPrompt(
              directionRef.current,
              Boolean(resumeFileId),
            ),
          },
          { role: "user", content: userContent },
        ],
        {
          fileId:
            options?.attachResume && !previousResponseIdRef.current
              ? resumeFileId || undefined
              : undefined,
          model: DEFAULT_CHAT_MODEL,
          previousResponseId: previousResponseIdRef.current || undefined,
          signal: options?.signal,
          store: true,
        },
      );
      if (responseId) previousResponseIdRef.current = responseId;
      return content;
    },
    [],
  );

  const askQuestion = useCallback(
    async (prompt: string, attachResume: boolean) => {
      const id = crypto.randomUUID();
      const generation = generationRef.current;
      const controller = new AbortController();
      chatControllersRef.current.set(id, controller);
      currentRoundIdRef.current = id;
      setListeningState(false);
      lastFinalRef.current = "";
      setInterimText("");
      setDraftText("");
      setRounds((current) => [
        ...current,
        {
          id,
          question: "",
          questionStatus: "loading",
          answer: "",
          manualAnswer: "",
        },
      ]);

      try {
        const question = await runChat(prompt, {
          attachResume,
          signal: controller.signal,
        });
        if (generationRef.current !== generation) return;
        const trimmed = question.trim();
        setRounds((current) =>
          current.map((round) =>
            round.id === id
              ? {
                  ...round,
                  question: trimmed,
                  questionStatus: "ready",
                }
              : round,
          ),
        );
        currentRoundIdRef.current = id;
        setListeningState(true);
      } catch (chatError: unknown) {
        if (
          generationRef.current !== generation ||
          isChatAbortError(chatError)
        ) {
          return;
        }
        const message =
          chatError instanceof Error ? chatError.message : "生成问题失败";
        setRounds((current) =>
          current.map((round) =>
            round.id === id
              ? {
                  ...round,
                  questionStatus: "error",
                  questionError: message,
                }
              : round,
          ),
        );
        setError(message);
      } finally {
        chatControllersRef.current.delete(id);
      }
    },
    [runChat, setDraftText, setInterimText, setListeningState],
  );

  const commitCurrentAnswer = useCallback((rounds: MockRound[]) => {
    const roundId = currentRoundIdRef.current;
    if (!roundId) return rounds;
    return rounds.map((round) => {
      if (round.id !== roundId) return round;
      const answer = composeAnswer(
        round.answer,
        interimTranscriptRef.current,
        round.manualAnswer,
        draftAnswerRef.current,
      ).trim();
      if (!answer) return round;
      return { ...round, answer, manualAnswer: "" };
    });
  }, []);

  const finishAnswer = useCallback(async () => {
    const roundId = currentRoundIdRef.current;
    if (!roundId || !listeningRef.current || phaseRef.current !== "live") {
      return;
    }
    const answer = composeAnswer(
      roundsRef.current.find((round) => round.id === roundId)?.answer ?? "",
      interimTranscriptRef.current,
      roundsRef.current.find((round) => round.id === roundId)?.manualAnswer ??
        "",
      draftAnswerRef.current,
    ).trim();
    if (!answer) return;

    const next = commitCurrentAnswer(roundsRef.current);
    roundsRef.current = next;
    setRounds(next);
    setInterimText("");
    setDraftText("");
    await askQuestion("请提出下一个面试问题。只输出问题本身。", false);
  }, [askQuestion, commitCurrentAnswer, setDraftText, setInterimText]);

  const sendDraft = useCallback(() => {
    const roundId = currentRoundIdRef.current;
    const draft = draftAnswerRef.current.trim();
    if (!roundId || !listeningRef.current || !draft) return;
    setRounds((current) =>
      current.map((round) =>
        round.id === roundId
          ? {
              ...round,
              manualAnswer: appendTranscript(round.manualAnswer, draft),
            }
          : round,
      ),
    );
    setDraftText("");
  }, [setDraftText]);

  const snapshotRecordItems = useCallback((rounds: MockRound[]) => {
    return rounds.map((round) => ({
      id: round.id,
      question: round.question,
      answer: composeAnswer(round.answer, round.manualAnswer),
      status: round.questionStatus,
      error: round.questionError,
    }));
  }, []);

  const finalizeInterviewRecord = useCallback(async () => {
    const session = recordSessionRef.current;
    if (!session || recordFinalizedRef.current) return;
    recordFinalizedRef.current = true;
    const endedAt = Date.now();
    const durationSeconds = Math.max(
      0,
      Math.round((endedAt - session.startedAt) / 1000),
    );
    await recordSaverRef.current.finalize(
      buildInterviewRecord({
        session,
        durationSeconds,
        endedAt,
        items: snapshotRecordItems(roundsRef.current),
        overallEvaluation: overallRef.current,
      }),
    );
    recordSessionRef.current = null;
  }, [snapshotRecordItems]);

  const evaluateInterview = useCallback(async () => {
    if (!hasEvaluableAnswer(roundsRef.current)) {
      const message = "本次面试没有可评估的回答";
      overallRef.current = {
        status: "error",
        score: null,
        summary: "",
        advice: "",
        error: message,
      };
      setOverall(overallRef.current);
      return;
    }

    const generation = generationRef.current;
    const controller = new AbortController();
    chatControllersRef.current.set("overall", controller);
    overallRef.current = null;
    setOverall({
      status: "loading",
      score: null,
      summary: "",
      advice: "",
    });

    const transcript = roundsRef.current
      .filter(
        (round) =>
          round.question.trim() ||
          composeAnswer(round.answer, round.manualAnswer).trim(),
      )
      .map((round, index) => {
        const answer = composeAnswer(round.answer, round.manualAnswer).trim();
        return [
          `${index + 1}. 问题：${round.question.trim() || "（问题未生成）"}`,
          `回答：${answer || "（未作答）"}`,
        ].join("\n");
      })
      .join("\n\n");

    try {
      const raw = await runChat(
        [
          "模拟面试已经结束。请根据下面的全部问答，给出这次面试的总评。",
          "只输出 JSON：",
          '{"score":8,"summary":"...","advice":"..."}',
          "score 为 1 到 10 的整数；summary 为整体评价；advice 为改进建议。",
          "",
          transcript,
        ].join("\n"),
        { signal: controller.signal },
      );
      if (generationRef.current !== generation) return;
      const parsed = parseOverallEvaluation(raw);
      const ready: InterviewOverallEvaluation = {
        status: "ready",
        score: parsed.score,
        summary: parsed.summary,
        advice: parsed.advice,
      };
      overallRef.current = ready;
      setOverall(ready);
      await finalizeInterviewRecord();
    } catch (chatError: unknown) {
      if (
        generationRef.current !== generation ||
        isChatAbortError(chatError)
      ) {
        return;
      }
      const message =
        chatError instanceof Error ? chatError.message : "生成总评失败";
      overallRef.current = {
        status: "error",
        score: null,
        summary: "",
        advice: "",
        error: message,
      };
      setOverall(overallRef.current);
    } finally {
      chatControllersRef.current.delete("overall");
    }
  }, [finalizeInterviewRecord, runChat]);

  const completeInterview = useCallback(async () => {
    if (phaseRef.current !== "live") return;
    setListeningState(false);
    setManualInputFocusedState(false);
    transcriptionRef.current?.stop();
    phaseRef.current = "completed";

    const next = commitCurrentAnswer(roundsRef.current);
    roundsRef.current = next;
    setRounds(next);
    setInterimText("");
    setDraftText("");
    setPhase("completed");
    await flushHeartbeatRef.current();
    abortPendingChats();

    const session = recordSessionRef.current;
    if (session) {
      const durationSeconds = Math.max(
        0,
        Math.round((Date.now() - session.startedAt) / 1000),
      );
      recordSaverRef.current.schedule(
        buildInterviewRecord({
          session,
          durationSeconds,
          endedAt: null,
          items: snapshotRecordItems(next),
          overallEvaluation: null,
        }),
      );
    }

    await evaluateInterview();
  }, [
    abortPendingChats,
    commitCurrentAnswer,
    evaluateInterview,
    setDraftText,
    setInterimText,
    setListeningState,
    setManualInputFocusedState,
    snapshotRecordItems,
  ]);

  const flushHeartbeat = useCallback(async () => {
    const now = Date.now();
    const seconds = Math.round((now - heartbeatLastAtRef.current) / 1000);
    heartbeatLastAtRef.current = now;
    if (seconds < 1) return;
    try {
      const result = await sendUsageHeartbeat(Math.min(seconds, 90));
      setRemainingSeconds(result.remaining_seconds);
      window.desktop.publishMockRemaining(result.remaining_seconds);
      if (
        result.remaining_seconds <= 0 &&
        !stoppingForQuotaRef.current &&
        phaseRef.current === "live"
      ) {
        stoppingForQuotaRef.current = true;
        setError("面试时长已用完，请充值后继续");
        void completeInterview();
      }
    } catch (heartbeatError) {
      console.error("同步模拟面试时长失败", heartbeatError);
    }
  }, [completeInterview, setRemainingSeconds]);

  const cleanup = useCallback(async () => {
    if (cleanedRef.current) return;
    cleanedRef.current = true;
    setListeningState(false);
    transcriptionRef.current?.stop();
    abortPendingChats();
    if (phaseRef.current === "live") {
      await flushHeartbeat();
    }
    await finalizeInterviewRecord();
    const fileId = resumeFileIdRef.current;
    resumeFileIdRef.current = "";
    if (!fileId) return;
    await deleteResumeFile(fileId).catch((fileError: unknown) => {
      console.error("删除简历文件失败", fileError);
    });
  }, [
    abortPendingChats,
    finalizeInterviewRecord,
    flushHeartbeat,
    setListeningState,
  ]);

  const stopSession = useCallback(() => {
    void cleanup().finally(() => {
      void window.desktop.hideMockInterview();
    });
  }, [cleanup]);

  const askQuestionRef = useRef(askQuestion);
  const cleanupRef = useRef(cleanup);

  useEffect(() => {
    flushHeartbeatRef.current = flushHeartbeat;
  }, [flushHeartbeat]);

  useEffect(() => {
    askQuestionRef.current = askQuestion;
    cleanupRef.current = cleanup;
  }, [askQuestion, cleanup]);

  useEffect(() => {
    const session = ++mockSessionGeneration;
    cleanedRef.current = false;
    const transcription = new SystemAudioTranscription({
      onError: (message) => {
        setError(message);
        setListeningState(false);
      },
      onResult: (text, isFinal) => {
        if (!listeningRef.current || phaseRef.current !== "live") return;
        if (manualInputFocusedRef.current) {
          if (isFinal) lastFinalRef.current = text;
          return;
        }
        if (!isFinal) {
          setInterimText(text);
          return;
        }
        if (lastFinalRef.current === text) {
          setInterimText("");
          return;
        }
        lastFinalRef.current = text;
        const roundId = currentRoundIdRef.current;
        setRounds((current) => {
          if (phaseRef.current !== "live") return current;
          return current.map((round) =>
            round.id === roundId
              ? { ...round, answer: appendTranscript(round.answer, text) }
              : round,
          );
        });
        setInterimText("");
      },
    });
    transcriptionRef.current = transcription;

    let cancelled = false;
    void (async () => {
      try {
        const options = await window.desktop.getMockInterviewOptions();
        if (cancelled) return;
        directionRef.current = options?.interviewDirection?.trim() ?? "";
        resumeFileIdRef.current = options?.resumeFileId?.trim() ?? "";
        await transcription.start("loopback", "microphone", {
          interviewDirection: options?.interviewDirection,
        });
        if (cancelled) return;
        setReady(true);
        heartbeatLastAtRef.current = Date.now();
        recordSaverRef.current.reset();
        recordSessionRef.current = beginInterviewSession(
          "mock",
          options?.interviewDirection,
        );
        await askQuestionRef.current(
          "请开始模拟面试，提出第一个问题。只输出问题本身。",
          true,
        );
      } catch (startError) {
        if (cancelled) return;
        setError(
          startError instanceof Error
            ? startError.message
            : "无法开始模拟面试",
        );
      }
    })();

    return () => {
      cancelled = true;
      transcription.stop();
      abortPendingChats();
      queueMicrotask(() => {
        if (mockSessionGeneration !== session) return;
        void cleanupRef.current();
      });
    };
  }, [abortPendingChats, setInterimText, setListeningState]);

  useEffect(() => {
    if (!ready || phase !== "live") return;
    const timer = window.setInterval(() => {
      void flushHeartbeat();
    }, 30_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [flushHeartbeat, phase, ready]);

  useEffect(() => {
    roundsRef.current = rounds;
  }, [rounds]);

  useEffect(() => {
    if (!ready || phase !== "live") return;
    const session = recordSessionRef.current;
    if (!session) return;
    const durationSeconds = Math.max(
      0,
      Math.round((Date.now() - session.startedAt) / 1000),
    );
    recordSaverRef.current.schedule(
      buildInterviewRecord({
        session,
        durationSeconds,
        endedAt: null,
        items: snapshotRecordItems(rounds),
        overallEvaluation: null,
      }),
    );
  }, [phase, ready, rounds, snapshotRecordItems]);

  const currentRound = rounds[rounds.length - 1];
  const canFinish =
    ready &&
    Boolean(currentRound) &&
    currentRound.questionStatus === "ready" &&
    phase === "live" &&
    listening &&
    Boolean(
      composeAnswer(
        currentRound.answer,
        interimTranscript,
        currentRound.manualAnswer,
        draftAnswer,
      ).trim(),
    );
  const asking = currentRound?.questionStatus === "loading";
  const inputEnabled = ready && listening && !asking && phase === "live";
  const canSend = inputEnabled && Boolean(draftAnswer.trim());
  const spokenAnswer = currentRound
    ? composeAnswer(
        currentRound.answer,
        interimTranscript,
        currentRound.manualAnswer,
      )
    : "";
  const inputPlaceholder = spokenAnswer
    ? "继续输入，将接在已识别内容之后"
    : "输入回答，聚焦时不写入语音";

  useEffect(() => {
    if (inputEnabled || !manualInputFocusedRef.current) return;
    manualInputFocusedRef.current = false;
    setManualInputFocused(false);
  }, [inputEnabled]);

  const updateIsAtBottom = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const distanceToBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    isAtBottomRef.current = distanceToBottom <= SCROLL_THRESHOLD_PX;
  }, []);

  useLayoutEffect(() => {
    if (!isAtBottomRef.current) return;
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [rounds, interimTranscript, draftAnswer]);

  if (phase === "completed") {
    return (
      <div className="flex h-screen flex-col bg-[#f4f4f4] p-4 text-foreground">
        <header className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 rounded-full border border-black/8 bg-white/80 px-3 py-1 shadow-sm">
            <span className="text-xs text-muted">面试评估</span>
          </div>
          <div className="flex-1" />
          <Button
            size="sm"
            className="h-6 text-xs"
            variant="danger-soft"
            onPress={stopSession}
          >
            <Square className="size-3.5" />
            关闭
          </Button>
        </header>
        <Card className="mt-2 flex min-h-0 flex-1 flex-col border border-black/6 bg-white p-0 shadow-sm">
          <Card.Content className="flex min-h-0 flex-1 flex-col p-0">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {error ? (
                <div className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
                  {error}
                </div>
              ) : null}
              <Card
                className="border border-black/6 bg-[#f8f8f8] shadow-none"
                variant="secondary"
              >
                <Card.Header className="gap-1">
                  <Card.Title className="text-sm">面试总评</Card.Title>
                </Card.Header>
                <Card.Content className="border-t border-black/6 pt-3">
                  {overall?.status === "loading" ? (
                    <div className="flex items-center gap-2 text-sm text-muted">
                      <Spinner size="sm" />
                      正在生成面试总评…
                    </div>
                  ) : overall?.status === "error" ? (
                    <div className="flex flex-col items-start gap-3">
                      <p className="text-sm text-red-600">
                        {overall.error ?? "生成总评失败"}
                      </p>
                      {hasEvaluableAnswer(rounds) ? (
                        <Button
                          className="bg-brand text-white hover:bg-brand-hover"
                          onPress={() => void evaluateInterview()}
                        >
                          重试
                        </Button>
                      ) : null}
                    </div>
                  ) : overall?.status === "ready" ? (
                    <div className="flex flex-col gap-2 text-sm leading-7">
                      {overall.score != null ? (
                        <p>
                          <span className="text-muted">评分 </span>
                          <span className="font-medium">
                            {overall.score} / 10
                          </span>
                        </p>
                      ) : null}
                      {overall.summary ? (
                        <p>
                          <span className="text-muted">总评 </span>
                          {overall.summary}
                        </p>
                      ) : null}
                      {overall.advice ? (
                        <p>
                          <span className="text-muted">建议 </span>
                          {overall.advice}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm text-muted">等待总评…</p>
                  )}
                </Card.Content>
              </Card>
              {rounds.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {rounds.map((round, index) => {
                    const answer = composeAnswer(
                      round.answer,
                      round.manualAnswer,
                    ).trim();
                    return (
                      <Card
                        key={round.id}
                        className="border border-black/6 bg-[#f8f8f8] shadow-none"
                        variant="secondary"
                      >
                        <Card.Header className="gap-1">
                          <Card.Title className="text-sm">
                            第 {index + 1} 题 · 面试官
                          </Card.Title>
                          <Card.Description className="text-sm leading-6 text-foreground whitespace-pre-wrap">
                            {round.questionStatus === "error" ? (
                              <span className="text-red-600">
                                {round.questionError ?? "生成问题失败"}
                              </span>
                            ) : (
                              round.question || "（问题未生成）"
                            )}
                          </Card.Description>
                        </Card.Header>
                        <Card.Content className="border-t border-black/6 pt-3">
                          <p className="mb-2 text-xs font-medium text-muted">
                            你的回答
                          </p>
                          {answer ? (
                            <p className="text-sm leading-7 whitespace-pre-wrap">
                              {answer}
                            </p>
                          ) : (
                            <p className="text-sm text-muted">未作答</p>
                          )}
                        </Card.Content>
                      </Card>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </Card.Content>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-[#f4f4f4] p-4 text-foreground">
      <header className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 rounded-full border border-black/8 bg-white/80 px-3 py-1 shadow-sm">
          <span className="text-xs text-muted">模拟面试中</span>
        </div>
        <div className="flex-1" />
        <Button
          size="sm"
          className="h-6 text-xs"
          variant="danger-soft"
          onPress={() => {
            if (!ready) {
              stopSession();
              return;
            }
            void completeInterview();
          }}
        >
          <Square className="size-3.5" />
          结束模拟面试
        </Button>
      </header>

      <Card className="mt-2 flex min-h-0 flex-1 flex-col border border-black/6 bg-white p-0 shadow-sm">
        <Card.Content
          aria-live="polite"
          className="flex min-h-0 flex-1 flex-col p-0"
        >
          <div
            ref={scrollRef}
            onScroll={updateIsAtBottom}
            className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
          >
            {error ? (
              <div className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            ) : null}
            {rounds.length > 0 ? (
              <div className="space-y-3">
                {rounds.map((round, index) => (
                  <RoundCard
                    key={round.id}
                    canFill={canSend}
                    draftText={draftAnswer}
                    inputEnabled={inputEnabled}
                    inputPlaceholder={inputPlaceholder}
                    interimText={interimTranscript}
                    isCurrent={index === rounds.length - 1}
                    listening={listening}
                    manualInputFocused={manualInputFocused}
                    round={round}
                    onDraftBlur={() => setManualInputFocusedState(false)}
                    onDraftChange={setDraftText}
                    onDraftFocus={() => setManualInputFocusedState(true)}
                    onDraftKeyDown={(event) => {
                      if (
                        event.key !== "Enter" ||
                        event.nativeEvent.isComposing ||
                        event.keyCode === 229
                      ) {
                        return;
                      }
                      event.preventDefault();
                      if (!canSend) return;
                      sendDraft();
                    }}
                    onFill={sendDraft}
                  />
                ))}
              </div>
            ) : (
              <div className="grid min-h-36 place-items-center text-center">
                <p className="text-sm text-foreground/60">正在准备面试官…</p>
              </div>
            )}
          </div>
        </Card.Content>
      </Card>

      <div className="mt-3 flex justify-center">
        <Button
          className="min-w-44 bg-brand text-white hover:bg-brand-hover"
          isDisabled={!canFinish || asking}
          onPress={() => void finishAnswer()}
        >
          {asking ? (
            "出题中…"
          ) : (
            <>
              回答完毕，下一题
              <ArrowRight className="size-3.5" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
