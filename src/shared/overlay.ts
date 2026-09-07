export type OverlayQaStatus = "loading" | "ready" | "error";

export interface OverlayQaItem {
  answer: string;
  error?: string;
  id: string;
  question: string;
  status: OverlayQaStatus;
}

export interface OverlayInterviewState {
  elapsedSeconds: number;
  interimTranscript: string;
  qaItems: OverlayQaItem[];
  transcriptionError: string | null;
}

export const EMPTY_OVERLAY_STATE: OverlayInterviewState = {
  elapsedSeconds: 0,
  interimTranscript: "",
  qaItems: [],
  transcriptionError: null,
};
