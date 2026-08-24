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
import {
  parseEditorToPreviewWindowEvent,
  postPreviewToEditorMessage,
  type PreviewSelectionRestoreTarget,
  type PreviewStyleSnapshot,
} from "@/lib/storefront/editor/preview-protocol";
import { parseArrayItemFieldPath } from "@/lib/storefront/editor/reorder-array-items";

const PREVIEW_GEOMETRY_MUTATION_MESSAGES = new Set([
  "morph:storefront-preview-update-theme-files",
  "morph:storefront-preview-update-section-props",
  "morph:storefront-preview-set-section-order",
]);

export function selectionStyleSnapshot(
  computed: CSSStyleDeclaration,
): PreviewStyleSnapshot {
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
    marginTop: computed.marginTop,
    marginBottom: computed.marginBottom,
    marginLeft: computed.marginLeft,
    marginRight: computed.marginRight,
    color: computed.color,
    backgroundColor: computed.backgroundColor,
    backgroundImage: computed.backgroundImage,
    borderRadius: computed.borderRadius,
    borderTopLeftRadius: computed.borderTopLeftRadius,
    borderTopRightRadius: computed.borderTopRightRadius,
    borderBottomRightRadius: computed.borderBottomRightRadius,
    borderBottomLeftRadius: computed.borderBottomLeftRadius,
    borderTopWidth: computed.borderTopWidth,
    borderTopStyle: computed.borderTopStyle,
    borderTopColor: computed.borderTopColor,
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

export function resolvePreviewSelectionRestoreElement(
  section: HTMLElement,
  target: PreviewSelectionRestoreTarget,
): HTMLElement {
  if (target.isSection) return section;
  const selectors = [
    target.nodeId
      ? `[data-morph-node="${CSS.escape(target.nodeId)}"]`
      : null,
    target.fieldPath
      ? `[data-storefront-field-path="${CSS.escape(target.fieldPath)}"]`
      : null,
    target.elementKey
      ? `[data-morph-element="${CSS.escape(target.elementKey)}"]`
      : null,
    target.fieldKey
      ? `[data-storefront-field="${CSS.escape(target.fieldKey)}"]`
      : null,
  ].filter((selector): selector is string => selector !== null);
  for (const selector of selectors) {
    const match = section.querySelector<HTMLElement>(selector);
    if (match) return match;
  }
  return section;
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
      const message = parseEditorToPreviewWindowEvent(event);
      if (!message) return;

      if (
        message.type === "morph:storefront-preview-update-theme-files" &&
        Array.isArray(message.files)
      ) {
        hasReceivedEditorFilesRef.current = true;
        setThemeFiles(message.files);
        latestRequestedStyleRevisionRef.current = message.styleRevision;
        setStyleRevision(message.styleRevision);
        if (typeof message.sourceGeneration === "number") {
          setSourceGeneration(message.sourceGeneration);
        }
      }
    };

    window.addEventListener("message", handleThemeFileMessage);
    postPreviewToEditorMessage({ type: "morph:storefront-preview-ready" });
    return () => window.removeEventListener("message", handleThemeFileMessage);
  }, []);

  const acknowledgeStyleRevision = useCallback(
    (appliedRevision: number, didApplySource: boolean) => {
      if (latestRequestedStyleRevisionRef.current !== appliedRevision) return;
      if (didApplySource) {
        window.dispatchEvent(new Event(SELECTION_STYLE_APPLIED_EVENT));
        document.documentElement.dataset.storefrontStyleRevision =
          String(appliedRevision);
      }
      postPreviewToEditorMessage({
        type: didApplySource
          ? "morph:storefront-preview-theme-files-applied"
          : "morph:storefront-preview-theme-files-failed",
        styleRevision: appliedRevision,
      });
    },
    [],
  );

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
      const message = parseEditorToPreviewWindowEvent(event);
      if (!message) return;

      if (
        message.type === "morph:storefront-preview-set-section-order" &&
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
        typeof message.sectionId === "string"
      ) {
        const { sectionId, props, enabled } = message;

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
                },
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
      [data-storefront-editor-drag-handle="true"] {
        cursor: grab !important;
      }
      html[data-storefront-editor-reordering="true"] [data-storefront-editor-drag-handle="true"] {
        cursor: grabbing !important;
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
      display: "inline-flex",
      alignItems: "baseline",
      gap: "5px",
      padding: "3px 7px",
      borderRadius: "4px 4px 0 0",
      background: "hsl(217 91% 60%)",
      color: "white",
      font: "600 11px/1.2 ui-sans-serif, system-ui, sans-serif",
      letterSpacing: "0.01em",
      whiteSpace: "nowrap",
    });
    const selectedLabelName = document.createElement("span");
    const selectedLabelTag = document.createElement("span");
    const selectedDragHandle = document.createElement("span");
    selectedDragHandle.dataset.storefrontEditorDragHandle = "true";
    selectedDragHandle.draggable = true;
    selectedDragHandle.title = "Drag to reorder";
    Object.assign(selectedDragHandle.style, {
      display: "none",
      gridTemplateColumns: "repeat(2, 2px)",
      gridAutoRows: "2px",
      gap: "2px",
      alignSelf: "center",
      flex: "0 0 auto",
      width: "14px",
      height: "14px",
      margin: "-2px 0 -2px -3px",
      padding: "2px 3px",
      border: "0",
      borderRadius: "3px",
      background: "transparent",
      color: "inherit",
      pointerEvents: "auto",
    });
    for (let index = 0; index < 6; index += 1) {
      const dot = document.createElement("span");
      Object.assign(dot.style, {
        width: "2px",
        height: "2px",
        borderRadius: "999px",
        background: "currentColor",
        opacity: "0.78",
        pointerEvents: "none",
      });
      selectedDragHandle.appendChild(dot);
    }
    Object.assign(selectedLabelTag.style, {
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: "0.86em",
      fontWeight: "500",
      opacity: "0.72",
    });
    selectedLabel.appendChild(selectedDragHandle);
    selectedLabel.appendChild(selectedLabelName);
    selectedLabel.appendChild(selectedLabelTag);
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
      display: "inline-flex",
      alignItems: "baseline",
      gap: "4px",
      padding: "2px 6px",
      borderRadius: "3px 3px 0 0",
      background: "hsl(217 91% 60% / 0.85)",
      color: "white",
      font: "500 10px/1.2 ui-sans-serif, system-ui, sans-serif",
      letterSpacing: "0.01em",
      whiteSpace: "nowrap",
    });
    const hoverLabelName = document.createElement("span");
    const hoverLabelTag = document.createElement("span");
    Object.assign(hoverLabelTag.style, {
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: "0.86em",
      fontWeight: "500",
      opacity: "0.68",
    });
    hoverLabel.appendChild(hoverLabelName);
    hoverLabel.appendChild(hoverLabelTag);
    hoverOverlay.appendChild(hoverLabel);
    document.body.appendChild(hoverOverlay);

    const reorderTargetOverlay = document.createElement("div");
    reorderTargetOverlay.setAttribute("aria-hidden", "true");
    Object.assign(reorderTargetOverlay.style, {
      position: "fixed",
      zIndex: "2147483647",
      display: "none",
      pointerEvents: "none",
      border: "2px dashed hsl(142 71% 45%)",
      background: "hsl(142 71% 45% / 0.1)",
      boxSizing: "border-box",
      borderRadius: "3px",
    });
    const reorderTargetLabel = document.createElement("span");
    reorderTargetLabel.textContent = "Drop to swap";
    Object.assign(reorderTargetLabel.style, {
      position: "absolute",
      right: "6px",
      top: "6px",
      padding: "3px 7px",
      borderRadius: "4px",
      background: "hsl(142 71% 35%)",
      color: "hsl(0 0% 98%)",
      font: "600 10px/1.2 ui-sans-serif, system-ui, sans-serif",
      letterSpacing: "0.01em",
      whiteSpace: "nowrap",
    });
    reorderTargetOverlay.appendChild(reorderTargetLabel);
    document.body.appendChild(reorderTargetOverlay);

    const reorderCandidateLayer = document.createElement("div");
    reorderCandidateLayer.setAttribute("aria-hidden", "true");
    Object.assign(reorderCandidateLayer.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483644",
      display: "none",
      pointerEvents: "none",
    });
    document.body.appendChild(reorderCandidateLayer);

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
      const sourceElement = item.element.closest<HTMLElement>(
        "[data-morph-source-file]",
      );
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
        sourceFilePath:
          sourceElement?.dataset.morphSourceFile ??
          item.section?.dataset.morphSourceFile ??
          null,
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
    let overlayPositionFrame = 0;
    let dragPreviewElement: HTMLElement | null = null;
    let reorderCandidateOverlays: Array<{
      element: HTMLElement;
      overlay: HTMLElement;
    }> = [];
    let reorderGesture: {
      kind: "source" | "array";
      dragged: HTMLElement;
      parent: HTMLElement;
      sectionId: string;
      sourceFilePath: string;
      draggedNodeId: string | null;
      draggedFieldPath: string | null;
      arrayPath: string | null;
      target: HTMLElement | null;
      targetNodeId: string | null;
      targetFieldPath: string | null;
    } | null = null;

    const updateOverlayLabel = (
      nameElement: HTMLElement,
      tagElement: HTMLElement,
      item: SelectableInfo,
    ) => {
      nameElement.textContent = item.label;
      tagElement.textContent = `<${item.tagName}>`;
    };

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

    const sourceFilePathFor = (element: HTMLElement) =>
      element.closest<HTMLElement>("[data-morph-source-file]")?.dataset
        .morphSourceFile ??
      element.closest<HTMLElement>("[data-storefront-section-id]")?.dataset
        .morphSourceFile ??
      null;

    const isUniqueMorphNode = (element: HTMLElement, nodeId: string) => {
      const sourcePath = sourceFilePathFor(element);
      if (!sourcePath) return false;
      const scope =
        element.closest<HTMLElement>("[data-storefront-section-id]") ??
        document;
      return (
        Array.from(
          scope.querySelectorAll<HTMLElement>(
            `[data-morph-node="${CSS.escape(nodeId)}"]`,
          ),
        ).filter((candidate) => sourceFilePathFor(candidate) === sourcePath)
          .length === 1
      );
    };

    const reorderIdentity = (element: HTMLElement) => {
      const nodeId = element.dataset.morphNode;
      const fieldPath = element.dataset.storefrontFieldPath;
      const arrayItem = fieldPath ? parseArrayItemFieldPath(fieldPath) : null;
      const parent = element.parentElement;
      const section = element.closest<HTMLElement>(
        "[data-storefront-section-id]",
      );
      const sectionId = section?.dataset.storefrontSectionId;
      const sourceFilePath = sourceFilePathFor(element);
      if (!parent || !sectionId || !sourceFilePath || element === section) {
        return null;
      }
      if (arrayItem && fieldPath) {
        return {
          kind: "array" as const,
          nodeId: null,
          fieldPath,
          arrayPath: arrayItem.arrayPath,
          parent,
          sectionId,
          sourceFilePath,
        };
      }
      if (!nodeId || !isUniqueMorphNode(element, nodeId)) return null;
      return {
        kind: "source" as const,
        nodeId,
        fieldPath: null,
        arrayPath: null,
        parent,
        sectionId,
        sourceFilePath,
      };
    };

    const isCompatibleReorderTarget = (
      identity: NonNullable<ReturnType<typeof reorderIdentity>>,
      gesture: NonNullable<typeof reorderGesture>,
    ) =>
      identity.kind === gesture.kind &&
      identity.parent === gesture.parent &&
      identity.sectionId === gesture.sectionId &&
      identity.sourceFilePath === gesture.sourceFilePath &&
      (identity.kind !== "array" || identity.arrayPath === gesture.arrayPath);

    const clearDragPreview = () => {
      dragPreviewElement?.remove();
      dragPreviewElement = null;
    };

    const createDragPreview = (element: HTMLElement, label: string) => {
      clearDragPreview();
      const rect = element.getBoundingClientRect();
      const sourceWidth = Math.max(rect.width, 1);
      const sourceHeight = Math.max(rect.height, 1);
      const scale = Math.min(1, 260 / sourceWidth, 132 / sourceHeight);
      const previewWidth = Math.max(112, Math.round(sourceWidth * scale));
      const previewHeight = Math.max(48, Math.round(sourceHeight * scale));

      const preview = document.createElement("div");
      preview.setAttribute("aria-hidden", "true");
      Object.assign(preview.style, {
        position: "fixed",
        left: "-10000px",
        top: "0",
        width: `${previewWidth}px`,
        height: `${previewHeight + 25}px`,
        overflow: "hidden",
        border: "2px solid hsl(217 91% 60%)",
        borderRadius: "6px",
        background: "hsl(225 8% 18%)",
        boxShadow: "0 12px 30px hsl(225 20% 4% / 0.38)",
        boxSizing: "border-box",
        pointerEvents: "none",
      });

      const previewLabel = document.createElement("div");
      previewLabel.textContent = label;
      Object.assign(previewLabel.style, {
        height: "23px",
        display: "flex",
        alignItems: "center",
        padding: "0 8px",
        background: "hsl(217 91% 60%)",
        color: "hsl(0 0% 98%)",
        font: "600 10px/1 ui-sans-serif, system-ui, sans-serif",
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
      });

      const previewViewport = document.createElement("div");
      Object.assign(previewViewport.style, {
        position: "relative",
        width: `${previewWidth}px`,
        height: `${previewHeight}px`,
        overflow: "hidden",
        background: "hsl(0 0% 98%)",
      });
      const clone = element.cloneNode(true) as HTMLElement;
      [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))].forEach(
        (node) => {
          node.removeAttribute("id");
          node.removeAttribute("draggable");
          node.removeAttribute("data-storefront-editor-selected");
        },
      );
      Object.assign(clone.style, {
        position: "absolute",
        left: "0",
        top: "0",
        width: `${sourceWidth}px`,
        height: `${sourceHeight}px`,
        margin: "0",
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        pointerEvents: "none",
      });
      previewViewport.appendChild(clone);
      preview.appendChild(previewLabel);
      preview.appendChild(previewViewport);
      document.body.appendChild(preview);
      dragPreviewElement = preview;
      return preview;
    };

    const clearReorderCandidates = () => {
      reorderCandidateOverlays = [];
      reorderCandidateLayer.replaceChildren();
      reorderCandidateLayer.style.display = "none";
    };

    const positionReorderCandidates = () => {
      if (!reorderGesture || reorderCandidateOverlays.length === 0) {
        reorderCandidateLayer.style.display = "none";
        return;
      }
      reorderCandidateLayer.style.display = "block";
      const measurements = reorderCandidateOverlays.map(
        ({ element, overlay }) => ({
          overlay,
          rect: element.getBoundingClientRect(),
        }),
      );
      measurements.forEach(({ overlay, rect }) => {
        Object.assign(overlay.style, {
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
      });
    };

    const showReorderCandidates = () => {
      clearReorderCandidates();
      if (!reorderGesture) return;
      Array.from(reorderGesture.parent.children).forEach((candidate) => {
        if (
          !(candidate instanceof HTMLElement) ||
          candidate === reorderGesture?.dragged
        ) {
          return;
        }
        const identity = reorderIdentity(candidate);
        if (
          !identity ||
          !reorderGesture ||
          !isCompatibleReorderTarget(identity, reorderGesture)
        ) {
          return;
        }
        const overlay = document.createElement("div");
        Object.assign(overlay.style, {
          position: "fixed",
          pointerEvents: "none",
          border: "1.5px dashed hsl(217 91% 60% / 0.72)",
          borderRadius: "3px",
          background: "hsl(217 91% 60% / 0.055)",
          boxSizing: "border-box",
        });
        const label = document.createElement("span");
        label.textContent = "↔ Swap";
        Object.assign(label.style, {
          position: "absolute",
          right: "6px",
          top: "6px",
          padding: "3px 7px",
          borderRadius: "4px",
          background: "hsl(217 91% 60% / 0.9)",
          color: "hsl(0 0% 98%)",
          font: "600 10px/1.2 ui-sans-serif, system-ui, sans-serif",
          letterSpacing: "0.01em",
          whiteSpace: "nowrap",
        });
        overlay.appendChild(label);
        reorderCandidateLayer.appendChild(overlay);
        reorderCandidateOverlays.push({ element: candidate, overlay });
      });
      positionReorderCandidates();
    };

    const clearReorderFeedback = () => {
      document.documentElement.removeAttribute(
        "data-storefront-editor-reordering",
      );
      positionReorderTarget(null);
      clearReorderCandidates();
      clearDragPreview();
    };

    const hideSelectedDragHandle = () => {
      selectedDragHandle.style.display = "none";
    };

    const syncSelectedDraggable = () => {
      hideSelectedDragHandle();
      if (!selectionEnabled || !selectedElement) return;
      if (!reorderIdentity(selectedElement)) return;
      selectedDragHandle.style.display = "inline-grid";
      selectedDragHandle.title = `Drag ${selectedItem?.label ?? "selected item"} to reorder`;
    };

    const directReorderTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement) || !reorderGesture) return null;
      let candidate: HTMLElement | null = target;
      while (candidate && candidate.parentElement !== reorderGesture.parent) {
        candidate = candidate.parentElement;
      }
      if (!candidate || candidate === reorderGesture.dragged) return null;
      const identity = reorderIdentity(candidate);
      if (!identity || !isCompatibleReorderTarget(identity, reorderGesture)) {
        return null;
      }
      return { element: candidate, identity };
    };

    const positionReorderTarget = (element: HTMLElement | null) => {
      if (!element || !document.body.contains(element)) {
        reorderTargetOverlay.style.display = "none";
        return;
      }
      const rect = element.getBoundingClientRect();
      Object.assign(reorderTargetOverlay.style, {
        display: "block",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    };

    const positionOverlays = () => {
      if (!selectionEnabled) {
        hoverOverlay.style.display = "none";
        selectedOverlay.style.display = "none";
        return;
      }

      // Measure every target before mutating either overlay. Keeping the reads
      // together avoids a selected-overlay write forcing the following hover
      // measurement to synchronously recalculate layout.
      const selectedElementForOverlay = selectedItem?.element ?? null;
      const selectedBounds =
        selectedElementForOverlay &&
        !overlaySettler?.isFrozen() &&
        document.body.contains(selectedElementForOverlay)
          ? selectedElementForOverlay.getBoundingClientRect()
          : null;
      const hoverElementForOverlay = hoveredItem?.element ?? null;
      const hoverBounds =
        hoverElementForOverlay &&
        document.body.contains(hoverElementForOverlay) &&
        hoverElementForOverlay !== selectedElementForOverlay
          ? hoverElementForOverlay.getBoundingClientRect()
          : null;

      // Keep the last stable selected geometry while live authoring replaces
      // the selected DOM node. The settled pass below rebinds its identity and
      // measures the final element once.
      if (selectedItem && overlaySettler?.isFrozen()) {
        selectedOverlay.style.display = "block";
        updateOverlayLabel(selectedLabelName, selectedLabelTag, selectedItem);
      } else if (selectedItem && selectedBounds) {
        selectedOverlay.style.display = "block";
        selectedOverlay.style.left = `${selectedBounds.left}px`;
        selectedOverlay.style.top = `${selectedBounds.top}px`;
        selectedOverlay.style.width = `${selectedBounds.width}px`;
        selectedOverlay.style.height = `${selectedBounds.height}px`;
        updateOverlayLabel(selectedLabelName, selectedLabelTag, selectedItem);
      } else {
        selectedOverlay.style.display = "none";
      }

      // 2. Position Hover Overlay (dashed + mask, hidden if hovering over selected item)
      if (hoveredItem && hoverBounds) {
        hoverOverlay.style.display = "block";
        hoverOverlay.style.left = `${hoverBounds.left}px`;
        hoverOverlay.style.top = `${hoverBounds.top}px`;
        hoverOverlay.style.width = `${hoverBounds.width}px`;
        hoverOverlay.style.height = `${hoverBounds.height}px`;
        updateOverlayLabel(hoverLabelName, hoverLabelTag, hoveredItem);
      } else {
        hoverOverlay.style.display = "none";
      }
    };

    const schedulePositionOverlays = () => {
      if (overlayPositionFrame !== 0) return;
      overlayPositionFrame = requestAnimationFrame(() => {
        overlayPositionFrame = 0;
        positionOverlays();
        positionReorderCandidates();
      });
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
      if (selectedItem.fieldPath) {
        const field = scope.querySelector<HTMLElement>(
          `[data-storefront-field-path="${CSS.escape(selectedItem.fieldPath)}"]`,
        );
        if (field) return field;
      }

      const nodeId = selectedItem.element.dataset.morphNode;
      if (nodeId) {
        const node = scope.querySelector<HTMLElement>(
          `[data-morph-node="${CSS.escape(nodeId)}"]`,
        );
        if (node) return node;
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
        hideSelectedDragHandle();
        selectedElement = null;
        selectedItem = null;
        return;
      }

      selectedElement = nextElement;
      selectedElement.dataset.storefrontEditorSelected = "true";
      selectedItem = resolveSelectable(nextElement);
      syncSelectedDraggable();
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
        postPreviewToEditorMessage({
          type: "morph:storefront-preview-pointer",
          phase: "move",
          pointerId: event.pointerId,
          screenX: event.screenX,
          screenY: event.screenY,
        });
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
      postPreviewToEditorMessage({
        type: "morph:storefront-preview-pointer",
        phase: "down",
        pointerId: event.pointerId,
        screenX: event.screenX,
        screenY: event.screenY,
      });
      document.documentElement.setAttribute(
        "data-storefront-editor-panning",
        "true",
      );
    };

    const finishPanGesture = (event: PointerEvent) => {
      if (panGesture?.pointerId !== event.pointerId) return;
      suppressNextClick = panGesture.didMove;
      postPreviewToEditorMessage({
        type: "morph:storefront-preview-pointer",
        phase: event.type === "pointercancel" ? "cancel" : "up",
        pointerId: event.pointerId,
        screenX: event.screenX,
        screenY: event.screenY,
      });
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
      if (suppressNextClick) {
        event.preventDefault();
        event.stopPropagation();
        suppressNextClick = false;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const selectable = resolveSelectable(event.target);
      if (!selectable) return;

      // Read the style snapshots before updating selection markers or overlay
      // DOM so this click does not become a write -> layout read cycle.
      const computedStyle = selectable.sectionId
        ? selectionStyleSnapshot(window.getComputedStyle(selectable.element))
        : null;
      const parentComputedStyle = selectable.sectionId
        ? selectionStyleSnapshot(
            window.getComputedStyle(
              selectable.element.parentElement ?? selectable.element,
            ),
          )
        : null;
      const sectionComputedStyle = selectable.sectionId
        ? selectionStyleSnapshot(
            window.getComputedStyle(selectable.section ?? selectable.element),
          )
        : null;
      const previousSelectedElement = selectedElement;
      selectedElement = selectable.element;
      selectedItem = selectable;
      selectedSectionId = selectable.sectionId;

      positionOverlays();
      previousSelectedElement?.removeAttribute(
        "data-storefront-editor-selected",
      );
      selectedElement.dataset.storefrontEditorSelected = "true";
      syncSelectedDraggable();

      if (selectable.sectionId) {
        const morphNodeId =
          selectable.element.getAttribute("data-morph-node") ||
          selectable.element.dataset.morphNode ||
          undefined;

        postPreviewToEditorMessage({
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
          inspectorOverride: selectable.element.dataset.morphInspector ?? null,
          computedStyle,
          parentComputedStyle,
          sectionComputedStyle,
        });
      }
    };

    const handleDoubleClick = (event: MouseEvent) => {
      if (selectionEnabled) return;
      event.preventDefault();
      event.stopPropagation();
      postPreviewToEditorMessage({
        type: "morph:storefront-preview-reset-canvas",
      });
    };

    const handleDragStart = (event: DragEvent) => {
      if (!selectionEnabled || !selectedElement) {
        event.preventDefault();
        return;
      }
      const identity = reorderIdentity(selectedElement);
      const dragOrigin =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(
              '[data-storefront-editor-drag-handle="true"]',
            )
          : null;
      if (!identity || dragOrigin !== selectedDragHandle) {
        event.preventDefault();
        return;
      }
      document.documentElement.setAttribute(
        "data-storefront-editor-reordering",
        "true",
      );
      reorderGesture = {
        kind: identity.kind,
        dragged: selectedElement,
        parent: identity.parent,
        sectionId: identity.sectionId,
        sourceFilePath: identity.sourceFilePath,
        draggedNodeId: identity.nodeId,
        draggedFieldPath: identity.fieldPath,
        arrayPath: identity.arrayPath,
        target: null,
        targetNodeId: null,
        targetFieldPath: null,
      };
      hoveredItem = null;
      hoverOverlay.style.display = "none";
      showReorderCandidates();
      event.dataTransfer?.setData(
        "text/plain",
        identity.fieldPath ?? identity.nodeId ?? "",
      );
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        const dragPreview = createDragPreview(
          selectedElement,
          selectedItem?.label ?? "Selected component",
        );
        event.dataTransfer.setDragImage(dragPreview, 20, 18);
      }
    };

    const handleDragOver = (event: DragEvent) => {
      if (!reorderGesture) return;
      const target = directReorderTarget(event.target);
      if (!target) {
        reorderGesture.target = null;
        reorderGesture.targetNodeId = null;
        reorderGesture.targetFieldPath = null;
        positionReorderTarget(null);
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      reorderGesture.target = target.element;
      reorderGesture.targetNodeId = target.identity.nodeId;
      reorderGesture.targetFieldPath = target.identity.fieldPath;
      positionReorderTarget(target.element);
    };

    const handleDrop = (event: DragEvent) => {
      if (!reorderGesture) return;
      event.preventDefault();
      event.stopPropagation();
      const gesture = reorderGesture;
      const target = directReorderTarget(event.target);
      reorderGesture = null;
      clearReorderFeedback();
      suppressNextClick = true;
      if (!target) return;

      const marker = document.createComment("morph-reorder");
      gesture.dragged.replaceWith(marker);
      target.element.replaceWith(gesture.dragged);
      marker.replaceWith(target.element);
      if (
        gesture.kind === "array" &&
        gesture.draggedFieldPath &&
        target.identity.fieldPath
      ) {
        gesture.dragged.dataset.storefrontFieldPath = target.identity.fieldPath;
        target.element.dataset.storefrontFieldPath = gesture.draggedFieldPath;
      }
      selectedElement = gesture.dragged;
      selectedItem = resolveSelectable(gesture.dragged);
      syncSelectedDraggable();
      positionOverlays();

      if (
        gesture.kind === "array" &&
        gesture.draggedFieldPath &&
        target.identity.fieldPath
      ) {
        postPreviewToEditorMessage({
          type: "morph:storefront-preview-commit-array-item-reorder",
          sectionId: gesture.sectionId,
          draggedFieldPath: gesture.draggedFieldPath,
          targetFieldPath: target.identity.fieldPath,
        });
      } else if (
        gesture.draggedNodeId &&
        target.identity.kind === "source" &&
        target.identity.nodeId
      ) {
        postPreviewToEditorMessage({
          type: "morph:storefront-preview-commit-sibling-reorder",
          sectionId: gesture.sectionId,
          sourceFilePath: gesture.sourceFilePath,
          draggedNodeId: gesture.draggedNodeId,
          targetNodeId: target.identity.nodeId,
        });
      }
    };

    const handleDragEnd = () => {
      reorderGesture = null;
      clearReorderFeedback();
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      postPreviewToEditorMessage({
        type: "morph:storefront-preview-wheel",
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        clientX: event.clientX,
        clientY: event.clientY,
      });
    };

    const restoreSelectedSection = () => {
      selectedElement?.removeAttribute("data-storefront-editor-selected");
      hideSelectedDragHandle();
      clearReorderFeedback();
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
      syncSelectedDraggable();
    };

    const restoreSelectedTarget = (
      target: PreviewSelectionRestoreTarget,
    ) => {
      selectedElement?.removeAttribute("data-storefront-editor-selected");
      hideSelectedDragHandle();
      clearReorderFeedback();
      selectedSectionId = target.sectionId;

      const section = document.querySelector<HTMLElement>(
        `[data-storefront-section-id="${CSS.escape(target.sectionId)}"], [data-morph-section="${CSS.escape(target.sectionId)}"]`,
      );
      if (!section) {
        selectedElement = null;
        selectedItem = null;
        positionOverlays();
        syncSelectedDraggable();
        return;
      }

      const nextElement = resolvePreviewSelectionRestoreElement(section, target);

      selectedElement = nextElement;
      selectedElement.setAttribute("data-storefront-editor-selected", "true");
      selectedItem = resolveSelectable(nextElement);
      if (selectedItem) {
        selectedItem = {
          ...selectedItem,
          fieldPath: target.fieldPath ?? selectedItem.fieldPath,
          fieldKey: target.fieldKey ?? selectedItem.fieldKey,
        };
      }
      positionOverlays();
      syncSelectedDraggable();
    };

    const handleEditorMessage = (event: MessageEvent<unknown>) => {
      const message = parseEditorToPreviewWindowEvent(event);
      if (!message) return;

      if (
        message.type ===
        "morph:storefront-preview-reset-selection-style-preview"
      ) {
        selectionStylePreview.restore();
        positionOverlays();
        return;
      }

      if (
        message.type === "morph:storefront-preview-set-selection-field-path" &&
        selectedItem?.sectionId === message.sectionId
      ) {
        selectedItem = {
          ...selectedItem,
          fieldPath: message.fieldPath,
        };
        return;
      }

      if (
        message.type === "morph:storefront-preview-update-selection-field" &&
        selectedItem
      ) {
        const scope = selectedItem.section ?? document;
        const fieldPath = message.fieldPath;
        const target =
          (fieldPath
            ? scope.querySelector<HTMLElement>(
                `[data-storefront-field-path="${CSS.escape(fieldPath)}"]`,
              )
            : null) ??
          scope.querySelector<HTMLElement>(
            `[data-storefront-field="${CSS.escape(message.fieldKey)}"]`,
          ) ??
          (selectedItem.fieldKey === message.fieldKey
            ? selectedItem.element
            : null);
        if (!target) return;
        if (message.fieldKey === "imageSrc") {
          target.setAttribute("src", message.value);
        } else if (message.fieldKey === "imageAlt") {
          target.setAttribute("alt", message.value);
        } else if (message.fieldKey === "actionHref") {
          target.setAttribute("href", message.value);
        } else {
          target.textContent = message.value;
        }
        positionOverlays();
        return;
      }

      if (
        message.type === "morph:storefront-preview-update-selection-style" &&
        selectedItem?.element
      ) {
        const targetKey = message.targetElement;
        const scope = selectedItem.section ?? document;
        const selectedElementMatchesTarget =
          selectedItem.elementKey === targetKey ||
          selectedItem.element.dataset.morphNode === targetKey ||
          selectedItem.element.dataset.morphElement === targetKey;
        const previewTarget =
          targetKey === "section" || targetKey === "root"
            ? (selectedItem.section ?? selectedItem.element)
            : selectedElementMatchesTarget
              ? selectedItem.element
              : scope.querySelector<HTMLElement>(
                  `[data-morph-node="${CSS.escape(targetKey)}"], [data-morph-element="${CSS.escape(targetKey)}"], [data-storefront-field="${CSS.escape(targetKey)}"]`,
                );
        if (!previewTarget) return;
        const previewStyles = message.styles;
        selectionStylePreview.apply(previewTarget, previewStyles);
        if (selectionStylePreviewNeedsOverlayUpdate(previewStyles)) {
          positionOverlays();
        }
        return;
      }

      if (PREVIEW_GEOMETRY_MUTATION_MESSAGES.has(message.type)) {
        overlaySettler?.freezeUntilSettled();
        return;
      }

      if (message.type === "morph:storefront-preview-request-selection-style") {
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
          postPreviewToEditorMessage({
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
          });
        }
        return;
      }

      if (message.type === "morph:storefront-preview-set-selection-mode") {
        selectionEnabled = message.enabled;
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
        if (message.restoreTarget) {
          restoreSelectedTarget(message.restoreTarget);
        } else {
          restoreSelectedSection();
        }
        return;
      }

      if (message.type !== "morph:storefront-preview-set-section") {
        return;
      }

      selectedSectionId = message.sectionId;
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
    document.addEventListener("dragover", handleDragOver, true);
    document.addEventListener("drop", handleDrop, true);
    document.addEventListener("dragend", handleDragEnd, true);
    document.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: false,
    });
    window.addEventListener("scroll", schedulePositionOverlays, true);
    window.addEventListener("resize", schedulePositionOverlays);
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
      document.removeEventListener("dragover", handleDragOver, true);
      document.removeEventListener("drop", handleDrop, true);
      document.removeEventListener("dragend", handleDragEnd, true);
      document.removeEventListener("wheel", handleWheel, true);
      window.removeEventListener("scroll", schedulePositionOverlays, true);
      window.removeEventListener("resize", schedulePositionOverlays);
      cancelAnimationFrame(overlayPositionFrame);
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
      clearReorderFeedback();
      style.remove();
      hoverOverlay.remove();
      selectedOverlay.remove();
      reorderTargetOverlay.remove();
      reorderCandidateLayer.remove();
      hideSelectedDragHandle();
      selectedElement?.removeAttribute("data-storefront-editor-selected");
    };
  }, [enabled]);
}

function usePreviewViewportHeight(initialHeight: number) {
  const [viewportHeight, setViewportHeight] = useState(initialHeight);

  useEffect(() => {
    const handleViewportHeight = (event: MessageEvent<unknown>) => {
      const message = parseEditorToPreviewWindowEvent(event);
      if (
        message?.type !== "morph:storefront-preview-set-viewport-height" ||
        message.height < 320 ||
        message.height > 2160
      )
        return;

      setViewportHeight(Math.round(message.height));
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
        postPreviewToEditorMessage({
          type: "morph:storefront-preview-size",
          height: nextHeight,
        });
      });
    };

    const observer = new ResizeObserver(() => {
      stableFrameCount = 0;
      measureUntilStable();
    });
    observer.observe(previewRoot);
    const handleSizeRequest = (event: MessageEvent<unknown>) => {
      const message = parseEditorToPreviewWindowEvent(event);
      if (message?.type === "morph:storefront-preview-request-size") {
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
