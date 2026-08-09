import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export const EDITOR_SIDEBAR_WIDTH = "w-[clamp(20rem,28vw,36rem)]";

interface SplitEditorLayoutProps {
  main: ReactNode;
  sidebar: ReactNode;
  className?: string;
  mainClassName?: string;
  sidebarClassName?: string;
  stackOnNarrow?: boolean;
}

/**
 * Shared editor split: a flexible preview/work area and a fluid control panel.
 * The sidebar width is bounded for both 13-inch laptops and wide displays.
 */
export const SplitEditorLayout = ({
  main,
  sidebar,
  className,
  mainClassName,
  sidebarClassName,
  stackOnNarrow = true,
}: SplitEditorLayoutProps) => (
  <div
    className={cn(
      "flex h-full min-h-0 flex-1",
      stackOnNarrow && "max-lg:flex-col",
      className,
    )}
  >
    <section
      className={cn(
        "min-w-0 flex-1 overflow-hidden border-r bg-accent/40",
        stackOnNarrow && "max-lg:border-b max-lg:border-r-0",
        mainClassName,
      )}
    >
      {main}
    </section>
    <aside
      className={cn(
        EDITOR_SIDEBAR_WIDTH,
        "min-h-0 shrink-0 overflow-y-auto overscroll-contain",
        stackOnNarrow && "max-lg:w-full",
        sidebarClassName,
      )}
    >
      {sidebar}
    </aside>
  </div>
);
