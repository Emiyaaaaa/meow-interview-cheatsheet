import { Tooltip } from "@heroui/react";
import { CircleQuestionMark } from "lucide-react";
import type { ReactNode } from "react";

type HelpTipProps = {
  children: ReactNode;
  title?: string;
  "aria-label"?: string;
};

export function HelpTip({
  children,
  title,
  "aria-label": ariaLabel = "帮助信息",
}: HelpTipProps) {
  return (
    <Tooltip delay={0}>
      <Tooltip.Trigger aria-label={ariaLabel}>
        <CircleQuestionMark className="size-3.5 text-accent-soft-foreground" />
      </Tooltip.Trigger>
      <Tooltip.Content showArrow>
        <Tooltip.Arrow />
        <div className="max-w-xs px-1 py-1.5">
          {title ? <p className="mb-1 font-semibold">{title}</p> : null}
          <p className="text-sm text-muted">{children}</p>
        </div>
      </Tooltip.Content>
    </Tooltip>
  );
}
