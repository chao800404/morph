import { StorefrontPreview } from "@/components/storefront/storefront-preview";
import { storefrontThemePreviewSearchSchema } from "@/lib/validations/storefront-theme";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { storefrontThemeQueries } from "../../../../-queries/storefront-theme.queries";

export const Route = createFileRoute(
  "/_editor/store/$storefrontId/themes/$themeId/preview",
)({
  validateSearch: storefrontThemePreviewSearchSchema,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      storefrontThemeQueries.detail(params.storefrontId, params.themeId),
    ),
  pendingComponent: PreviewPending,
  component: StorefrontThemePreviewRoute,
});

function StorefrontThemePreviewRoute() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const query = useQuery(
    storefrontThemeQueries.detail(params.storefrontId, params.themeId),
  );
  useStorefrontPreviewSizeBridge(!query.isPending);

  if (query.isPending || !query.data) return <PreviewPending />;
  if (!query.data.success) {
    return (
      <PreviewMessage
        title="Preview unavailable"
        description={query.data.message}
      />
    );
  }

  return (
    <StorefrontPreview
      context={query.data.data}
      templateId={search.templateId}
      viewportHeight={search.viewportHeight}
    />
  );
}

function useStorefrontPreviewSizeBridge(enabled: boolean) {
  useEffect(() => {
    if (!enabled || window.parent === window) return;

    const previewRoot = document.querySelector<HTMLElement>(
      "[data-storefront-preview-root]",
    );
    if (!previewRoot) return;

    const previousDocumentOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    let animationFrame = 0;
    let candidateHeight: number | null = null;
    let stableFrameCount = 0;
    let lastPublishedHeight: number | null = null;
    let isDisposed = false;

    const measureUntilStable = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        if (isDisposed) return;

        const nextHeight = Math.ceil(
          previewRoot.getBoundingClientRect().height,
        );
        if (
          candidateHeight !== null &&
          Math.abs(candidateHeight - nextHeight) < 1
        ) {
          stableFrameCount += 1;
        } else {
          candidateHeight = nextHeight;
          stableFrameCount = 1;
        }

        if (stableFrameCount < 2) {
          measureUntilStable();
          return;
        }

        if (
          lastPublishedHeight !== null &&
          Math.abs(lastPublishedHeight - nextHeight) < 1
        ) {
          return;
        }

        lastPublishedHeight = nextHeight;
        window.parent.postMessage(
          {
            type: "morph:storefront-preview-size",
            height: nextHeight,
          },
          window.location.origin,
        );
      });
    };

    const observer = new ResizeObserver(() => {
      stableFrameCount = 0;
      measureUntilStable();
    });
    observer.observe(previewRoot);
    const handleSizeRequest = (event: MessageEvent<unknown>) => {
      if (
        event.origin === window.location.origin &&
        event.source === window.parent &&
        typeof event.data === "object" &&
        event.data !== null &&
        "type" in event.data &&
        event.data.type === "morph:storefront-preview-request-size"
      ) {
        stableFrameCount = 0;
        measureUntilStable();
      }
    };
    window.addEventListener("message", handleSizeRequest);
    const beginMeasurement = async () => {
      await document.fonts.ready;
      if (!isDisposed) measureUntilStable();
    };
    void beginMeasurement();

    return () => {
      isDisposed = true;
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener("message", handleSizeRequest);
      document.documentElement.style.overflow = previousDocumentOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [enabled]);
}

function PreviewPending() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-stone-50 p-6 text-neutral-950">
      <p className="text-sm text-neutral-500">Loading storefront preview…</p>
    </main>
  );
}

function PreviewMessage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-stone-50 p-6 text-center text-neutral-950">
      <div className="max-w-sm">
        <h1 className="font-serif text-2xl">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">{description}</p>
      </div>
    </main>
  );
}
