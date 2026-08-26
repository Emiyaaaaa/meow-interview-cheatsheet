import { ASR_CONTEXT_HISTORY_COUNT, ASR_WS_URL } from "./config";

export const ASR_SAMPLE_RATE = 16_000;
export const ASR_MODEL = "fun-asr-realtime";

export const DEFAULT_ASR_SYSTEM_PROMPT =
  "你是一个面试官，正在对候选人进行技术面试。请准确识别对话中的语音内容，重点关注技术术语和专业表述。";

export interface AsrContextContent {
  type: "text" | "input_text";
  text: string;
}

export interface AsrContextMessage {
  role: "system" | "user";
  content: AsrContextContent[];
}

export interface AsrStartOptions {
  historyMessages?: string[];
  interviewDirection?: string;
  systemPrompt?: string;
}

export interface AsrClientCallbacks {
  onClose?: () => void;
  onError: (message: string) => void;
  onResult: (text: string, isFinal: boolean) => void;
}

interface AsrMessage {
  header?: {
    event?: string;
    error_message?: string;
  };
  payload?: {
    output?: {
      sentence?: {
        sentence_end?: boolean;
        text?: string;
      };
    };
  };
}

function createTaskId() {
  return crypto.randomUUID().replaceAll("-", "");
}

export function buildAsrSystemPrompt(interviewDirection?: string) {
  const direction = interviewDirection?.trim();
  if (!direction) return DEFAULT_ASR_SYSTEM_PROMPT;
  return `${DEFAULT_ASR_SYSTEM_PROMPT}本次面试岗位方向：${direction}。`;
}

export function buildAsrInputContext(
  systemPrompt: string,
  historyMessages: string[],
  historyCount = ASR_CONTEXT_HISTORY_COUNT,
): AsrContextMessage[] {
  const context: AsrContextMessage[] = [];
  const prompt = systemPrompt.trim();

  if (prompt) {
    context.push({
      role: "system",
      content: [{ type: "text", text: prompt }],
    });
  }

  for (const text of historyMessages.slice(-historyCount)) {
    const trimmed = text.trim();
    if (!trimmed) continue;
    context.push({
      role: "user",
      content: [{ type: "input_text", text: trimmed }],
    });
  }

  return context;
}

export class AsrClient {
  private callbacks: AsrClientCallbacks;
  private closeTimer: number | null = null;
  private historyMessages: string[] = [];
  private restartingTask = false;
  private socket: WebSocket | null = null;
  private startResolve: (() => void) | null = null;
  private startReject: ((reason: Error) => void) | null = null;
  private systemPrompt = DEFAULT_ASR_SYSTEM_PROMPT;
  private taskId = "";
  private taskStarted = false;
  private userStopping = false;

  constructor(callbacks: AsrClientCallbacks) {
    this.callbacks = callbacks;
  }

  get isReady() {
    return this.socket?.readyState === WebSocket.OPEN && this.taskStarted;
  }

  get isConnected() {
    return this.socket !== null;
  }

  start(options?: AsrStartOptions) {
    if (this.socket) return Promise.resolve();

    this.clearCloseTimer();
    this.userStopping = false;
    this.restartingTask = false;
    this.taskStarted = false;
    this.taskId = createTaskId();
    this.systemPrompt =
      options?.systemPrompt ??
      buildAsrSystemPrompt(options?.interviewDirection);
    this.historyMessages = [...(options?.historyMessages ?? [])];

    return new Promise<void>((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;

      const socket = new WebSocket(ASR_WS_URL);
      this.socket = socket;

      socket.addEventListener("open", () => {
        if (this.socket !== socket) return;
        this.sendRunTask(socket);
      });

      socket.addEventListener("message", (event) => {
        if (this.socket !== socket) return;
        void this.handleMessage(event.data);
      });

      socket.addEventListener("error", () => {
        if (this.socket !== socket) return;
        const error = new Error("语音识别服务连接失败");
        this.rejectStart(error);
        this.callbacks.onError(error.message);
      });

      socket.addEventListener("close", () => {
        if (this.socket !== socket) return;
        const stoppedNormally = this.userStopping;
        const hadStarted = this.taskStarted;
        this.resetSocket();
        this.callbacks.onClose?.();
        if (!stoppedNormally && hadStarted) {
          this.callbacks.onError("语音识别连接已断开");
        }
      });
    });
  }

