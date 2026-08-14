import { StorefrontPreview } from "@/components/storefront/storefront-preview";
import { storefrontThemePreviewSearchSchema } from "@/lib/validations/storefront-theme";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
  const viewportHeight = usePreviewViewportHeight(search.viewportHeight);
  useStorefrontPreviewSizeBridge(!query.isPending);
  useStorefrontPreviewSelectionBridge(!query.isPending);

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
      viewportHeight={viewportHeight}
    />
  );
}

function useStorefrontPreviewSelectionBridge(enabled: boolean) {
  useEffect(() => {
    if (!enabled || window.parent === window) return;

    const style = document.createElement("style");
    style.dataset.storefrontEditorSelection = "true";
    style.textContent = `
      [data-storefront-section-id] {
        cursor: default;
      }
      [data-storefront-section-id][data-storefront-editor-selected="true"] {
        outline: 2px solid hsl(217 91% 60%);
        outline-offset: -2px;
      }
    `;
    document.head.appendChild(style);

    const hoverOverlay = document.createElement("div");
    hoverOverlay.setAttribute("aria-hidden", "true");
    Object.assign(hoverOverlay.style, {
      position: "fixed",
      zIndex: "2147483646",
      display: "none",
      pointerEvents: "none",
      border: "2px solid hsl(217 91% 60%)",
      background: "hsl(217 91% 60% / 0.08)",
      boxSizing: "border-box",
    });

    const hoverLabel = document.createElement("span");
    Object.assign(hoverLabel.style, {
      position: "absolute",
      left: "-2px",
      bottom: "100%",
      padding: "4px 7px",
      borderRadius: "5px 5px 0 0",
      background: "hsl(217 91% 60%)",
      color: "white",
      font: "500 11px/1.2 ui-sans-serif, system-ui, sans-serif",
      letterSpacing: "0.01em",
      whiteSpace: "nowrap",
    });
    hoverOverlay.appendChild(hoverLabel);
    document.body.appendChild(hoverOverlay);

    let hoveredSection: HTMLElement | null = null;
    let selectedSection: HTMLElement | null = null;

    const positionHoverOverlay = () => {
      if (!hoveredSection) {
        hoverOverlay.style.display = "none";
        return;
      }
      const bounds = hoveredSection.getBoundingClientRect();
      hoverOverlay.style.display = "block";
      hoverOverlay.style.left = `${bounds.left}px`;
      hoverOverlay.style.top = `${bounds.top}px`;
      hoverOverlay.style.width = `${bounds.width}px`;
      hoverOverlay.style.height = `${bounds.height}px`;
      hoverLabel.textContent =
        hoveredSection.dataset.storefrontSectionType ?? "Section";
    };

    const resolveSection = (target: EventTarget | null) =>
      target instanceof Element
        ? target.closest<HTMLElement>("[data-storefront-section-id]")
        : null;

    const handlePointerMove = (event: PointerEvent) => {
      const nextSection = resolveSection(event.target);
      if (nextSection === hoveredSection) return;
      hoveredSection = nextSection;
      positionHoverOverlay();
    };
    const handlePointerLeave = () => {
      hoveredSection = null;
      positionHoverOverlay();
    };
    const handleClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const section = resolveSection(event.target);
      const sectionId = section?.dataset.storefrontSectionId;
      if (!section || !sectionId) return;

      selectedSection?.removeAttribute("data-storefront-editor-selected");
      selectedSection = section;
      selectedSection.dataset.storefrontEditorSelected = "true";
      window.parent.postMessage(
        { type: "morph:storefront-preview-select-section", sectionId },
        window.location.origin,
      );
    };
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      window.parent.postMessage(
        {
          type: "morph:storefront-preview-wheel",
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          ctrlKey: event.ctrlKey,
          clientX: event.clientX,
          clientY: event.clientY,
        },
        window.location.origin,
      );
    };
    const handleSelectionMessage = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== window.parent ||
        typeof event.data !== "object" ||
        event.data === null ||
        !("type" in event.data) ||
        event.data.type !== "morph:storefront-preview-set-section" ||
        !("sectionId" in event.data) ||
        (typeof event.data.sectionId !== "string" &&
          event.data.sectionId !== null)
      ) {
        return;
      }

      selectedSection?.removeAttribute("data-storefront-editor-selected");
      selectedSection = event.data.sectionId
        ? document.querySelector<HTMLElement>(
            `[data-storefront-section-id="${CSS.escape(event.data.sectionId)}"]`,
          )
        : null;
      selectedSection?.setAttribute("data-storefront-editor-selected", "true");
    };

    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("pointerleave", handlePointerLeave, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: false,
    });
    window.addEventListener("scroll", positionHoverOverlay, true);
    window.addEventListener("resize", positionHoverOverlay);
    window.addEventListener("message", handleSelectionMessage);

    return () => {
      document.removeEventListener("pointermove", handlePointerMove, true);
      document.removeEventListener("pointerleave", handlePointerLeave, true);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("wheel", handleWheel, true);
      window.removeEventListener("scroll", positionHoverOverlay, true);
      window.removeEventListener("resize", positionHoverOverlay);
      window.removeEventListener("message", handleSelectionMessage);
      style.remove();
      hoverOverlay.remove();
      selectedSection?.removeAttribute("data-storefront-editor-selected");
    };
  }, [enabled]);
}

function usePreviewViewportHeight(initialHeight: number) {
  const [viewportHeight, setViewportHeight] = useState(initialHeight);

  useEffect(() => {
    const handleViewportHeight = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== window.parent ||
        typeof event.data !== "object" ||
        event.data === null ||
        !("type" in event.data) ||
        event.data.type !== "morph:storefront-preview-set-viewport-height" ||
        !("height" in event.data) ||
        typeof event.data.height !== "number" ||
        !Number.isFinite(event.data.height) ||
        event.data.height < 320 ||
        event.data.height > 2160
      ) {
        return;
      }

      setViewportHeight(Math.round(event.data.height));
    };

    window.addEventListener("message", handleViewportHeight);
    return () => window.removeEventListener("message", handleViewportHeight);
  }, []);

  return viewportHeight;
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
