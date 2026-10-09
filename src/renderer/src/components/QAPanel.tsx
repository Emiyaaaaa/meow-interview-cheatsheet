import { Card, cn, Spinner } from "@heroui/react";
import { useCallback, useLayoutEffect, useRef } from "react";
import type { InterviewQaItem } from "../context/InterviewContext";

const SCROLL_THRESHOLD_PX = 48;

interface TranscriptPanelProps {
  className?: string;
  dense?: boolean;
  error: string | null;
  interimText: string;
  qaItems: InterviewQaItem[];
}

function QaCard({ dense, item }: { dense?: boolean; item: InterviewQaItem }) {
  return (
    <Card
      className={cn(
        "border border-black/6 bg-[#f8f8f8] shadow-none",
        dense ? "gap-1 p-2" : undefined,
      )}
      variant="secondary"
    >
      <Card.Header className={dense ? "gap-0.5" : "gap-1"}>
        <Card.Description
          className={cn(
            "text-foreground",
            dense ? "text-[13px] leading-5" : "text-sm leading-6",
          )}
        >
          {item.question}
        </Card.Description>
      </Card.Header>
      <Card.Content
        className={cn(
          "border-t border-black/6",
          dense ? "gap-1 pt-1.5" : "pt-3",
        )}
      >
        <p
          className={cn(
            "text-xs font-medium text-muted",
            dense ? "mb-0.5" : "mb-2",
          )}
        >
          AI 回答
        </p>
        {item.status === "error" ? (
          <p className="text-sm text-red-600">{item.error ?? "获取回答失败"}</p>
        ) : item.status === "loading" && !item.answer ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner size="sm" />
            正在生成回答…
          </div>
        ) : (
          <div>
            <p
              className={cn(
                "whitespace-pre-wrap text-foreground",
                dense ? "text-[13px] leading-5" : "text-sm leading-7",
              )}
            >
              {item.answer}
            </p>
            {item.status === "loading" ? (
              <Spinner size="sm" className="mt-1" />
            ) : null}
          </div>
        )}
      </Card.Content>
    </Card>
  );
}

export function QAPanel({
  className,
  dense,
  error,
  interimText,
  qaItems,
}: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const hasContent = qaItems.length > 0 || interimText.length > 0;

  const updateIsAtBottom = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const distanceToBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    isAtBottomRef.current = distanceToBottom <= SCROLL_THRESHOLD_PX;
  }, []);

  useLayoutEffect(() => {
    if (!isAtBottomRef.current) return;
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [qaItems, interimText]);

  return (
    <Card
      className={cn(
        "mt-2 flex min-h-0 flex-1 flex-col border border-black/6 bg-white p-0 shadow-sm",
        className,
      )}
    >
      <Card.Content
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col p-0"
      >
        <div
          ref={scrollRef}
          onScroll={updateIsAtBottom}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            dense ? "px-2 py-1.5" : "px-6 py-5",
          )}
        >
          {error ? (
            <div
              className={cn(
                "rounded-lg bg-red-50 text-sm text-red-600",
                dense ? "px-2.5 py-1.5" : "rounded-xl px-4 py-3",
              )}
            >
              {error}
            </div>
          ) : null}

          {hasContent ? (
            <div className={dense ? "space-y-1.5" : "space-y-3"}>
              {qaItems.map((item) => (
                <QaCard dense={dense} item={item} key={item.id} />
              ))}
              {interimText ? (
                <Card
                  className={cn(
                    "border border-dashed border-black/10 bg-white shadow-none",
                    dense ? "gap-1 p-2" : undefined,
                  )}
                >
                  <Card.Header className={dense ? "gap-0.5" : undefined}>
                    <Card.Title className="flex items-center gap-1.5 text-xs text-muted">
                      <span className="size-1.5 animate-pulse rounded-full bg-brand" />
                      正在识别
                    </Card.Title>
                    <Card.Description
                      className={
                        dense ? "text-[13px] leading-5" : "text-sm leading-6"
                      }
                    >
                      {interimText}
                    </Card.Description>
                  </Card.Header>
                </Card>
              ) : null}
            </div>
          ) : (
            <div
              className={cn(
                "grid place-items-center text-center",
                dense ? "min-h-20" : "min-h-36",
              )}
            >
              <div>
                <p className="text-sm text-foreground/60">正在聆听…</p>
              </div>
            </div>
          )}
        </div>
      </Card.Content>
    </Card>
  );
}