  sendAudio(data: ArrayBuffer) {
    if (this.isReady) {
      this.socket?.send(data);
    }
  }

  finish() {
    if (!this.socket) return;

    this.userStopping = true;
    this.restartingTask = false;

    if (this.socket.readyState === WebSocket.OPEN && this.taskStarted) {
      this.taskStarted = false;
      this.socket.send(
        JSON.stringify({
          header: {
            action: "finish-task",
            task_id: this.taskId,
            streaming: "duplex",
          },
          payload: { input: {} },
        }),
      );
      this.closeTimer = window.setTimeout(() => this.close(), 2_000);
      return;
    }

    this.close();
  }

  close() {
    this.userStopping = true;
    this.clearCloseTimer();
    const socket = this.socket;
    if (!socket) return;
    this.resetSocket();
    this.callbacks.onClose?.();
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close();
    }
  }

  private sendRunTask(socket: WebSocket) {
    const context = buildAsrInputContext(
      this.systemPrompt,
      this.historyMessages,
    );

    socket.send(
      JSON.stringify({
        header: {
          action: "run-task",
          task_id: this.taskId,
          streaming: "duplex",
        },
        payload: {
          task_group: "audio",
          task: "asr",
          function: "recognition",
          model: ASR_MODEL,
          parameters: {
            format: "pcm",
            sample_rate: ASR_SAMPLE_RATE,
            max_sentence_silence: 1000,
          },
          input: context.length > 0 ? { context } : {},
        },
      }),
    );
  }

  private restartTaskWithUpdatedContext(text: string) {
    const trimmed = text.trim();
    if (
      !trimmed ||
      this.userStopping ||
      this.restartingTask ||
      !this.taskStarted ||
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    if (this.historyMessages.at(-1) !== trimmed) {
      this.historyMessages.push(trimmed);
    }

    this.restartingTask = true;
    this.taskStarted = false;
    this.socket.send(
      JSON.stringify({
        header: {
          action: "finish-task",
          task_id: this.taskId,
          streaming: "duplex",
        },
        payload: { input: {} },
      }),
    );
  }

  private async handleMessage(data: unknown) {
    try {
      const raw =
        typeof data === "string"
          ? data
          : data instanceof Blob
            ? await data.text()
            : "";
      const message = JSON.parse(raw) as AsrMessage;
      const event = message.header?.event;

      if (event === "task-started") {
        this.taskStarted = true;
        this.resolveStart();
        return;
      }

      if (event === "result-generated") {
        const sentence = message.payload?.output?.sentence;
        const text = sentence?.text?.trim();
        if (text) {
          const isFinal = sentence?.sentence_end === true;
          this.callbacks.onResult(text, isFinal);
          if (isFinal && !this.userStopping) {
            this.restartTaskWithUpdatedContext(text);
          }
        }
        return;
      }

      if (event === "task-finished") {
        if (this.userStopping) {
          this.close();
          return;
        }
        if (this.restartingTask && this.socket?.readyState === WebSocket.OPEN) {
          this.restartingTask = false;
          this.taskId = createTaskId();
          this.sendRunTask(this.socket);
          return;
        }
        this.close();
        return;
      }

      if (event === "task-failed") {
        const error = new Error(
          message.header?.error_message || "语音识别任务失败",
        );
        this.rejectStart(error);
        this.callbacks.onError(error.message);
        this.close();
      }
    } catch {
      this.callbacks.onError("无法解析语音识别服务返回的数据");
    }
  }

  private resolveStart() {
    this.startResolve?.();
    this.startResolve = null;
    this.startReject = null;
  }

  private rejectStart(error: Error) {
    this.startReject?.(error);
    this.startResolve = null;
    this.startReject = null;
  }

  private clearCloseTimer() {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  private resetSocket() {
    this.clearCloseTimer();
    this.socket = null;
    this.taskStarted = false;
    this.restartingTask = false;
    this.startResolve = null;
    this.startReject = null;
  }
}

const ASR_CHECK_TIMEOUT_MS = 8_000;

export async function checkAsrConnection() {
  const client = new AsrClient({
    onError: () => undefined,
    onResult: () => undefined,
  });

  let timeoutId = 0;
  try {
    await Promise.race([
      client.start(),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error("语音识别服务检测超时"));
        }, ASR_CHECK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    window.clearTimeout(timeoutId);
    client.close();
  }
}
