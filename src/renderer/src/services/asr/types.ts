import type { AsrStartOptions } from "../../../../shared/asr";

export type { AsrStartOptions };

export interface AsrSessionCallbacks {
  onClose?: () => void;
  onError: (message: string) => void;
  onResult: (text: string, isFinal: boolean) => void;
}

export interface AsrSession {
  readonly isConnected: boolean;
  readonly isReady: boolean;
  close(): void;
  finish(): void;
  sendAudio(data: Uint8Array): void;
  start(options?: AsrStartOptions): Promise<void>;
}

export const ASR_CHECK_TIMEOUT_MS = 8_000;
export const FINISH_CLOSE_DELAY_MS = 2_000;

export function concatBytes(left: Uint8Array, right: Uint8Array) {
  const next = new Uint8Array(left.byteLength + right.byteLength);
  next.set(left);
  next.set(right, left.byteLength);
  return next;
}

export function copyBytes(data: Uint8Array) {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
}

export function toUint8Array(data: unknown): Uint8Array | null {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}
