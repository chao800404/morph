import { Scan } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type InspectorDisclosureFieldProps = {
  id: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  expandLabel: string;
  collapseLabel: string;
  field: React.ReactNode;
  children: React.ReactNode;
  icon?: ReactNode;
  className?: string;
};

export function InspectorDisclosureField({
  id,
  expanded,
  onExpandedChange,
  expandLabel,
  collapseLabel,
  field,
  children,
  icon,
  className,
}: InspectorDisclosureFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-2">
        {field}
        <button
          type="button"
          onClick={() => onExpandedChange(!expanded)}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            expanded && "bg-accent text-foreground",
          )}
          aria-label={expanded ? collapseLabel : expandLabel}
          aria-expanded={expanded}
          aria-controls={id}
        >
          {icon ?? <Scan className="size-4" />}
        </button>
      </div>
      {expanded ? <div id={id}>{children}</div> : null}
    </div>
  );
}
