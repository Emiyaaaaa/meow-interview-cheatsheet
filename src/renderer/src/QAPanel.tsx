import { Card, Spinner } from "@heroui/react";
import type { InterviewQaItem } from "./context/InterviewContext";

interface TranscriptPanelProps {
  error: string | null;
  interimText: string;
  qaItems: InterviewQaItem[];
}

function QaCard({ item }: { item: InterviewQaItem }) {
  return (
    <Card
      className="border border-black/6 bg-[#f8f8f8] shadow-none"
      variant="secondary"
    >
      <Card.Header className="gap-1">
        <Card.Title className="text-sm">面试官</Card.Title>
        <Card.Description className="text-sm leading-6 text-foreground">
          {item.question}
        </Card.Description>
      </Card.Header>
      <Card.Content className="border-t border-black/6 pt-3">
        <p className="mb-2 text-xs font-medium text-muted">AI 回答</p>
        {item.status === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner size="sm" />
            正在生成回答…
          </div>
        ) : item.status === "error" ? (
          <p className="text-sm text-red-600">{item.error ?? "获取回答失败"}</p>
        ) : (
          <p className="text-sm leading-7 text-foreground whitespace-pre-wrap">
            {item.answer}
          </p>
        )}
      </Card.Content>
    </Card>
  );
}

export function QAPanel({ error, interimText, qaItems }: TranscriptPanelProps) {
  const hasContent = qaItems.length > 0 || interimText.length > 0;

  return (
    <Card
      className={`border border-black/6 bg-white p-0 shadow-sm mt-6 min-h-64`}
    >
      <div className="flex items-center justify-between border-b border-black/6 px-6 py-4">
        <span className="flex items-center gap-2 text-xs text-muted">
          <span className="size-2 rounded-full animate-pulse bg-emerald-500" />
          正在识别
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

        {hasContent ? (
          <div className="space-y-3">
            {qaItems.map((item) => (
              <QaCard item={item} key={item.id} />
            ))}
            {interimText ? (
              <Card className="border border-dashed border-black/10 bg-white shadow-none">
                <Card.Header>
                  <Card.Title className="text-sm text-muted">
                    正在识别
                  </Card.Title>
                  <Card.Description className="text-sm leading-6">
                    {interimText}
                  </Card.Description>
                </Card.Header>
              </Card>
            ) : null}
          </div>
        ) : (
          <div className="grid place-items-center text-center min-h-36">
            <div>
              <p className="text-sm text-foreground/60">正在聆听…</p>
            </div>
          </div>
        )}
      </Card.Content>
    </Card>
  );
}
