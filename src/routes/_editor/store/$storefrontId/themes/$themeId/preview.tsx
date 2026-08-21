import { StorefrontPreview } from "@/components/storefront/storefront-preview";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { storefrontThemePreviewSearchSchema } from "@/lib/validations/storefront-theme";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { storefrontThemeQueries } from "../../../../-queries/storefront-theme.queries";

import { storefrontThemeFileQueries } from "../../../../-queries/storefront-theme-files.queries";
import {
  type ThemeCompilerApplication,
  useThemeCompiler,
} from "@/lib/storefront/compiler/use-theme-compiler";
import { selectionKindFromElement } from "@/lib/storefront/editor/selection-taxonomy";
import { createSelectionOverlaySettler } from "@/lib/storefront/editor/selection-overlay-settler";
import {
  createSelectionStylePreview,
  SELECTION_STYLE_APPLIED_EVENT,
  selectionStylePreviewNeedsOverlayUpdate,
} from "@/lib/storefront/editor/selection-style-preview";

const PREVIEW_GEOMETRY_MUTATION_MESSAGES = new Set([
  "morph:storefront-preview-update-theme-files",
  "morph:storefront-preview-update-section-props",
  "morph:storefront-preview-set-section-order",
]);

function selectionStyleSnapshot(computed: CSSStyleDeclaration) {
  return {
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
    backgroundImage: computed.backgroundImage,
    borderRadius: computed.borderRadius,
    display: computed.display,
    flexDirection: computed.flexDirection,
    gap: computed.gap,
    width: computed.width,
    height: computed.height,
    minWidth: computed.minWidth,
    maxWidth: computed.maxWidth,
    minHeight: computed.minHeight,
    maxHeight: computed.maxHeight,
    boxSizing: computed.boxSizing,
    position: computed.position,
    top: computed.top,
    left: computed.left,
    zIndex: computed.zIndex,
    opacity: computed.opacity,
    overflow: computed.overflow,
    transform: computed.transform,
    alignItems: computed.alignItems,
    justifyContent: computed.justifyContent,
  };
}

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
  const {
    themeFiles: previewThemeFiles,
    sourceGeneration,
    styleRevision,
    acknowledgeStyleRevision,
  } = usePreviewThemeFiles(context.storefront.id, context.theme.id);

  // Source may render immediately because transient inline styles bridge the
  // compile window. The revision is acknowledged only after CSS is injected.
  const { diagnostics, hasErrors } = useThemeCompiler(previewThemeFiles, {
    themeId: context.theme.id,
    storefrontId: context.storefront.id,
    sourceGeneration,
    applicationKey: styleRevision,
    onStylesApplied: (application: ThemeCompilerApplication) => {
      if (typeof application.applicationKey === "number") {
        acknowledgeStyleRevision(
          application.applicationKey,
          application.didApplySource,
        );
      }
    },
  });

  return (
    <>
      {hasErrors && (
        <div
          data-storefront-compiler-diagnostics="true"
          className="fixed top-3 right-3 z-[2147483647] max-w-md rounded-lg border border-amber-500/40 bg-amber-950/90 p-3 text-xs text-amber-200 shadow-xl backdrop-blur-sm"
        >
          <div className="font-semibold text-amber-300">
            Theme Compile Diagnostic
          </div>
          <div className="mt-1 space-y-1">
            {diagnostics.slice(0, 3).map((d, i) => (
              <div key={i} className="truncate">
                {d.filePath ? `${d.filePath}: ` : ""}
                {d.message}
              </div>
            ))}
          </div>
        </div>
      )}
      <StorefrontPreview
        context={context}
        templateId={templateId}
        viewportHeight={viewportHeight}
        document={previewDocument}
        themeFiles={previewThemeFiles}
      />
    </>
  );
}

