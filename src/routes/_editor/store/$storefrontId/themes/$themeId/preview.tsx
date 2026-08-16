import { StorefrontPreview } from "@/components/storefront/storefront-preview";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { storefrontThemePreviewSearchSchema } from "@/lib/validations/storefront-theme";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { storefrontThemeQueries } from "../../../../-queries/storefront-theme.queries";

import { storefrontThemeFileQueries } from "../../../../-queries/storefront-theme-files.queries";

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
    <ReadyStorefrontPreview
      context={query.data.data}
      templateId={search.templateId}
      viewportHeight={viewportHeight}
    />
  );
}

function ReadyStorefrontPreview({
  context,
  templateId,
  viewportHeight,
}: {
  context: Parameters<typeof StorefrontPreview>[0]["context"];
  templateId: string;
  viewportHeight: number;
}) {
  const template = context.templates.find(
    (candidate) => candidate.id === templateId,
  );
  const previewDocument = usePreviewDocument(template?.document);
  const previewThemeFiles = usePreviewThemeFiles(
    context.storefront.id,
    context.theme.id,
  );

  // Dynamic Tailwind JIT & arbitrary CSS rule compiler for theme source files
  useTailwindPreviewRuntime(previewThemeFiles);

  return (
    <StorefrontPreview
      context={context}
      templateId={templateId}
      viewportHeight={viewportHeight}
      document={previewDocument}
      themeFiles={previewThemeFiles}
    />
  );
}

function useTailwindPreviewRuntime(
  themeFiles: Array<{ path: string; content: string }>,
) {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    // 1. Inject Tailwind Play CDN script into iframe head for full dynamic utility coverage
    let script = document.getElementById(
      "morph-tailwind-cdn",
    ) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = "morph-tailwind-cdn";
      script.src = "https://cdn.tailwindcss.com";
      script.async = true;
      document.head.appendChild(script);
    }

    // 2. High-speed 0ms fallback arbitrary utility generator for immediate visual response
    let styleTag = document.getElementById(
      "morph-theme-arbitrary-styles",
    ) as HTMLStyleElement | null;
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = "morph-theme-arbitrary-styles";
      document.head.appendChild(styleTag);
    }

    const cssRules: string[] = [];
    for (const file of themeFiles) {
      // Find arbitrary utility classes e.g. text-[100px], text-[clamp(...)], min-h-[42rem], bg-[#ff0055]
      const matches = file.content.matchAll(/([a-zA-Z0-9_-]+)-\[([^\]]+)\]/g);
      for (const match of matches) {
        const [fullMatch, prefix, value] = match;
        const escapedSelector =
          "." +
          fullMatch.replace(
            /([\[\]\#\(\)\,\.\%\:\/])/g,
            "\\$1",
          );
        if (prefix === "text") {
          cssRules.push(`${escapedSelector} { font-size: ${value}; }`);
        } else if (prefix === "bg") {
          cssRules.push(`${escapedSelector} { background-color: ${value}; }`);
        } else if (prefix === "min-h") {
          cssRules.push(`${escapedSelector} { min-height: ${value}; }`);
        } else if (prefix === "max-w") {
          cssRules.push(`${escapedSelector} { max-width: ${value}; }`);
        } else if (prefix === "h") {
          cssRules.push(`${escapedSelector} { height: ${value}; }`);
        } else if (prefix === "w") {
          cssRules.push(`${escapedSelector} { width: ${value}; }`);
        } else if (prefix === "p" || prefix === "px" || prefix === "py") {
          const prop =
            prefix === "px"
              ? `padding-left: ${value}; padding-right: ${value};`
              : prefix === "py"
                ? `padding-top: ${value}; padding-bottom: ${value};`
                : `padding: ${value};`;
          cssRules.push(`${escapedSelector} { ${prop} }`);
        }
      }
    }
    styleTag.textContent = cssRules.join("\n");

    // 3. Trigger Tailwind Play CDN refresh if loaded
    const w = window as any;
    if (w.tailwind?.refresh) {
      try {
        w.tailwind.refresh();
      } catch {}
    }
  }, [themeFiles]);
}

