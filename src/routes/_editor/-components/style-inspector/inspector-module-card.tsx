import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";

type InspectorModuleCardProps = {
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
};

export function InspectorModuleCard({
  title,
  icon,
  expanded,
  onToggle,
  children,
  className,
}: InspectorModuleCardProps) {
  return (
    <section
      className={cn(
        "relative rounded-xl border bg-background shadow-xs focus-within:z-20",
        className,
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={cn(
          "flex w-full items-center justify-between rounded-t-xl px-3 py-2.5 text-xs font-medium text-foreground hover:bg-accent/40",
          !expanded && "rounded-b-xl",
        )}
      >
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <span>{title}</span>
        </span>
        {expanded ? (
          <ChevronUp className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        )}
      </button>
      {expanded ? <div className="border-t px-3 py-3">{children}</div> : null}
    </section>
  );
}
