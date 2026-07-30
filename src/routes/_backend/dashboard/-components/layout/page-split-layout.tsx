import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * The dashboard's two-column split: content on the left, a fixed sidebar on
 * the right.
 *
 * The widths live here rather than in each page. Assets and the category detail
 * page had already drifted apart — `w-md` against `lg:w-80` — which is the kind
 * of difference nobody notices until the two screens sit side by side.
 *
 * Always a row, matching Assets. Stacking on narrow screens would push the
 * sidebar a full viewport below the explorer, whose card is `h-content`.
 *
 * It sets no height and no cross-axis alignment. Only Assets locks to the
 * viewport, and it does so on its own cards (`h-content` / `min-h-content`) —
 * imposing either here would hand that behaviour to every split page.
 */
export const PageSplitLayout = ({
  children,
  sidebar,
  className,
}: {
  children: ReactNode;
  sidebar: ReactNode;
  /** Feature-owned layout only; the split's own metrics stay here. */
  className?: string;
}) => (
  <div className={cn("flex w-full gap-4", className)}>
    <section className="min-w-0 flex-1">{children}</section>
    <aside className="w-md shrink-0">{sidebar}</aside>
  </div>
);
