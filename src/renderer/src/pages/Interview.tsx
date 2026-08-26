import { Button } from "@heroui/react";
import { Square } from "lucide-react";
import { useInterview } from "../context/InterviewContext";
import { QAPanel } from "../QAPanel";

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
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
    <div className="flex h-screen flex-col bg-[#f4f4f4] p-4 text-foreground">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2 rounded-full border border-black/8 bg-white px-3 py-1 shadow-sm">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
          <span className="font-mono text-xs text-muted">
            {formatDuration(elapsedSeconds)}
          </span>
        </div>
        <div className="flex-1"></div>
        <Button
          size="sm"
          className={"h-6 text-xs"}
          variant="danger-soft"
          onPress={stopInterview}
        >
          <Square className="size-3.5" />
          结束面试
        </Button>
      </header>

      <QAPanel
        error={transcriptionError}
        interimText={interimTranscript}
        qaItems={qaItems}
      />
    </div>
  );
}
