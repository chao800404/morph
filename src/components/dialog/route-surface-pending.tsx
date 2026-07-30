import { Spinner } from "@/components/ui/spinner";
import { RouteFullscreenSurface } from "./route-fullscreen-surface";
import { useRouteModalClose } from "./route-form-modal";

/**
 * What a route-backed overlay shows while its chunk loads.
 *
 * These surfaces are `fixed inset-0`, so a fallback that renders in flow leaves
 * the page behind fully visible: opening the product wizard from an option
 * showed the product list first, then the wizard on top of it.
 *
 * Rendering the same surface empty means the frame appears immediately and only
 * its contents arrive late. Closing already works, so an author who opened it
 * by mistake need not wait for the form.
 */
export const RouteSurfacePending = () => {
  const close = useRouteModalClose();

  return (
    <RouteFullscreenSurface onClose={close}>
      <div className="flex size-full items-center justify-center">
        <Spinner className="size-6 text-foreground/70" />
      </div>
    </RouteFullscreenSurface>
  );
};
