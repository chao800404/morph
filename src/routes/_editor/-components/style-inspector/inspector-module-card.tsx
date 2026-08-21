import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import { createContext, useContext } from "react";

const InspectorModuleSectionContext = createContext(false);

type InspectorModuleCardProps = {
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  groupChildren?: boolean;
};

export function InspectorModuleCard({
  title,
  icon,
  expanded,
  onToggle,
  children,
  className,
  contentClassName,
  groupChildren = false,
}: InspectorModuleCardProps) {
  const isNestedSection = useContext(InspectorModuleSectionContext);
  const content = groupChildren ? (
    <InspectorModuleSectionContext.Provider value>
      {children}
    </InspectorModuleSectionContext.Provider>
  ) : (
    children
  );

  return (
    <section
      {...(isNestedSection
        ? { "data-inspector-section": title }
        : { "data-inspector-module": title })}
      className={cn(
        isNestedSection
          ? "relative border-b bg-transparent last:border-b-0 focus-within:z-20"
          : "relative rounded-xl border bg-background shadow-xs focus-within:z-20",
        className,
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={cn(
          "flex w-full items-center justify-between px-3 py-2.5 text-xs font-medium text-foreground hover:bg-accent/40",
          !isNestedSection && "rounded-t-xl",
          !isNestedSection && !expanded && "rounded-b-xl",
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
      {expanded ? (
        <div
          className={cn(
            isNestedSection ? "px-3 pb-3 pt-2" : "border-t px-3 py-3",
            contentClassName,
          )}
        >
          {content}
        </div>
      ) : null}
    </section>
  );
}
