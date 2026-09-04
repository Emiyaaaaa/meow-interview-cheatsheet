import { Button } from "@heroui/react";
import { Square } from "lucide-react";
import { useEffect, useState } from "react";
import { EMPTY_OVERLAY_STATE } from "../../../shared/overlay";
import { QAPanel } from "../components/QAPanel";
import { useInterview } from "../context/InterviewContext";

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function InterviewChrome({
  elapsedSeconds,
  error,
  interimText,
  onStop,
  overlay,
  qaItems,
}: {
  elapsedSeconds: number;
  error: string | null;
  interimText: string;
  onStop: () => void;
  overlay?: boolean;
  qaItems: OverlayQaItem[];
}) {
  return (
    <div
      className={
        overlay
          ? "flex h-screen flex-col p-2 text-foreground"
          : "flex h-screen flex-col bg-[#f4f4f4] p-4 text-foreground"
      }
    >
      <div
        className={
          overlay
            ? "flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/50 bg-white/55 shadow-lg backdrop-blur-2xl"
            : "flex min-h-0 flex-1 flex-col"
        }
      >
        <header
          className={
            overlay
              ? "app-drag mb-0 flex items-center justify-between px-3 py-2"
              : "mb-2 flex items-center justify-between"
          }
        >
          <div className="flex items-center gap-2 rounded-full border border-black/8 bg-white/80 px-3 py-1 shadow-sm">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            <span className="font-mono text-xs text-muted">
              {formatDuration(elapsedSeconds)}
            </span>
          </div>
          <div className="flex-1" />
          <Button
            size="sm"
            className="app-no-drag h-6 text-xs"
            variant="danger-soft"
            onPress={onStop}
          >
            <Square className="size-3.5" />
            结束面试
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col px-2 pb-2">
          <QAPanel
            className={
              overlay
                ? "mt-0 border-white/40 bg-white/40 shadow-none"
                : undefined
            }
            error={error}
            interimText={interimText}
            qaItems={qaItems}
          />
        </div>
      </div>
    </div>
  );
}

export function InterviewPage() {
  const {
    elapsedSeconds,
    interimTranscript,
    qaItems,
    stopInterview,
    transcriptionError,
  } = useInterview();

  return (
    <InterviewChrome
      elapsedSeconds={elapsedSeconds}
      error={transcriptionError}
      interimText={interimTranscript}
      onStop={stopInterview}
      qaItems={qaItems}
    />
  );
}

export function OverlayInterviewPage() {
  const [state, setState] = useState(EMPTY_OVERLAY_STATE);

  useEffect(() => {
    let active = true;
    void window.desktop.getOverlayState().then((next) => {
      if (active && next) setState(next);
    });
    const unsubscribe = window.desktop.onOverlayState(setState);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return (
    <InterviewChrome
      elapsedSeconds={state.elapsedSeconds}
      error={state.transcriptionError}
      interimText={state.interimTranscript}
      overlay
      onStop={() => {
        void window.desktop.requestStopInterview();
      }}
      qaItems={state.qaItems}
    />
  );
}
