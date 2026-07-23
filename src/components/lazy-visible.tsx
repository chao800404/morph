import { useEffect, useRef, useState, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Renders its children only once the wrapper scrolls near the viewport.
 *
 * Used for media-heavy grids (asset thumbnails): mounting every <video>/<img>
 * at once — e.g. while a dialog slides open — floods the main thread with
 * decode work and janks the animation. With this, only the visible items load;
 * the rest mount as they scroll into view. The wrapper keeps its box so layout
 * stays stable and the observer can measure it.
 */
export const LazyVisible = ({
  children,
  className,
  rootMargin = "300px",
  placeholder,
  enabled = true,
}: {
  children: ReactNode;
  className?: string;
  rootMargin?: string;
  placeholder?: ReactNode;
  /**
   * Gate observation until it's safe to load (e.g. after an open animation).
   * While false, only the placeholder renders and nothing is observed.
   */
  enabled?: boolean;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled || visible) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, visible, rootMargin]);

  return (
    <div ref={ref} className={className}>
      {enabled && visible
        ? children
        : (placeholder ?? <Skeleton className="size-full rounded-md" />)}
    </div>
  );
};