function usePreviewThemeFiles(storefrontId: string, themeId: string) {
  const fileQuery = useQuery(
    storefrontThemeFileQueries.tree(storefrontId, themeId),
  );
  const [themeFiles, setThemeFiles] = useState<
    Array<{ path: string; content: string }>
  >([]);

  useEffect(() => {
    if (fileQuery.data?.files) {
      setThemeFiles(fileQuery.data.files);
    }
  }, [fileQuery.data]);

  useEffect(() => {
    const handleThemeFileMessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (
        event.origin !== window.location.origin ||
        event.source !== window.parent ||
        typeof message !== "object" ||
        message === null ||
        !("type" in message)
      ) {
        return;
      }

      if (
        message.type === "morph:storefront-preview-update-theme-files" &&
        "files" in message &&
        Array.isArray(message.files)
      ) {
        setThemeFiles(
          message.files as Array<{ path: string; content: string }>,
        );
      }
    };

    window.addEventListener("message", handleThemeFileMessage);
    return () => window.removeEventListener("message", handleThemeFileMessage);
  }, []);

  return themeFiles;
}

function usePreviewDocument(document: StorefrontPageDocument | undefined) {
  const [previewDocument, setPreviewDocument] = useState(document);

  useEffect(() => {
    setPreviewDocument(document);
  }, [document]);

  useEffect(() => {
    const handlePreviewMessages = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (
        event.origin !== window.location.origin ||
        event.source !== window.parent ||
        typeof message !== "object" ||
        message === null ||
        !("type" in message)
      ) {
        return;
      }

      if (
        message.type === "morph:storefront-preview-set-section-order" &&
        "sectionIds" in message &&
        Array.isArray(message.sectionIds) &&
        message.sectionIds.every((id) => typeof id === "string")
      ) {
        const sectionIds = message.sectionIds as string[];
        setPreviewDocument((current) => {
          if (!current || sectionIds.length !== current.sections.length) {
            return current;
          }

          const sectionsById = new Map(
            current.sections.map((section) => [section.id, section]),
          );
          const reorderedSections = sectionIds.flatMap((sectionId) => {
            const section = sectionsById.get(sectionId);
            return section ? [section] : [];
          });
          if (reorderedSections.length !== current.sections.length) {
            return current;
          }

          return { ...current, sections: reorderedSections };
        });
      }

      if (
        message.type === "morph:storefront-preview-update-section-props" &&
        "sectionId" in message &&
        typeof message.sectionId === "string"
      ) {
        const { sectionId, props, enabled } = message as {
          sectionId: string;
          props?: Record<string, unknown>;
          enabled?: boolean;
        };

        setPreviewDocument((current) => {
          if (!current) return current;
          return {
            ...current,
            sections: current.sections.map((section) => {
              if (section.id !== sectionId) return section;
              return {
                ...section,
                enabled:
                  typeof enabled === "boolean" ? enabled : section.enabled,
                props: {
                  ...section.props,
                  ...(props ?? {}),
                } as Record<string, any>,
              };
            }),
          };
        });
      }
    };

    window.addEventListener("message", handlePreviewMessages);
    return () => window.removeEventListener("message", handlePreviewMessages);
  }, []);

  return previewDocument;
}

