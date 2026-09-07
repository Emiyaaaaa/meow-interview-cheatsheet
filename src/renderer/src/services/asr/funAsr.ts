import { FUNASR_WS_URL } from "../../../../shared/api";
import { withAuthQuery } from "../../../../shared/session";
import { ASR_SAMPLE_RATE, FUNASR_MODEL, type AsrStartOptions } from "../../../../shared/asr";
import {
  ASR_CHECK_TIMEOUT_MS,
  FINISH_CLOSE_DELAY_MS,
  concatBytes,
  type AsrSession,
  type AsrSessionCallbacks,
} from "./types";

/** 16 kHz / int16 / 100ms — DashScope 建议分包间隔 */
const PCM_CHUNK_BYTES = 3_200;

interface DashScopeSentence {
  heartbeat?: boolean;
  sentence_end?: boolean;
  text?: string;
}

interface DashScopeEvent {
  code?: string;
  error?: string | { code?: string; message?: string };
  error_code?: string;
  error_message?: string;
  header?: {
    error_code?: string;
    error_message?: string;
    event?: string;
    task_id?: string;
  };
  message?: string;
  payload?: {
    output?: {
      sentence?: DashScopeSentence;
      text?: string;
    };
  };
}

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function formatDashScopeError(message: DashScopeEvent, raw: string) {
  const header = message.header;
  const nested =
    message.error && typeof message.error === "object" ? message.error : null;
  const text = firstNonEmpty(
    header?.error_message,
    message.error_message,
    message.message,
    nested?.message,
    typeof message.error === "string" ? message.error : undefined,
  );
  const code = firstNonEmpty(
    header?.error_code,
    message.error_code,
    message.code,
    nested?.code,
  );
  if (code && text) return `${code}: ${text}`;
  return text || code || raw || "语音识别任务失败";
}

function isDashScopeError(message: DashScopeEvent, event: string | undefined) {
  if (event === "task-failed" || event === "error") return true;
  if (
    event === "task-started" ||
    event === "result-generated" ||
    event === "task-finished"
  ) {
    return false;
  }
  return Boolean(
    firstNonEmpty(
      message.header?.error_code,
      message.header?.error_message,
      message.error_code,
      message.error_message,
      typeof message.error === "string" ? message.error : undefined,
      message.error && typeof message.error === "object"
        ? message.error.message
        : undefined,
      message.code && message.message ? message.message : undefined,
    ),
  );
}

function createTaskId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 32);
}

function buildRunTaskPayload(taskId: string, options?: AsrStartOptions) {
  const parameters: Record<string, unknown> = {
    format: "pcm",
    sample_rate: ASR_SAMPLE_RATE,
  };

  const direction = options?.interviewDirection?.trim();
  if (direction) {
    parameters.language_hints = ["zh"];
  }

  return {
    header: {
      action: "run-task",
      streaming: "duplex",
      task_id: taskId,
    },
    payload: {
      function: "recognition",
      input: {},
      model: FUNASR_MODEL,
      parameters,
      task: "asr",
      task_group: "audio",
    },
  };
}

function buildFinishTaskPayload(taskId: string) {
  return {
    header: {
      action: "finish-task",
      streaming: "duplex",
      task_id: taskId,
    },
    payload: {
      input: {},
    },
  };
}

export class FunAsrSession implements AsrSession {
  private callbacks: AsrSessionCallbacks;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFinalText = "";
  private pendingPcm = new Uint8Array(0);
  private sessionReady = false;
  private socket: WebSocket | null = null;
  private startReject: ((reason: Error) => void) | null = null;
  private startResolve: (() => void) | null = null;
  private startTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private taskId = "";
  private userStopping = false;

  constructor(callbacks: AsrSessionCallbacks) {
    this.callbacks = callbacks;
  }

  get isReady() {
    return this.socket?.readyState === WebSocket.OPEN && this.sessionReady;
  }

  get isConnected() {
    return this.socket !== null;
  }

