import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export const PAGE_SIDEBAR_WIDTH = "w-[clamp(20rem,27vw,28rem)]";
export const RESPONSIVE_PAGE_SIDEBAR_WIDTH =
  "w-full xl:w-[clamp(20rem,27vw,28rem)]";

/**
 * The dashboard's two-column split: content on the left, a fixed sidebar on
 * the right.
 *
 * The widths live here rather than in each page. Assets and the category detail
 * page had already drifted apart — `w-md` against `lg:w-80` — which is the kind
 * of difference nobody notices until the two screens sit side by side.
 *
 * Detail pages use one grid column below 1280px so both areas retain a usable reading
 * width. Assets opts out because its viewport-height explorer must keep the
 * Properties panel visible beside it.
 *
 * It sets no height and no cross-axis alignment. Only Assets locks to the
 * viewport, and it does so on its own cards (`h-content` / `min-h-content`) —
 * imposing either here would hand that behaviour to every split page.
 */
export const PageSplitLayout = ({
  children,
  sidebar,
  className,
  sidebarClassName,
  stackBelow1280 = true,
}: {
  children: ReactNode;
  sidebar: ReactNode;
  /** Feature-owned layout only; the split's own metrics stay here. */
  className?: string;
  /** Allows a feature to tune the sidebar responsively without affecting others. */
  sidebarClassName?: string;
  /** Assets keeps its viewport-height explorer and Properties panel side by side. */
  stackBelow1280?: boolean;
}) => (
  <div
    className={cn(
      "grid w-full gap-4",
      stackBelow1280
        ? "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto]"
        : "grid-cols-[minmax(0,1fr)_auto]",
      className,
    )}
  >
    <section className="min-w-0">{children}</section>
    <aside
      className={cn(
        stackBelow1280
          ? RESPONSIVE_PAGE_SIDEBAR_WIDTH
          : PAGE_SIDEBAR_WIDTH,
        "shrink-0",
        sidebarClassName,
      )}
    >
      {sidebar}
    </aside>
  </div>
);
