import { ASR_PROVIDER, type AsrStartOptions } from "../../../../shared/asr";
import { ArkAsrSession } from "./arkAsr";
import { FunAsrSession } from "./funAsr";
import type { AsrSession, AsrSessionCallbacks } from "./types";

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
  const client = new AsrClient({
    onError: () => undefined,
    onResult: () => undefined,
  });

  try {
    await client.start();
  } finally {
    client.close();
  }
}
