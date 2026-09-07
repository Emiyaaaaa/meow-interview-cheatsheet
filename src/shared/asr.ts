export const ASR_SAMPLE_RATE = 16_000;
export const ASR_MODEL = "bigmodel";
export const FUNASR_MODEL = "fun-asr-realtime";

export type AsrProvider = "ark" | "funasr";

export const ASR_PROVIDER: AsrProvider =
  import.meta.env.VITE_ASR_PROVIDER?.trim() === "ark" ? "ark" : "funasr";

export interface AsrStartOptions {
  historyMessages?: string[];
  interviewDirection?: string;
}