  start(options?: AsrStartOptions) {
    if (this.socket) return Promise.resolve();

    this.clearCloseTimer();
    this.clearStartTimeout();
    this.userStopping = false;
    this.sessionReady = false;
    this.lastFinalText = "";
    this.pendingPcm = new Uint8Array(0);
    this.taskId = createTaskId();

    return new Promise<void>((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;

      const socket = new WebSocket(withAuthQuery(FUNASR_WS_URL));
      socket.binaryType = "arraybuffer";
      this.socket = socket;

      socket.addEventListener("open", () => {
        if (this.socket !== socket) return;
        socket.send(JSON.stringify(buildRunTaskPayload(this.taskId, options)));
      });

      socket.addEventListener("message", (event) => {
        if (this.socket !== socket) return;
        this.handleMessage(event.data);
      });

      socket.addEventListener("error", () => {
        if (this.socket !== socket) return;
        const error = new Error("语音识别服务连接失败");
        this.rejectStart(error);
        this.callbacks.onError(error.message);
      });

      socket.addEventListener("close", (event) => {
        if (this.socket !== socket) return;
        const stoppedNormally = this.userStopping;
        const hadStarted = this.sessionReady;
        const reason = event.reason.trim();
        this.resetSocket();
        this.callbacks.onClose?.();
        if (stoppedNormally) return;
        const message =
          reason ||
          (hadStarted ? "语音识别连接已断开" : "语音识别服务连接失败");
        if (!hadStarted) this.rejectStart(new Error(message));
        this.callbacks.onError(message);
      });

      this.startTimeoutTimer = setTimeout(() => {
        if (this.socket !== socket || this.sessionReady) return;
        const error = new Error("语音识别服务连接超时");
        this.rejectStart(error);
        this.callbacks.onError(error.message);
        this.close();
      }, ASR_CHECK_TIMEOUT_MS);
    });
  }

  sendAudio(data: Uint8Array) {
    if (!this.isReady || data.byteLength === 0) return;
    this.pendingPcm = concatBytes(this.pendingPcm, data);
    this.flushAudio();
  }

  finish() {
    if (!this.socket) return;

    this.userStopping = true;

    if (this.socket.readyState === WebSocket.OPEN && this.sessionReady) {
      this.sessionReady = false;
      this.flushAudio();
      this.socket.send(JSON.stringify(buildFinishTaskPayload(this.taskId)));
      this.closeTimer = setTimeout(() => this.close(), FINISH_CLOSE_DELAY_MS);
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

  private flushAudio() {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.sessionReady) {
      return;
    }

    while (this.pendingPcm.byteLength >= PCM_CHUNK_BYTES) {
      const chunk = this.pendingPcm.subarray(0, PCM_CHUNK_BYTES);
      this.pendingPcm = this.pendingPcm.subarray(PCM_CHUNK_BYTES);
      socket.send(chunk);
    }

    if (this.pendingPcm.byteLength > 0 && !this.userStopping) return;

    if (this.pendingPcm.byteLength > 0) {
      socket.send(this.pendingPcm);
      this.pendingPcm = new Uint8Array(0);
    }
  }

  private handleMessage(data: unknown) {
    if (typeof data !== "string") return;

    let message: DashScopeEvent;
    try {
      message = JSON.parse(data) as DashScopeEvent;
    } catch {
      this.fail(data);
      return;
    }

    const event = message.header?.event;
    if (isDashScopeError(message, event)) {
      this.fail(formatDashScopeError(message, data));
      return;
    }
    if (!event) return;

    switch (event) {
      case "task-started":
        this.sessionReady = true;
        this.resolveStart();
        this.flushAudio();
        return;
      case "result-generated":
        this.emitTranscript(message);
        return;
      case "task-finished":
        this.userStopping = true;
    }
  }

  private fail(message: string) {
    const error = new Error(message);
    this.rejectStart(error);
    this.callbacks.onError(error.message);
    this.close();
  }

  private emitTranscript(message: DashScopeEvent) {
    const sentence = message.payload?.output?.sentence;
    if (sentence?.heartbeat) return;

    const text = firstNonEmpty(sentence?.text, message.payload?.output?.text);
    if (!text) return;

    if (sentence?.sentence_end) {
      if (text === this.lastFinalText) return;
      this.lastFinalText = text;
      this.callbacks.onResult(text, true);
      return;
    }

    this.callbacks.onResult(text, false);
  }

  private resolveStart() {
    this.clearStartTimeout();
    this.startResolve?.();
    this.startResolve = null;
    this.startReject = null;
  }

  private rejectStart(error: Error) {
    this.clearStartTimeout();
    this.startReject?.(error);
    this.startResolve = null;
    this.startReject = null;
  }

  private clearCloseTimer() {
    if (this.closeTimer !== null) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  private clearStartTimeout() {
    if (this.startTimeoutTimer !== null) {
      clearTimeout(this.startTimeoutTimer);
      this.startTimeoutTimer = null;
    }
  }

  private resetSocket() {
    this.clearCloseTimer();
    this.clearStartTimeout();
    this.socket = null;
    this.sessionReady = false;
    this.lastFinalText = "";
    this.pendingPcm = new Uint8Array(0);
    this.taskId = "";
    this.startResolve = null;
    this.startReject = null;
  }
}