function useStorefrontPreviewSelectionBridge(enabled: boolean) {
  useEffect(() => {
    if (!enabled || window.parent === window) return;

    const style = document.createElement("style");
    style.dataset.storefrontEditorSelection = "true";
    style.textContent = `
      html[data-storefront-editor-selection-enabled="true"] [data-storefront-section-id],
      html[data-storefront-editor-selection-enabled="true"] [data-storefront-component] {
        cursor: pointer !important;
      }
      html[data-storefront-editor-pan-enabled="true"],
      html[data-storefront-editor-pan-enabled="true"] body,
      html[data-storefront-editor-pan-enabled="true"] body * {
        cursor: grab !important;
        user-select: none !important;
      }
      html[data-storefront-editor-panning="true"],
      html[data-storefront-editor-panning="true"] body,
      html[data-storefront-editor-panning="true"] body * {
        cursor: grabbing !important;
      }
    `;
    document.head.appendChild(style);

    // 1. Persistent Selected Overlay (Solid 2px border, Glow ring, Bold badge)
    const selectedOverlay = document.createElement("div");
    selectedOverlay.setAttribute("aria-hidden", "true");
    Object.assign(selectedOverlay.style, {
      position: "fixed",
      zIndex: "2147483646",
      display: "none",
      pointerEvents: "none",
      border: "2px solid hsl(217 91% 60%)",
      boxShadow: "0 0 0 3px hsl(217 91% 60% / 0.18)",
      boxSizing: "border-box",
      borderRadius: "3px",
      transition: "all 0.04s ease-out",
    });

    const selectedLabel = document.createElement("span");
    Object.assign(selectedLabel.style, {
      position: "absolute",
      left: "-2px",
      bottom: "100%",
      padding: "3px 7px",
      borderRadius: "4px 4px 0 0",
      background: "hsl(217 91% 60%)",
      color: "white",
      font: "600 11px/1.2 ui-sans-serif, system-ui, sans-serif",
      letterSpacing: "0.01em",
      whiteSpace: "nowrap",
    });
    selectedOverlay.appendChild(selectedLabel);
    document.body.appendChild(selectedOverlay);

    // 2. Hover Overlay (1.5px dashed border, Light blue transparent mask, Subtle badge)
    const hoverOverlay = document.createElement("div");
    hoverOverlay.setAttribute("aria-hidden", "true");
    Object.assign(hoverOverlay.style, {
      position: "fixed",
      zIndex: "2147483645",
      display: "none",
      pointerEvents: "none",
      border: "1.5px dashed hsl(217 91% 60% / 0.85)",
      background: "hsl(217 91% 60% / 0.08)",
      boxSizing: "border-box",
      borderRadius: "3px",
      transition: "all 0.04s ease-out",
    });

    const hoverLabel = document.createElement("span");
    Object.assign(hoverLabel.style, {
      position: "absolute",
      left: "-1.5px",
      bottom: "100%",
      padding: "2px 6px",
      borderRadius: "3px 3px 0 0",
      background: "hsl(217 91% 60% / 0.85)",
      color: "white",
      font: "500 10px/1.2 ui-sans-serif, system-ui, sans-serif",
      letterSpacing: "0.01em",
      whiteSpace: "nowrap",
    });
    hoverOverlay.appendChild(hoverLabel);
    document.body.appendChild(hoverOverlay);

    type SelectableInfo = {
      element: HTMLElement;
      section: HTMLElement | null;
      sectionId: string | null;
      type: string;
      label: string;
      elementKey: string | null;
      fieldKey: string | null;
      field: string | null;
    };

    let hoveredItem: SelectableInfo | null = null;
    let selectedItem: SelectableInfo | null = null;
    let selectedElement: HTMLElement | null = null;
    let selectedSectionId: string | null = null;
    let selectionEnabled = false;
    let panGesture: {
      pointerId: number;
      startScreenX: number;
      startScreenY: number;
      didMove: boolean;
      captureTarget: Element;
    } | null = null;
    let suppressNextClick = false;

    const getComponentDisplayName = (type: string): string => {
      switch (type.toLowerCase()) {
        case "hero":
          return "Hero Section";
        case "editorial-intro":
          return "Editorial Intro";
        case "category-showcase":
          return "Category Showcase";
        case "image-with-text":
          return "Image With Text";
        case "principles":
          return "Principles Section";
        case "newsletter":
          return "Newsletter Section";
        case "heading":
          return "Heading";
        case "eyebrow":
          return "Eyebrow";
        case "description":
        case "body":
          return "Body Text";
        case "button":
          return "Button";
        case "image":
          return "Image";
        case "input":
          return "Input Field";
        case "collection-item":
          return "Collection Item";
        case "principle-item":
          return "Principle Card";
        case "title":
          return "Title";
        case "caption":
          return "Caption";
        case "label":
        case "badge":
          return "Label";
        default:
          return type.charAt(0).toUpperCase() + type.slice(1);
      }
    };

    const resolveSelectable = (
      target: EventTarget | null,
    ): SelectableInfo | null => {
      if (!(target instanceof HTMLElement)) return null;

      // 0. Prioritize Morph element identity annotations (data-morph-element)
      const morphEl = target.closest<HTMLElement>("[data-morph-element]");
      if (morphEl) {
        const sectionEl = morphEl.closest<HTMLElement>(
          "[data-storefront-section-id], [data-morph-section]",
        );
        const elementKey = morphEl.dataset.morphElement!;
        const fieldKey =
          morphEl.dataset.storefrontField ??
          (elementKey === "action"
            ? "actionLabel"
            : elementKey === "image"
              ? "imageSrc"
              : elementKey);

        return {
          element: morphEl,
          section: sectionEl,
          sectionId: sectionEl?.dataset.storefrontSectionId ?? null,
          type: elementKey,
          label: elementKey.charAt(0).toUpperCase() + elementKey.slice(1),
          elementKey,
          fieldKey,
          field: fieldKey,
        };
      }

      // 1. Prioritize explicit component/field annotation
      const componentEl = target.closest<HTMLElement>(
        "[data-storefront-component]",
      );
      if (componentEl) {
        const sectionEl = componentEl.closest<HTMLElement>(
          "[data-storefront-section-id]",
        );
        const compType =
          componentEl.dataset.storefrontComponent ??
          componentEl.tagName.toLowerCase();
        const fieldKey = componentEl.dataset.storefrontField ?? null;
        const elementKey =
          componentEl.dataset.morphElement ??
          (compType === "heading" ||
          compType === "eyebrow" ||
          compType === "description" ||
          compType === "action" ||
          compType === "image"
            ? compType
            : null);

        return {
          element: componentEl,
          section: sectionEl,
          sectionId: sectionEl?.dataset.storefrontSectionId ?? null,
          type: compType,
          label: getComponentDisplayName(compType),
          elementKey,
          fieldKey,
          field: fieldKey ?? elementKey,
        };
      }

      // 2. Standard interactive & typography sub-elements
      const elementEl = target.closest<HTMLElement>(
        "h1, h2, h3, h4, p, img, a, button, input, article",
      );
      if (elementEl) {
        const sectionEl = elementEl.closest<HTMLElement>(
          "[data-storefront-section-id]",
        );
        const tag = elementEl.tagName.toLowerCase();
        const compType = tag.startsWith("h")
          ? "heading"
          : tag === "img"
            ? "image"
            : tag === "a" || tag === "button"
              ? "action"
              : tag === "p"
                ? "description"
                : tag === "article"
                  ? "card"
                  : tag;

        const fieldKey =
          elementEl.dataset.storefrontField ??
          (compType === "action"
            ? "actionLabel"
            : compType === "image"
              ? "imageSrc"
              : compType);

        return {
          element: elementEl,
          section: sectionEl,
          sectionId: sectionEl?.dataset.storefrontSectionId ?? null,
          type: compType,
          label: getComponentDisplayName(compType),
          elementKey: compType,
          fieldKey,
          field: fieldKey,
        };
      }

      // 3. Fallback to outer Section
      const section = target.closest<HTMLElement>(
        "[data-storefront-section-id]",
      );
      if (section) {
        const secType = section.dataset.storefrontSectionType ?? "section";
        return {
          element: section,
          section,
          sectionId: section.dataset.storefrontSectionId ?? null,
          type: secType,
          label: getComponentDisplayName(secType),
          elementKey: null,
          fieldKey: null,
          field: null,
        };
      }

      return null;
    };

    const positionOverlays = () => {
      if (!selectionEnabled) {
        hoverOverlay.style.display = "none";
        selectedOverlay.style.display = "none";
        return;
      }

      // 1. Position Persistent Selected Overlay
      if (selectedItem?.element && document.body.contains(selectedItem.element)) {
        const sBounds = selectedItem.element.getBoundingClientRect();
        selectedOverlay.style.display = "block";
        selectedOverlay.style.left = `${sBounds.left}px`;
        selectedOverlay.style.top = `${sBounds.top}px`;
        selectedOverlay.style.width = `${sBounds.width}px`;
        selectedOverlay.style.height = `${sBounds.height}px`;
        selectedLabel.textContent = selectedItem.label;
      } else {
        selectedOverlay.style.display = "none";
      }

      // 2. Position Hover Overlay (dashed + mask, hidden if hovering over selected item)
      if (
        hoveredItem?.element &&
        document.body.contains(hoveredItem.element) &&
        hoveredItem.element !== selectedItem?.element
      ) {
        const hBounds = hoveredItem.element.getBoundingClientRect();
        hoverOverlay.style.display = "block";
        hoverOverlay.style.left = `${hBounds.left}px`;
        hoverOverlay.style.top = `${hBounds.top}px`;
        hoverOverlay.style.width = `${hBounds.width}px`;
        hoverOverlay.style.height = `${hBounds.height}px`;
        hoverLabel.textContent = hoveredItem.label;
      } else {
        hoverOverlay.style.display = "none";
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!selectionEnabled && panGesture?.pointerId === event.pointerId) {
        panGesture.didMove ||=
          Math.hypot(
            event.screenX - panGesture.startScreenX,
            event.screenY - panGesture.startScreenY,
          ) >= 3;
        event.preventDefault();
        window.parent.postMessage(
          {
            type: "morph:storefront-preview-pointer",
            phase: "move",
            pointerId: event.pointerId,
            screenX: event.screenX,
            screenY: event.screenY,
          },
          window.location.origin,
        );
        return;
      }
      if (!selectionEnabled) return;
      const nextItem = resolveSelectable(event.target);
      if (nextItem?.element === hoveredItem?.element) return;
      hoveredItem = nextItem;
      positionOverlays();
    };

    const handlePointerLeave = () => {
      hoveredItem = null;
      positionOverlays();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (
        selectionEnabled ||
        event.button !== 0 ||
        !(event.target instanceof Element)
      ) {
        return;
      }
      event.target.setPointerCapture(event.pointerId);
      panGesture = {
        pointerId: event.pointerId,
        startScreenX: event.screenX,
        startScreenY: event.screenY,
        didMove: false,
        captureTarget: event.target,
      };
      window.parent.postMessage(
        {
          type: "morph:storefront-preview-pointer",
          phase: "down",
          pointerId: event.pointerId,
          screenX: event.screenX,
          screenY: event.screenY,
        },
        window.location.origin,
      );
      document.documentElement.setAttribute(
        "data-storefront-editor-panning",
        "true",
      );
    };

    const finishPanGesture = (event: PointerEvent) => {
      if (panGesture?.pointerId !== event.pointerId) return;
      suppressNextClick = panGesture.didMove;
      window.parent.postMessage(
        {
          type: "morph:storefront-preview-pointer",
          phase: event.type === "pointercancel" ? "cancel" : "up",
          pointerId: event.pointerId,
          screenX: event.screenX,
          screenY: event.screenY,
        },
        window.location.origin,
      );
      if (panGesture.captureTarget.hasPointerCapture(event.pointerId)) {
        panGesture.captureTarget.releasePointerCapture(event.pointerId);
      }
      panGesture = null;
      document.documentElement.removeAttribute(
        "data-storefront-editor-panning",
      );
    };

    const handleClick = (event: MouseEvent) => {
      if (!selectionEnabled) {
        if (suppressNextClick) {
          event.preventDefault();
          event.stopPropagation();
          suppressNextClick = false;
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const selectable = resolveSelectable(event.target);
      if (!selectable) return;

      selectedElement?.removeAttribute("data-storefront-editor-selected");
      selectedElement = selectable.element;
      selectedElement.dataset.storefrontEditorSelected = "true";
      selectedItem = selectable;
      selectedSectionId = selectable.sectionId;

      positionOverlays();

      if (selectable.sectionId) {
        const computed = window.getComputedStyle(selectable.element);
        const computedStyle = {
          fontSize: computed.fontSize,
          lineHeight: computed.lineHeight,
          fontFamily: computed.fontFamily,
          fontWeight: computed.fontWeight,
          textAlign: computed.textAlign,
          paddingTop: computed.paddingTop,
          paddingBottom: computed.paddingBottom,
          paddingLeft: computed.paddingLeft,
          paddingRight: computed.paddingRight,
          backgroundColor: computed.backgroundColor,
          borderRadius: computed.borderRadius,
        };

        const morphNodeId =
          selectable.element.getAttribute("data-morph-node") ||
          selectable.element.dataset.morphNode ||
          undefined;

        window.parent.postMessage(
          {
            type: "morph:storefront-preview-select-section",
            sectionId: selectable.sectionId,
            componentType: selectable.type,
            nodeId: morphNodeId,
            elementKey: selectable.elementKey,
            fieldKey: selectable.fieldKey,
            field: selectable.fieldKey ?? selectable.elementKey,
            computedStyle,
          },
          window.location.origin,
        );
      }
    };

    const handleDoubleClick = (event: MouseEvent) => {
      if (selectionEnabled) return;
      event.preventDefault();
      event.stopPropagation();
      window.parent.postMessage(
        { type: "morph:storefront-preview-reset-canvas" },
        window.location.origin,
      );
    };

    const handleDragStart = (event: DragEvent) => {
      if (!selectionEnabled) event.preventDefault();
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

    const restoreSelectedSection = () => {
      selectedElement?.removeAttribute("data-storefront-editor-selected");
      if (selectionEnabled && selectedSectionId) {
        const sectionEl = document.querySelector<HTMLElement>(
          `[data-storefront-section-id="${CSS.escape(selectedSectionId)}"]`,
        );
        if (sectionEl) {
          selectedElement = sectionEl;
          selectedElement.setAttribute("data-storefront-editor-selected", "true");
          selectedItem = resolveSelectable(sectionEl);
        } else {
          selectedItem = null;
        }
      } else {
        selectedItem = null;
      }
      positionOverlays();
    };

    const handleEditorMessage = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== window.parent ||
        typeof event.data !== "object" ||
        event.data === null ||
        !("type" in event.data)
      ) {
        return;
      }

      if (event.data.type === "morph:storefront-preview-set-selection-mode") {
        if (
          !("enabled" in event.data) ||
          typeof event.data.enabled !== "boolean"
        ) {
          return;
        }
        selectionEnabled = event.data.enabled;
        document.documentElement.toggleAttribute(
          "data-storefront-editor-selection-enabled",
          selectionEnabled,
        );
        document.documentElement.toggleAttribute(
          "data-storefront-editor-pan-enabled",
          !selectionEnabled,
        );
        hoveredItem = null;
        positionOverlays();
        restoreSelectedSection();
        return;
      }

      if (
        event.data.type !== "morph:storefront-preview-set-section" ||
        !("sectionId" in event.data) ||
        (typeof event.data.sectionId !== "string" &&
          event.data.sectionId !== null)
      ) {
        return;
      }

      selectedSectionId = event.data.sectionId;
      restoreSelectedSection();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("pointerup", finishPanGesture, true);
    document.addEventListener("pointercancel", finishPanGesture, true);
    document.addEventListener("pointerleave", handlePointerLeave, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("dblclick", handleDoubleClick, true);
    document.addEventListener("dragstart", handleDragStart, true);
    document.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: false,
    });
    window.addEventListener("scroll", positionOverlays, true);
    window.addEventListener("resize", positionOverlays);
    window.addEventListener("message", handleEditorMessage);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointermove", handlePointerMove, true);
      document.removeEventListener("pointerup", finishPanGesture, true);
      document.removeEventListener("pointercancel", finishPanGesture, true);
      document.removeEventListener("pointerleave", handlePointerLeave, true);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("dblclick", handleDoubleClick, true);
      document.removeEventListener("dragstart", handleDragStart, true);
      document.removeEventListener("wheel", handleWheel, true);
      window.removeEventListener("scroll", positionOverlays, true);
      window.removeEventListener("resize", positionOverlays);
      window.removeEventListener("message", handleEditorMessage);
      document.documentElement.removeAttribute(
        "data-storefront-editor-selection-enabled",
      );
      document.documentElement.removeAttribute(
        "data-storefront-editor-pan-enabled",
      );
      document.documentElement.removeAttribute(
        "data-storefront-editor-panning",
      );
      style.remove();
      hoverOverlay.remove();
      selectedOverlay.remove();
      selectedElement?.removeAttribute("data-storefront-editor-selected");
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
      <LoaderCircle className="size-6 animate-spin text-neutral-400" />
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
