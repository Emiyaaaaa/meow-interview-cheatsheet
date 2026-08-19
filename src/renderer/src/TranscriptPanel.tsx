import { Card } from "@heroui/react";
import { AudioLines } from "lucide-react";

interface TranscriptPanelProps {
  error: string | null;
  finalLines: string[];
  interimText: string;
  isRunning: boolean;
}

export function TranscriptPanel({
  error,
  finalLines,
  interimText,
  isRunning,
}: TranscriptPanelProps) {
  const hasTranscript = finalLines.length > 0 || interimText.length > 0;

  return (
    <Card className="mt-6 min-h-64 border border-black/6 bg-white p-0 shadow-sm">
      <div className="flex items-center justify-between border-b border-black/6 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-[#f2f2f2]">
            <AudioLines className="size-5" />
          </div>
          <div>
            <Card.Title>实时转写</Card.Title>
            <Card.Description>系统音频将实时转换为文字</Card.Description>
          </div>
        </div>
        <span className="flex items-center gap-2 text-xs text-muted">
          <span
            className={`size-2 rounded-full ${
              isRunning ? "animate-pulse bg-emerald-500" : "bg-zinc-300"
            }`}
          />
          {isRunning ? "正在识别" : "等待开始"}
        </span>
      </div>

      <Card.Content
        aria-live="polite"
        className="max-h-72 min-h-48 overflow-y-auto px-6 py-5"
      >
        {error ? (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        ) : null}

        {hasTranscript ? (
          <div className="space-y-3">
            {finalLines.map((line, index) => (
              <p className="text-sm leading-7 text-foreground" key={`${index}-${line}`}>
                {line}
              </p>
            ))}
            {interimText ? (
              <p className="text-sm leading-7 text-muted">{interimText}</p>
            ) : null}
          </div>
        ) : (
          <div className="grid min-h-36 place-items-center text-center">
            <div>
              <p className="text-sm font-medium">
                {isRunning ? "正在聆听系统音频…" : "暂无转写内容"}
              </p>
              <p className="mt-1 text-xs text-muted">
                开始面试后，会议中的声音会显示在这里
              </p>
            </div>
          </div>
        )}
      </Card.Content>
    </Card>
  );
}
