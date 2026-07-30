import { viewPreloader } from "@/lib/config/lazy-view";
import { useMemo, type ComponentType } from "react";

/**
 * Handlers that start a view's chunk download before the click.
 *
 * Spread onto whatever opens the view. Hover alone would leave keyboard users
 * waiting, so focus counts too, and `touchstart` covers a tap where there is no
 * hover at all.
 */
export const useViewPreload = (view: ComponentType | undefined) =>
  useMemo(() => {
    const preload = viewPreloader(view);
    if (!preload) return {};

    const start = () => void preload();
    return {
      onMouseEnter: start,
      onFocus: start,
      onTouchStart: start,
    };
  }, [view]);
