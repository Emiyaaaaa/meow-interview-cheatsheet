import { ARKASR_WS_URL } from "../../../../shared/api";
import { withAuthQuery } from "../../../../shared/session";
import {
  ASR_MODEL,
  ASR_SAMPLE_RATE,
  type AsrStartOptions,
} from "../../../../shared/asr";
import {
  ASR_CHECK_TIMEOUT_MS,
  FINISH_CLOSE_DELAY_MS,
  concatBytes,
  copyBytes,
  toUint8Array,
  type AsrSession,
  type AsrSessionCallbacks,
} from "./types";

/** 16 kHz / int16 / 200ms — 双向流式最优分包 */
const PCM_CHUNK_BYTES = 6_400;

const PROTOCOL_VERSION = 0b0001;
const HEADER_SIZE = 0b0001;
const MESSAGE_FULL_CLIENT = 0b0001;
const MESSAGE_AUDIO_ONLY = 0b0010;
const MESSAGE_SERVER_FULL = 0b1001;
const MESSAGE_SERVER_ERROR = 0b1111;
const FLAG_NONE = 0b0000;
const FLAG_POS_SEQUENCE = 0b0001;
const FLAG_NEG_WITH_SEQUENCE = 0b0011;
const SERIAL_NONE = 0b0000;
const SERIAL_JSON = 0b0001;
const COMPRESS_GZIP = 0b0001;
const SUCCESS_CODES = new Set([0, 1000, 20_000_000]);

interface AsrUtterance {
  definite?: boolean;
  text?: string;
}

interface AsrPayload {
  code?: number;
  message?: string;
  result?: {
    text?: string;
    utterances?: AsrUtterance[];
  };
}

