import { ASR_PROVIDER, type AsrStartOptions } from "../../../../shared/asr";
import { AI_SERVICE_URL } from "../config";
import { ArkAsrSession } from "./arkAsr";
import { FunAsrSession } from "./funAsr";
import { ASR_CHECK_TIMEOUT_MS, type AsrSession, type AsrSessionCallbacks } from "./types";

export {
  ASR_MODEL,
  ASR_PROVIDER,
  ASR_SAMPLE_RATE,
  FUNASR_MODEL,
} from "../../../../shared/asr";
export type { AsrStartOptions };
export type { AsrSessionCallbacks };

/**
 * WebSocket 会话与识别协议都在渲染进程里。
 * 主进程只在 macOS core-audio 模式下把 PCM 推过来。
 */
export class AsrClient {
  private session: AsrSession;

  constructor(callbacks: AsrSessionCallbacks) {
    this.session =
      ASR_PROVIDER === "ark"
        ? new ArkAsrSession(callbacks)
        : new FunAsrSession(callbacks);
  }

  get isReady() {
    return this.session.isReady;
  }

  get isConnected() {
    return this.session.isConnected;
  }

  start(options?: AsrStartOptions) {
    return this.session.start(options);
  }

  sendAudio(data: ArrayBuffer | Uint8Array) {
    if (data.byteLength === 0) return;
    this.session.sendAudio(
      data instanceof Uint8Array ? data : new Uint8Array(data),
    );
  }

  finish() {
    this.session.finish();
  }

  close() {
    this.session.close();
  }
}

export async function checkAsrConnection() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    ASR_CHECK_TIMEOUT_MS,
  );

  try {
    const response = await fetch(`${AI_SERVICE_URL}/health/asr`, {
      signal: controller.signal,
    });
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        throw new Error("服务返回了无法解析的内容");
      }
    }
    if (!response.ok) {
      throw new Error(readHealthError(data, "语音识别服务检测失败"));
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || /abort/i.test(error.message))
    ) {
      throw new Error("语音识别服务检测超时");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function readHealthError(data: unknown, fallback: string) {
  if (data && typeof data === "object") {
    const record = data as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error;
    }
    if (
      record.error &&
      typeof record.error === "object" &&
      record.error.message?.trim()
    ) {
      return record.error.message;
    }
    if (record.message?.trim()) return record.message;
  }
  return fallback;
}