function usePreviewThemeFiles(storefrontId: string, themeId: string) {
  const fileQuery = useQuery(
    storefrontThemeFileQueries.tree(storefrontId, themeId),
  );
  const [themeFiles, setThemeFiles] = useState<
    Array<{ path: string; content: string }>
  >([]);
  const [sourceGeneration, setSourceGeneration] = useState<number | undefined>(
    undefined,
  );
  const [styleRevision, setStyleRevision] = useState<number | undefined>();
  const latestRequestedStyleRevisionRef = useRef<number | undefined>(undefined);
  const hasReceivedEditorFilesRef = useRef(false);

  useEffect(() => {
    if (hasReceivedEditorFilesRef.current) return;
    if (fileQuery.data?.files) {
      setThemeFiles(fileQuery.data.files);
    }
    if (typeof fileQuery.data?.sourceGeneration === "number") {
      setSourceGeneration(fileQuery.data.sourceGeneration);
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
        hasReceivedEditorFilesRef.current = true;
        setThemeFiles(
          message.files as Array<{ path: string; content: string }>,
        );
        if (
          "styleRevision" in message &&
          typeof message.styleRevision === "number" &&
          Number.isSafeInteger(message.styleRevision) &&
          message.styleRevision >= 0
        ) {
          latestRequestedStyleRevisionRef.current = message.styleRevision;
          setStyleRevision(message.styleRevision);
        }
        if (
          "sourceGeneration" in message &&
          typeof message.sourceGeneration === "number"
        ) {
          setSourceGeneration(message.sourceGeneration);
        }
      }
    };

    window.addEventListener("message", handleThemeFileMessage);
    window.parent.postMessage(
      { type: "morph:storefront-preview-ready" },
      window.location.origin,
    );
    return () => window.removeEventListener("message", handleThemeFileMessage);
  }, []);

  const acknowledgeStyleRevision = useCallback((
    appliedRevision: number,
    didApplySource: boolean,
  ) => {
    if (latestRequestedStyleRevisionRef.current !== appliedRevision) return;
    if (didApplySource) {
      window.dispatchEvent(new Event(SELECTION_STYLE_APPLIED_EVENT));
      document.documentElement.dataset.storefrontStyleRevision =
        String(appliedRevision);
    }
    window.parent.postMessage(
      {
        type: didApplySource
          ? "morph:storefront-preview-theme-files-applied"
          : "morph:storefront-preview-theme-files-failed",
        styleRevision: appliedRevision,
      },
      window.location.origin,
    );
  }, []);

  return {
    themeFiles,
    sourceGeneration,
    styleRevision,
    acknowledgeStyleRevision,
  };
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
      fieldPath: string | null;
      tagName: string;
      role: string | null;
      inputType: string | null;
    };

    const selectionMetadata = (item: SelectableInfo) => {
      const kind = selectionKindFromElement({
        component: item.type,
        morphElement: item.elementKey,
        tagName: item.tagName,
        role: item.role,
        inputType: item.inputType,
        isSection: item.element === item.section,
      });
      return {
        kind,
        tagName: item.tagName,
        role: item.role,
        inputType: item.inputType,
        fieldPath: item.fieldPath,
      };
    };

    let hoveredItem: SelectableInfo | null = null;
    let selectedItem: SelectableInfo | null = null;
    let selectedElement: HTMLElement | null = null;
    let selectedSectionId: string | null = null;
    let selectionEnabled = false;
    const selectionStylePreview = createSelectionStylePreview();
    let overlaySettler: ReturnType<
      typeof createSelectionOverlaySettler
    > | null = null;
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

      // 0. Prefer the nearest AST-backed Morph identity annotation.
      const morphEl = target.closest<HTMLElement>(
        "[data-morph-node], [data-morph-element]",
      );
      if (morphEl) {
        const sectionEl = morphEl.closest<HTMLElement>(
          "[data-storefront-section-id], [data-morph-section]",
        );
        const nodeId = morphEl.dataset.morphNode ?? null;
        const elementKey = morphEl.dataset.morphElement ?? null;
        const fieldKey =
          morphEl.dataset.storefrontField ??
          (elementKey
            ? elementKey === "action"
              ? "actionLabel"
              : elementKey === "image"
                ? "imageSrc"
                : elementKey
            : null);
        const fieldPath = morphEl.dataset.storefrontFieldPath ?? fieldKey;
        const selectableType =
          elementKey ?? nodeId ?? morphEl.tagName.toLowerCase();

        return {
          element: morphEl,
          section: sectionEl,
          sectionId:
            sectionEl?.dataset.storefrontSectionId ??
            sectionEl?.dataset.morphSection ??
            null,
          type: selectableType,
          label: getComponentDisplayName(selectableType),
          elementKey,
          fieldKey,
          field: fieldKey,
          fieldPath,
          tagName: morphEl.tagName.toLowerCase(),
          role: morphEl.getAttribute("role"),
          inputType: morphEl instanceof HTMLInputElement ? morphEl.type : null,
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
        const fieldPath = componentEl.dataset.storefrontFieldPath ?? fieldKey;
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
          fieldPath,
          tagName: componentEl.tagName.toLowerCase(),
          role: componentEl.getAttribute("role"),
          inputType:
            componentEl instanceof HTMLInputElement ? componentEl.type : null,
        };
      }

      // 2. Standard interactive & typography sub-elements
      const elementEl = target.closest<HTMLElement>(
        "h1, h2, h3, h4, h5, h6, p, blockquote, code, pre, img, picture, svg, video, audio, canvas, iframe, embed, map, a, button, nav, details, summary, form, fieldset, input, textarea, select, option, ul, ol, li, table, thead, tbody, tfoot, tr, td, th, hr, article",
      );
      if (elementEl) {
        const sectionEl = elementEl.closest<HTMLElement>(
          "[data-storefront-section-id]",
        );
        const tag = elementEl.tagName.toLowerCase();
        const compType = tag.startsWith("h")
          ? "heading"
          : tag === "blockquote"
            ? "blockquote"
            : tag === "code" || tag === "pre"
              ? "code"
              : tag === "img"
                ? "image"
                : tag === "picture"
                  ? "picture"
                  : tag === "svg"
                    ? "svg"
                    : tag === "video"
                      ? "video"
                      : tag === "audio"
                        ? "audio"
                        : tag === "canvas"
                          ? "canvas"
                          : tag === "iframe"
                            ? "iframe"
                            : tag === "embed"
                              ? "embed"
                              : tag === "nav"
                                ? "navigation"
                                : tag === "form"
                                  ? "form"
                                  : tag === "fieldset"
                                    ? "fieldset"
                                    : tag === "textarea"
                                      ? "textarea"
                                      : tag === "select"
                                        ? "select"
                                        : tag === "option"
                                          ? "option"
                                          : tag === "input"
                                            ? elementEl instanceof
                                                HTMLInputElement &&
                                              elementEl.type === "checkbox"
                                              ? "checkbox"
                                              : elementEl instanceof
                                                    HTMLInputElement &&
                                                  elementEl.type === "radio"
                                                ? "radio"
                                                : "input"
                                            : tag === "ul" || tag === "ol"
                                              ? "list"
                                              : tag === "li"
                                                ? "list-item"
                                                : tag === "table"
                                                  ? "table"
                                                  : tag === "tr"
                                                    ? "table-row"
                                                    : tag === "td" ||
                                                        tag === "th"
                                                      ? "table-cell"
                                                      : tag === "hr"
                                                        ? "divider"
                                                        : tag === "a" ||
                                                            tag === "button"
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
        const fieldPath = elementEl.dataset.storefrontFieldPath ?? fieldKey;

        return {
          element: elementEl,
          section: sectionEl,
          sectionId: sectionEl?.dataset.storefrontSectionId ?? null,
          type: compType,
          label: getComponentDisplayName(compType),
          elementKey: compType,
          fieldKey,
          field: fieldKey,
          fieldPath,
          tagName: tag,
          role: elementEl.getAttribute("role"),
          inputType:
            elementEl instanceof HTMLInputElement ? elementEl.type : null,
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
          fieldPath: null,
          tagName: section.tagName.toLowerCase(),
          role: section.getAttribute("role"),
          inputType: null,
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

      // Keep the last stable selected geometry while live authoring replaces
      // the selected DOM node. The settled pass below rebinds its identity and
      // measures the final element once.
      if (selectedItem && overlaySettler?.isFrozen()) {
        selectedOverlay.style.display = "block";
        selectedLabel.textContent = selectedItem.label;
      } else if (
        selectedItem?.element &&
        document.body.contains(selectedItem.element)
      ) {
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

    const findCurrentSelectedElement = (): HTMLElement | null => {
      if (!selectedItem) return null;

      const section = selectedItem.sectionId
        ? document.querySelector<HTMLElement>(
            `[data-storefront-section-id="${CSS.escape(selectedItem.sectionId)}"], [data-morph-section="${CSS.escape(selectedItem.sectionId)}"]`,
          )
        : null;
      if (selectedItem.element === selectedItem.section) return section;

      const scope = section ?? document;
      const nodeId = selectedItem.element.dataset.morphNode;
      if (nodeId) {
        const node = scope.querySelector<HTMLElement>(
          `[data-morph-node="${CSS.escape(nodeId)}"]`,
        );
        if (node) return node;
      }

      if (selectedItem.fieldPath) {
        const field = scope.querySelector<HTMLElement>(
          `[data-storefront-field-path="${CSS.escape(selectedItem.fieldPath)}"]`,
        );
        if (field) return field;
      }

      const morphElement = selectedItem.element.dataset.morphElement;
      if (morphElement) {
        const element = scope.querySelector<HTMLElement>(
          `[data-morph-element="${CSS.escape(morphElement)}"]`,
        );
        if (element) return element;
      }

      if (selectedItem.fieldKey) {
        const field = scope.querySelector<HTMLElement>(
          `[data-storefront-field="${CSS.escape(selectedItem.fieldKey)}"]`,
        );
        if (field) return field;
      }

      return document.body.contains(selectedItem.element)
        ? selectedItem.element
        : null;
    };

    const rebindSelectedElement = () => {
      const nextElement = findCurrentSelectedElement();
      selectedElement?.removeAttribute("data-storefront-editor-selected");
      if (!nextElement) {
        selectedElement = null;
        selectedItem = null;
        return;
      }

      selectedElement = nextElement;
      selectedElement.dataset.storefrontEditorSelected = "true";
      selectedItem = resolveSelectable(nextElement);
    };

    const rebindAndPositionSelectedOverlay = () => {
      rebindSelectedElement();
      positionOverlays();
    };

    overlaySettler = createSelectionOverlaySettler(
      rebindAndPositionSelectedOverlay,
    );

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
        const computedStyle = selectionStyleSnapshot(
          window.getComputedStyle(selectable.element),
        );
        const parentComputedStyle = selectionStyleSnapshot(
          window.getComputedStyle(
            selectable.element.parentElement ?? selectable.element,
          ),
        );
        const sectionComputedStyle = selectionStyleSnapshot(
          window.getComputedStyle(selectable.section ?? selectable.element),
        );

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
            ...selectionMetadata(selectable),
            styleRevision: Number(
              document.documentElement.dataset.storefrontStyleRevision ?? 0,
            ),
            className: selectable.element.getAttribute("class") ?? "",
            isSection: selectable.element === selectable.section,
            inspectorOverride:
              selectable.element.dataset.morphInspector ?? null,
            computedStyle,
            parentComputedStyle,
            sectionComputedStyle,
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
          selectedElement.setAttribute(
            "data-storefront-editor-selected",
            "true",
          );
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
        !("type" in event.data) ||
        typeof event.data.type !== "string"
      ) {
        return;
      }

      if (
        event.data.type === "morph:storefront-preview-update-selection-field" &&
        "fieldKey" in event.data &&
        typeof event.data.fieldKey === "string" &&
        event.data.fieldKey.length <= 100 &&
        "value" in event.data &&
        typeof event.data.value === "string" &&
        event.data.value.length <= 10_000 &&
        selectedItem
      ) {
        const scope = selectedItem.section ?? document;
        const fieldPath =
          "fieldPath" in event.data && typeof event.data.fieldPath === "string"
            ? event.data.fieldPath
            : null;
        const target =
          (fieldPath
            ? scope.querySelector<HTMLElement>(
                `[data-storefront-field-path="${CSS.escape(fieldPath)}"]`,
              )
            : null) ??
          scope.querySelector<HTMLElement>(
            `[data-storefront-field="${CSS.escape(event.data.fieldKey)}"]`,
          ) ??
          (selectedItem.fieldKey === event.data.fieldKey
            ? selectedItem.element
            : null);
        if (!target) return;
        if (event.data.fieldKey === "imageSrc") {
          target.setAttribute("src", event.data.value);
        } else if (event.data.fieldKey === "imageAlt") {
          target.setAttribute("alt", event.data.value);
        } else if (event.data.fieldKey === "actionHref") {
          target.setAttribute("href", event.data.value);
        } else {
          target.textContent = event.data.value;
        }
        positionOverlays();
        return;
      }

      if (
        event.data.type === "morph:storefront-preview-update-selection-style" &&
        "styles" in event.data &&
        typeof event.data.styles === "object" &&
        event.data.styles !== null &&
        "targetElement" in event.data &&
        typeof event.data.targetElement === "string" &&
        event.data.targetElement.length <= 100 &&
        selectedItem?.element
      ) {
        const targetKey = event.data.targetElement;
        const scope = selectedItem.section ?? document;
        const previewTarget =
          targetKey === "section" || targetKey === "root"
            ? (selectedItem.section ?? selectedItem.element)
            : (scope.querySelector<HTMLElement>(
                `[data-morph-node="${CSS.escape(targetKey)}"], [data-morph-element="${CSS.escape(targetKey)}"], [data-storefront-field="${CSS.escape(targetKey)}"]`,
              ) ??
              (selectedItem.elementKey === targetKey ||
              selectedItem.element.dataset.morphNode === targetKey
                ? selectedItem.element
                : null));
        if (!previewTarget) return;
        const previewStyles = event.data.styles as Record<string, string>;
        selectionStylePreview.apply(previewTarget, previewStyles);
        if (selectionStylePreviewNeedsOverlayUpdate(previewStyles)) {
          positionOverlays();
        }
        return;
      }

      if (PREVIEW_GEOMETRY_MUTATION_MESSAGES.has(event.data.type)) {
        overlaySettler?.freezeUntilSettled();
        return;
      }

      if (
        event.data.type === "morph:storefront-preview-request-selection-style"
      ) {
        if (overlaySettler?.isFrozen()) rebindSelectedElement();
        if (selectedItem?.sectionId) {
          const computedStyle = selectionStyleSnapshot(
            window.getComputedStyle(selectedItem.element),
          );
          const parentComputedStyle = selectionStyleSnapshot(
            window.getComputedStyle(
              selectedItem.element.parentElement ?? selectedItem.element,
            ),
          );
          const sectionComputedStyle = selectionStyleSnapshot(
            window.getComputedStyle(
              selectedItem.section ?? selectedItem.element,
            ),
          );
          window.parent.postMessage(
            {
              type: "morph:storefront-preview-select-section",
              sectionId: selectedItem.sectionId,
              componentType: selectedItem.type,
              nodeId:
                selectedItem.element.getAttribute("data-morph-node") ||
                selectedItem.element.dataset.morphNode ||
                undefined,
              elementKey: selectedItem.elementKey,
              fieldKey: selectedItem.fieldKey,
              field: selectedItem.fieldKey ?? selectedItem.elementKey,
              ...selectionMetadata(selectedItem),
              styleRevision: Number(
                document.documentElement.dataset.storefrontStyleRevision ?? 0,
              ),
              className: selectedItem.element.getAttribute("class") ?? "",
              isSection: selectedItem.element === selectedItem.section,
              inspectorOverride:
                selectedItem.element.dataset.morphInspector ?? null,
              computedStyle,
              parentComputedStyle,
              sectionComputedStyle,
            },
            window.location.origin,
          );
        }
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
    window.addEventListener(
      SELECTION_STYLE_APPLIED_EVENT,
      selectionStylePreview.restore,
    );

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
      window.removeEventListener(
        SELECTION_STYLE_APPLIED_EVENT,
        selectionStylePreview.restore,
      );
      selectionStylePreview.restore();
      overlaySettler?.cancel();
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
