import { Button } from "@heroui/react";
import { Square } from "lucide-react";
import { useInterview } from "../context/InterviewContext";
import { TranscriptPanel } from "../TranscriptPanel";

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
    finalTranscripts,
    interimTranscript,
    stopInterview,
    transcriptionError,
  } = useInterview();

  return (
    <div className="flex h-screen flex-col bg-[#f4f4f4] px-10 py-8 text-foreground">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="mb-2 text-sm font-medium text-muted">面试进行中</p>
          <h2 className="text-3xl font-semibold tracking-tight">实时转写</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 rounded-full border border-black/8 bg-white px-4 py-2 shadow-sm">
            <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
            <span className="text-sm font-medium">计时中</span>
            <span className="font-mono text-sm text-muted">
              {formatDuration(elapsedSeconds)}
            </span>
          </div>
          <Button variant="secondary" onPress={stopInterview}>
            <Square className="size-4" />
            结束面试
          </Button>
        </div>
      </header>

      <TranscriptPanel
        error={transcriptionError}
        finalLines={finalTranscripts}
        interimText={interimTranscript}
        isRunning
        layout="page"
      />
    </div>
  );
}
