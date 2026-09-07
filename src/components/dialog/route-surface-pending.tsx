import { DialogFooterActions } from "./dialog-footer-actions";
import { Skeleton } from "@/components/ui/skeleton";
import { RouteFullscreenSurface } from "./route-fullscreen-surface";
import { useCloseOnEscape, useRouteModalClose } from "./route-modal-close";

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
const RouteSurfacePendingFrame = ({ fieldCount }: { fieldCount: number }) => {
  const close = useRouteModalClose();
  useCloseOnEscape(close);

  return (
    <RouteFullscreenSurface
      onClose={close}
      label="Loading"
      bodyClassName="overflow-y-auto"
      footer={
        <DialogFooterActions
          isSheet={false}
          isDisabled
          onCancel={close}
          onSubmit={() => undefined}
        />
      }
    >
      <div
        className="mx-auto flex w-full max-w-2xl flex-col px-6 py-16"
        aria-label="Loading form"
        aria-busy="true"
      >
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-2 h-4 w-64 max-w-full" />
        <div className="mt-8 grid grid-cols-1 gap-8">
          {Array.from({ length: fieldCount }, (_, index) => (
            <div className="space-y-2" key={index}>
              <Skeleton className={index % 2 ? "h-4 w-24" : "h-4 w-16"} />
              <Skeleton
                className={index === 1 ? "h-20 w-full" : "h-9 w-full"}
              />
            </div>
          ))}
        </div>
      </div>
    </RouteFullscreenSurface>
  );
};

export const RouteSurfacePending = () => (
  <RouteSurfacePendingFrame fieldCount={4} />
);

/** Creates a named page fallback with the same field count as its real form. */
export const createRouteSurfacePendingView = (fieldCount: number) => {
  const PendingView = () => (
    <RouteSurfacePendingFrame fieldCount={fieldCount} />
  );
  return PendingView;
};