function viewOf(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function gzipBytes(data: Uint8Array) {
  const stream = new Blob([copyBytes(data)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipBytes(data: Uint8Array) {
  const stream = new Blob([copyBytes(data)])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function encodeFrame(options: {
  flags: number;
  messageType: number;
  payload: Uint8Array;
  sequence?: number;
  serialization: number;
}) {
  const compressed = await gzipBytes(options.payload);
  const withSequence =
    (options.flags & FLAG_POS_SEQUENCE) === FLAG_POS_SEQUENCE;
  const headerBytes = withSequence ? 12 : 8;
  const frame = new Uint8Array(headerBytes + compressed.byteLength);
  const view = viewOf(frame);
  frame[0] = (PROTOCOL_VERSION << 4) | HEADER_SIZE;
  frame[1] = (options.messageType << 4) | options.flags;
  frame[2] = (options.serialization << 4) | COMPRESS_GZIP;
  frame[3] = 0;
  if (withSequence) {
    view.setInt32(4, options.sequence ?? 0, false);
    view.setUint32(8, compressed.byteLength, false);
    frame.set(compressed, 12);
  } else {
    view.setUint32(4, compressed.byteLength, false);
    frame.set(compressed, 8);
  }
  return frame;
}

function buildCorpusContext(options?: AsrStartOptions) {
  const contextData: { text: string }[] = [];
  const direction = options?.interviewDirection?.trim();
  if (direction) {
    contextData.push({ text: `本次面试岗位方向：${direction}` });
  }
  for (const message of options?.historyMessages ?? []) {
    const text = message.trim();
    if (text) contextData.push({ text });
  }
  if (contextData.length === 0) return undefined;
  return JSON.stringify({
    context_data: contextData.slice(-20),
    context_type: "dialog_ctx",
  });
}

function readErrorMessage(payload: AsrPayload | null, fallback: string) {
  return payload?.message || fallback;
}

export class ArkAsrSession implements AsrSession {
  private callbacks: AsrSessionCallbacks;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFinalText = "";
  private pendingPcm = new Uint8Array(0);
  private sendQueue: Promise<void> = Promise.resolve();
  private seq = 1;
  private sessionReady = false;
  private socket: WebSocket | null = null;
  private startOptions: AsrStartOptions | undefined;
  private startReject: ((reason: Error) => void) | null = null;
  private startResolve: (() => void) | null = null;
  private startTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
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
    this.seq = 1;
    this.startOptions = options;
    this.sendQueue = Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;

      const socket = new WebSocket(withAuthQuery(ARKASR_WS_URL));
      socket.binaryType = "arraybuffer";
      this.socket = socket;

      socket.addEventListener("open", () => {
        if (this.socket !== socket) return;
        void this.sendFullClientRequest(socket);
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
        const hadStarted = this.sessionReady;
        this.resetSocket();
        this.callbacks.onClose?.();
        if (stoppedNormally) return;
        if (hadStarted) {
          this.callbacks.onError("语音识别连接已断开");
          return;
        }
        this.rejectStart(new Error("语音识别服务连接失败"));
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
    this.enqueue(() => this.flushAudio(false));
  }

  finish() {
    if (!this.socket) return;

    this.userStopping = true;

    if (this.socket.readyState === WebSocket.OPEN && this.sessionReady) {
      this.sessionReady = false;
      this.enqueue(async () => {
        await this.flushAudio(true);
        this.closeTimer = setTimeout(() => this.close(), FINISH_CLOSE_DELAY_MS);
      });
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

  private enqueue(task: () => Promise<void>) {
    this.sendQueue = this.sendQueue.then(task, task);
  }

  private async sendFullClientRequest(socket: WebSocket) {
    try {
      const corpusContext = buildCorpusContext(this.startOptions);
      const payload = {
        audio: {
          bits: 16,
          channel: 1,
          codec: "raw",
          format: "pcm",
          rate: ASR_SAMPLE_RATE,
        },
        request: {
          enable_ddc: true,
          enable_itn: true,
          enable_nonstream: true,
          enable_punc: true,
          end_window_size: 800,
          model_name: ASR_MODEL,
          result_type: "single",
          show_utterances: true,
          ...(corpusContext ? { corpus: { context: corpusContext } } : {}),
        },
        user: { platform: "Electron", uid: "interview-cheatsheet" },
      };

      const frame = await encodeFrame({
        flags: FLAG_NONE,
        messageType: MESSAGE_FULL_CLIENT,
        payload: new TextEncoder().encode(JSON.stringify(payload)),
        serialization: SERIAL_JSON,
      });
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      socket.send(frame);
    } catch (error) {
      const next =
        error instanceof Error ? error : new Error("无法初始化语音识别会话");
      this.rejectStart(next);
      this.callbacks.onError(next.message);
      this.close();
    }
  }

  private async flushAudio(end: boolean) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    while (this.pendingPcm.byteLength >= PCM_CHUNK_BYTES) {
      const chunk = this.pendingPcm.subarray(0, PCM_CHUNK_BYTES);
      this.pendingPcm = this.pendingPcm.subarray(PCM_CHUNK_BYTES);
      await this.sendAudioChunk(socket, chunk, false);
    }

    if (!end) return;

    const leftover = this.pendingPcm;
    this.pendingPcm = new Uint8Array(0);
    await this.sendAudioChunk(socket, leftover, true);
  }

  private async sendAudioChunk(
    socket: WebSocket,
    chunk: Uint8Array,
    isLast: boolean,
  ) {
    if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;

    const flags = isLast ? FLAG_NEG_WITH_SEQUENCE : FLAG_POS_SEQUENCE;
    const sequence = isLast ? -this.seq : this.seq;
    const frame = await encodeFrame({
      flags,
      messageType: MESSAGE_AUDIO_ONLY,
      payload: chunk,
      sequence,
      serialization: SERIAL_NONE,
    });
    if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
    if (!isLast) this.seq += 1;
    socket.send(frame);
  }

  private async handleMessage(data: unknown) {
    try {
      const bytes = toUint8Array(data);
      if (!bytes || bytes.byteLength < 4) return;

      const parsed = await this.parseResponse(bytes);
      if (!parsed) return;

      if (parsed.error) {
        const error = new Error(parsed.error);
        this.rejectStart(error);
        this.callbacks.onError(error.message);
        this.close();
        return;
      }

      if (!this.sessionReady) {
        this.sessionReady = true;
        this.resolveStart();
      }

      this.emitTranscript(parsed.payload);
    } catch {
      this.callbacks.onError("无法解析语音识别服务返回的数据");
    }
  }

  private async parseResponse(bytes: Uint8Array) {
    const view = viewOf(bytes);
    const headerSize = (bytes[0] & 0x0f) * 4;
    const messageType = bytes[1] >> 4;
    const flags = bytes[1] & 0x0f;
    const serialization = bytes[2] >> 4;
    const compression = bytes[2] & 0x0f;
    let offset = headerSize;
    let sequence: number | undefined;

    if (flags & 0b0001) {
      if (bytes.byteLength < offset + 4) return null;
      sequence = view.getInt32(offset, false);
      offset += 4;
    }
    if (flags & 0b0100) {
      if (bytes.byteLength < offset + 4) return null;
      offset += 4;
    }

    let payload: Uint8Array;
    let errorCode = 0;

    if (messageType === MESSAGE_SERVER_ERROR) {
      if (bytes.byteLength < offset + 8) return null;
      errorCode = view.getInt32(offset, false);
      const errorSize = view.getUint32(offset + 4, false);
      offset += 8;
      payload = bytes.subarray(offset, offset + errorSize);
    } else if (messageType === MESSAGE_SERVER_FULL) {
      if (bytes.byteLength < offset + 4) return null;
      const payloadSize = view.getUint32(offset, false);
      offset += 4;
      payload = bytes.subarray(offset, offset + payloadSize);
    } else {
      payload = bytes.subarray(offset);
    }

    if (compression === COMPRESS_GZIP && payload.byteLength > 0) {
      payload = await gunzipBytes(payload);
    }

    let parsedPayload: AsrPayload | null = null;
    if (serialization === SERIAL_JSON && payload.byteLength > 0) {
      parsedPayload = JSON.parse(
        new TextDecoder().decode(payload),
      ) as AsrPayload;
    } else if (payload.byteLength > 0) {
      parsedPayload = { message: new TextDecoder().decode(payload) };
    }

    const meta = { flags, messageType, sequence };

    if (messageType === MESSAGE_SERVER_ERROR) {
      return {
        error: readErrorMessage(
          parsedPayload,
          `语音识别服务返回错误（${errorCode}）`,
        ),
        meta,
        payload: parsedPayload,
      };
    }

    const payloadCode = parsedPayload?.code;
    if (typeof payloadCode === "number" && !SUCCESS_CODES.has(payloadCode)) {
      return {
        error: readErrorMessage(
          parsedPayload,
          `语音识别服务返回错误（${payloadCode}）`,
        ),
        meta,
        payload: parsedPayload,
      };
    }

    return { error: null, meta, payload: parsedPayload };
  }

  private emitTranscript(payload: AsrPayload | null) {
    const result = payload?.result;
    if (!result) return;

    const utterances = result.utterances ?? [];
    const last = utterances[utterances.length - 1];
    const text = (last?.text ?? result.text ?? "").trim();
    if (!text) return;

    if (last?.definite) {
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
    this.seq = 1;
    this.startResolve = null;
    this.startReject = null;
  }
}
