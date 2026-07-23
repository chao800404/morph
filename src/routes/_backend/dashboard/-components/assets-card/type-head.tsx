import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface TypeHeadClientProps {
  size: number;
  title: string;
  collapsible?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  controlsId?: string;
}

const TypeHeadClient = ({
  size,
  title,
  collapsible = false,
  isCollapsed = false,
  onToggleCollapse,
  controlsId,
}: TypeHeadClientProps) => {
  const content = (
    <>
      <div className="flex items-center gap-2">
        {collapsible && (
          <ChevronDown
            className={cn(
              "size-4 text-zinc-400 dark:text-zinc-500 transition-transform duration-150 ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none group-hover/head:text-zinc-700 dark:group-hover/head:text-zinc-200",
              isCollapsed && "-rotate-90",
            )}
          />
        )}
        <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 group-hover/head:text-zinc-900 dark:group-hover/head:text-white transition-colors motion-reduce:transition-none">
          {title}
        </h3>
      </div>

      {size > 0 && (
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-primary/10 dark:bg-primary/20 px-2 py-0.5 rounded-full">
          <span className="text-primary font-semibold">{size}</span>
          <span>Selected</span>
        </div>
      )}
    </>
  );

  if (collapsible) {
    return (
      <button
        type="button"
        aria-expanded={!isCollapsed}
        aria-controls={controlsId}
        onClick={onToggleCollapse}
        className="group/head flex h-10 w-full shrink-0 cursor-pointer select-none items-center justify-between border-b border-border/10 bg-transparent px-6 text-left transition-colors hover:bg-zinc-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset motion-reduce:transition-none dark:hover:bg-zinc-800/40"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex h-10 shrink-0 select-none items-center justify-between border-b border-border/10 bg-transparent px-6">
      {content}
    </div>
  );
};

export default TypeHeadClient;
