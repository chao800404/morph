import type { ReactNode } from "react";
import { RouteFullscreenSurface } from "./route-fullscreen-surface";
import { useRouteModalClose } from "./route-modal-close";

/**
 * What a route-backed overlay shows when its record is not there.
 *
 * The same surface as `RouteSurfacePending` and the form itself, so a page that
 * loads, fails to find its record and reports it never appears to close and
 * reopen — only the contents of one frame change. A bare `fixed inset-0`
 * message is a second overlay, and swapping between the two reads as a flicker.
 */
export const RouteSurfaceMessage = ({ children }: { children: ReactNode }) => {
  const close = useRouteModalClose();

  return (
    <RouteFullscreenSurface onClose={close} label="Notice">
      <div className="flex size-full items-center justify-center px-6 text-center">
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </RouteFullscreenSurface>
  );
};
