import { domElementMatchesTarget } from "@/lib/storefront/ast/element-target";
import { shouldDeferUndoShortcut } from "@/lib/storefront/editor/editor-history";
import { StorefrontPreview } from "@/components/storefront/storefront-preview";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { resolveEditorSectionModel } from "@/lib/storefront/editor/editor-section-model";
import { buildThemeRouteRegistry } from "@/lib/storefront/compiler/theme-route-registry";
import {
  deriveThemeLayoutSections,
  deriveThemeRouteSections,
} from "@/lib/storefront/compiler/theme-route-sections";
import { storefrontThemePreviewSearchSchema } from "@/lib/validations/storefront-theme";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { storefrontThemeQueries } from "../../../../-queries/storefront-theme.queries";

import { storefrontThemeFileQueries } from "../../../../-queries/storefront-theme-files.queries";
import {
  type ThemeCompilerApplication,
  useThemeCompiler,
} from "@/lib/storefront/compiler/use-theme-compiler";
import { createSelectionOverlaySettler } from "@/lib/storefront/editor/selection-overlay-settler";
import { createInlineTextEditor } from "@/lib/storefront/editor/inline-text-editor";
import { createPreviewSelectionOverlays } from "@/lib/storefront/editor/preview-selection-overlays";
import {
  buildSpacingOverlayStrips,
  cssPixelValue,
  formatSpacingOverlayValue,
  SPACING_OVERLAY_TARGET_SELECTOR,
  type PreviewSpacingOverlayMode,
  type SpacingOverlayKind,
  type SpacingOverlaySide,
  type SpacingOverlayStrip,
} from "@/lib/storefront/editor/spacing-overlay";
import {
  createSelectionStylePreview,
  SELECTION_STYLE_APPLIED_EVENT,
  selectionStylePreviewNeedsOverlayUpdate,
} from "@/lib/storefront/editor/selection-style-preview";
import {
  applyPreviewSectionProps,
  parseEditorToPreviewWindowEvent,
  postPreviewToEditorMessage,
  type PreviewSectionProps,
  type PreviewSelectionRestoreTarget,
} from "@/lib/storefront/editor/preview-protocol";
import {
  isCompatibleReorderTarget,
  reorderCommitFor,
  reorderIdentity,
} from "@/lib/storefront/editor/preview-reorder-identity";
import { startPreviewHeightReporter } from "@/lib/storefront/editor/preview-height-reporter";
import {
  PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE,
  syncPreviewEmptyTextLines,
} from "@/lib/storefront/editor/preview-empty-text-layout";

const PREVIEW_GEOMETRY_MUTATION_MESSAGES = new Set([
  "morph:storefront-preview-update-theme-files",
  "morph:storefront-preview-update-section-props",
  "morph:storefront-preview-set-section-order",
]);

import {
  PREVIEW_EDITABLE_NODE_SELECTOR,
  collectPreviewEditableNodes,
  previewSectionSelector,
  resolvePreviewSelectionRestoreElement,
  resolveSelectable,
  selectionKindOf,
  selectionMetadata,
  selectionStyleSnapshot,
  type SelectableInfo,
} from "@/lib/storefront/editor/preview-dom";

export {
  closestPreviewFieldElement,
  closestPreviewSectionRoot,
  collectEditableDescendantFields,
  collectPreviewEditableNodes,
  isPreviewSectionRoot,
  previewSectionIdOf,
  previewSectionSelector,
  PREVIEW_SECTION_ROOT_SELECTOR,
  resolvePreviewSelectionRestoreElement,
  selectionStyleSnapshot,
} from "@/lib/storefront/editor/preview-dom";
export const Route = createFileRoute(
  "/_editor/store/$storefrontId/themes/$themeId/preview",
)({
  validateSearch: storefrontThemePreviewSearchSchema,
  loader: async ({ context, params }) => {
    const detailQuery = storefrontThemeQueries.detail(
      params.storefrontId,
      params.themeId,
    );
    const filesQuery = storefrontThemeFileQueries.tree(
      params.storefrontId,
      params.themeId,
    );

    // Context can add catalog source. Read files only after provisioning so
    // the first preview cannot hydrate an obsolete route registry.
    const detail = await context.queryClient.ensureQueryData(detailQuery);
    await context.queryClient.fetchQuery(filesQuery).catch(() => undefined);
    return detail;
  },
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
      routePath={search.routePath}
      viewportHeight={viewportHeight}
    />
  );
}

function usePreviewNavigation(
  initialTemplateId: string,
  initialRoutePath?: string,
) {
  const resetPreviewScrollPosition = useCallback(() => {
    // The editor keeps this document mounted between route changes. Although
    // the editor normally owns scrolling, reset the iframe document as well so
    // a browser-restored scroll offset can never leak into the next route.
    if (typeof window.scrollTo === "function") {
      window.scrollTo(0, 0);
    }
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);
  const [navigation, setNavigation] = useState({
    templateId: initialTemplateId,
    routePath: initialRoutePath,
  });

  useEffect(() => {
    resetPreviewScrollPosition();
    setNavigation({
      templateId: initialTemplateId,
      routePath: initialRoutePath,
    });
  }, [initialRoutePath, initialTemplateId, resetPreviewScrollPosition]);

  useEffect(() => {
    const handleNavigationMessage = (event: MessageEvent<unknown>) => {
      const message = parseEditorToPreviewWindowEvent(event);
      if (message?.type !== "morph:storefront-preview-set-route") return;
      resetPreviewScrollPosition();
      setNavigation({
        templateId: message.templateId,
        routePath: message.routePath ?? undefined,
      });
    };

    window.addEventListener("message", handleNavigationMessage);
    return () => window.removeEventListener("message", handleNavigationMessage);
  }, [resetPreviewScrollPosition]);

  useEffect(() => {
    // Selection's capture handler prevents its clicks. Normal catalog links
    // stay inside the trusted preview shell instead of opening a Core route.
    const onCatalogLink = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        (anchor.target && anchor.target !== "_self")
      )
        return;
      const href = anchor.getAttribute("href") ?? "";
      if (!/^\/products(?:\/[a-z0-9-]+)?\/?(?:\?page=\d+)?$/.test(href)) return;
      event.preventDefault();
      resetPreviewScrollPosition();
      setNavigation((current) => ({ ...current, routePath: href }));
    };
    document.addEventListener("click", onCatalogLink);
    return () => document.removeEventListener("click", onCatalogLink);
  }, [resetPreviewScrollPosition]);

  return navigation;
}

function ReadyStorefrontPreview({
  context,
  templateId,
  routePath,
  viewportHeight,
}: {
  context: Parameters<typeof StorefrontPreview>[0]["context"];
  templateId: string;
  routePath?: string;
  viewportHeight: number;
}) {
  const navigation = usePreviewNavigation(templateId, routePath);
  const template = context.templates.find(
    (candidate) => candidate.id === navigation.templateId,
  );
  const activeRoutePath = navigation.routePath;
  const catalogUrl = new URL(activeRoutePath ?? "/", "https://preview.invalid");
  const catalogMatch = /^\/products(?:\/([^/]+))?\/?$/.exec(
    catalogUrl.pathname,
  );
  const catalogPage = Math.min(
    10000,
    Math.max(1, Number(catalogUrl.searchParams.get("page")) || 1),
  );
  const catalog = useQuery({
    ...storefrontCatalogQueries.preview(
      context.storefront.id,
      context.theme.id,
      catalogPage,
      catalogMatch?.[1],
    ),
    enabled: Boolean(catalogMatch),
  });
  const {
    themeFiles: previewThemeFiles,
    renderThemeFiles,
    sourceGeneration,
    styleRevision,
    acknowledgeStyleRevision,
  } = usePreviewThemeFiles(context.storefront.id, context.theme.id);
  const layoutTemplate = context.templates.find(
    (candidate) => candidate.type === "layout",
  );
  /**
   * What this page is made of, composed exactly as the editor composes it.
   *
   * The shell's sections have to be present by name, not merely rendered: the
   * editor pushes a live edit as "these are the new props for section X", and
   * a document without X to update drops the message silently. The header then
   * kept showing its old content while the panel showed the new, with nothing
   * anywhere reporting a problem.
   */
  const routeDocument = useMemo(() => {
    if (!template?.document) return template?.document;
    const registry = buildThemeRouteRegistry(renderThemeFiles);
    const route =
      activeRoutePath && registry.valid
        ? registry.routes.find(
            (candidate) =>
              candidate.kind === "route" && candidate.path === activeRoutePath,
          )
        : undefined;
    const derived = route
      ? deriveThemeRouteSections(renderThemeFiles, route.sourcePath)
      : null;
    // A route whose slots cannot be read leaves its stored sections standing,
    // which is what a theme that never adopted slots relies on.
    const pageOwnsStructure = Boolean(
      derived &&
      derived.diagnostics.length === 0 &&
      (derived.sections.length > 0 || derived.hasContentImport) &&
      derived.hasContentImport,
    );
    const pageSections =
      derived && derived.diagnostics.length === 0 ? derived.sections : [];
    const shell = deriveThemeLayoutSections(renderThemeFiles);
    return resolveEditorSectionModel({
      pageTemplate: { id: template.id, document: template.document },
      shellTemplate: layoutTemplate
        ? { id: layoutTemplate.id, document: layoutTemplate.document }
        : undefined,
      pageSections,
      pageOwnsStructure,
      shellSections: shell.diagnostics.length === 0 ? shell.sections : [],
    }).document;
  }, [
    activeRoutePath,
    layoutTemplate,
    renderThemeFiles,
    template?.document,
    template?.id,
  ]);
  const previewDocument = usePreviewDocument(routeDocument);

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
      {catalogMatch && !catalog.data ? (
        <div role="status" className="p-8 text-sm">
          {catalog.isError ? catalog.error.message : "Loading products…"}
        </div>
      ) : (
        <StorefrontPreview
          context={context}
          templateId={navigation.templateId}
          routePath={catalogUrl.pathname}
          viewportHeight={viewportHeight}
          document={previewDocument}
          themeFiles={renderThemeFiles}
          loaderData={catalogMatch ? catalog.data : undefined}
        />
      )}
    </>
  );
}

function usePreviewThemeFiles(storefrontId: string, themeId: string) {
  const fileQuery = useQuery(
    storefrontThemeFileQueries.tree(storefrontId, themeId),
  );
  const [themeFiles, setThemeFiles] = useState<
    Array<{ path: string; content: string }>
  >(() => fileQuery.data?.files ?? []);
  const [renderThemeFiles, setRenderThemeFiles] = useState<
    Array<{ path: string; content: string }>
  >(() => fileQuery.data?.files ?? []);
  const [sourceGeneration, setSourceGeneration] = useState<number | undefined>(
    undefined,
  );
  const [styleRevision, setStyleRevision] = useState<number | undefined>();
  const latestRequestedStyleRevisionRef = useRef<number | undefined>(undefined);
  const renderDocumentRef = useRef(true);
  const hasReceivedEditorFilesRef = useRef(false);

  useEffect(() => {
    if (hasReceivedEditorFilesRef.current) return;
    if (fileQuery.data?.files) {
      setThemeFiles(fileQuery.data.files);
      setRenderThemeFiles(fileQuery.data.files);
    }
    if (typeof fileQuery.data?.sourceGeneration === "number") {
      setSourceGeneration(fileQuery.data.sourceGeneration);
    }
  }, [fileQuery.data]);

  useEffect(() => {
    const handleThemeFileMessage = (event: MessageEvent<unknown>) => {
      const message = parseEditorToPreviewWindowEvent(event);
      if (!message) return;

      if (message.type === "morph:storefront-preview-ping") {
        postPreviewToEditorMessage({
          type: "morph:storefront-preview-pong",
          heartbeatId: message.heartbeatId,
        });
        return;
      }

      if (
        message.type === "morph:storefront-preview-update-theme-files" &&
        Array.isArray(message.files)
      ) {
        hasReceivedEditorFilesRef.current = true;
        setThemeFiles(message.files);
        renderDocumentRef.current = message.renderDocument !== false;
        if (message.renderDocument !== false) {
          setRenderThemeFiles(message.files);
        } else {
          // Compile and inject the new CSS while leaving the existing React
          // preview tree mounted. This keeps numeric inspector edits from
          // replacing the whole live canvas.
          setRenderThemeFiles((current) =>
            current.length === 0 ? message.files : current,
          );
        }
        latestRequestedStyleRevisionRef.current = message.styleRevision;
        setStyleRevision(message.styleRevision);
        if (typeof message.sourceGeneration === "number") {
          setSourceGeneration(message.sourceGeneration);
        }
      }
    };

    window.addEventListener("message", handleThemeFileMessage);
    return () => window.removeEventListener("message", handleThemeFileMessage);
  }, []);

  const acknowledgeStyleRevision = useCallback(
    (appliedRevision: number, didApplySource: boolean) => {
      if (latestRequestedStyleRevisionRef.current !== appliedRevision) return;
      if (didApplySource) {
        if (renderDocumentRef.current) {
          window.dispatchEvent(new Event(SELECTION_STYLE_APPLIED_EVENT));
        }
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
    renderThemeFiles,
    sourceGeneration,
    styleRevision,
    acknowledgeStyleRevision,
  };
}

function usePreviewDocument(document: StorefrontPageDocument | undefined) {
  const [previewDocument, setPreviewDocument] = useState(document);

  useLayoutEffect(() => {
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
          const applied = applyPreviewSectionProps(current, {
            sectionId,
            props: props as PreviewSectionProps | undefined,
            enabled: typeof enabled === "boolean" ? enabled : undefined,
          });
          if (!applied.matched) {
            // The editor and the preview disagree about what is on this page.
            // Saying so is the difference between a bug that is found and one
            // that presents as "the canvas just does not update".
            console.warn(
              `[morph] Live content update for section "${sectionId}" was dropped: the previewed page has no such section.`,
            );
          }
          return applied.document;
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
      [${PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE}]::before {
        content: "\\00a0";
      }
      [${PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE}][data-storefront-editor-inline-editing="true"]::before {
        content: none;
      }
      [data-storefront-editor-inline-editing="true"] {
        cursor: text !important;
        user-select: text !important;
        /* The editor already draws its own ring and badge around this element,
           so the browser's focus outline is a second border on top of it — and
           it follows the Theme's own border-radius, which is why it showed up
           as a stray rounded line around a heading with rounded corners.
           Focus stays visible; it is the editor drawing it rather than the UA. */
        outline: none !important;
        box-shadow: none !important;
      }
    `;
    document.head.appendChild(style);

    const overlays = createPreviewSelectionOverlays();
    const selectedDragHandle = overlays.dragHandle;
    const toOverlayItem = (item: SelectableInfo | null) =>
      item
        ? {
            element: item.element,
            label: item.label,
            tagName: item.tagName,
            kind: selectionKindOf(item),
          }
        : null;

    const spacingOverlayLayer = document.createElement("div");
    spacingOverlayLayer.setAttribute("aria-hidden", "true");
    spacingOverlayLayer.dataset.storefrontEditorSpacingOverlay = "true";
    Object.assign(spacingOverlayLayer.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483643",
      overflow: "hidden",
      pointerEvents: "none",
    });
    document.body.appendChild(spacingOverlayLayer);

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

    let hoveredItem: SelectableInfo | null = null;
    let selectedItem: SelectableInfo | null = null;
    let selectedElement: HTMLElement | null = null;
    let selectedSectionId: string | null = null;
    let selectionRevision = 0;
    /**
     * Last selection expressed as a restore target.
     *
     * Applying a style edit re-renders the Theme, which replaces the DOM node
     * the selection points at. Without re-resolving, the overlay tracks a
     * detached node and the selection outline silently vanishes.
     */
    let lastRestoreTarget: PreviewSelectionRestoreTarget | null = null;
    /**
     * Styles being previewed on the selected element, held until the edited
     * source is actually painted.
     *
     * Committing an edit re-renders the Theme, which drops the inline preview
     * from the element. The new class is present immediately but its generated
     * rule is not, so without re-applying these the element renders unstyled
     * for a moment and the value visibly jumps.
     */
    let selectionEnabled = false;
    let spacingOverlayMode: PreviewSpacingOverlayMode = "off";
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
    let wheelPostFrame = 0;
    let pendingWheel: {
      deltaY: number;
      deltaMode: number;
      ctrlKey: boolean;
      clientX: number;
      clientY: number;
    } | null = null;
    let dragPreviewElement: HTMLElement | null = null;
    let reorderCandidateOverlays: Array<{
      element: HTMLElement;
      overlay: HTMLElement;
    }> = [];
    let reorderGesture: {
      kind: "source" | "array" | "section";
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
    type SpacingOverlayVisual = {
      root: HTMLElement;
      strips: Map<string, HTMLElement>;
    };
    type SpacingOverlayMeasurement = {
      element: HTMLElement;
      strips: SpacingOverlayStrip[];
      showLabels: boolean;
    };
    const spacingOverlayVisuals = new Map<HTMLElement, SpacingOverlayVisual>();
    let structurePublishFrame = 0;
    let lastStructureSignature = "";

    /**
     * Re-attaches the selection after a re-render replaced its element.
     *
     * Runs only when the held node has actually left the document, so ordinary
     * mutations never disturb an in-progress interaction.
     */
    const reattachSelectionIfDetached = () => {
      if (!lastRestoreTarget) return;
      if (selectedElement && selectedElement.isConnected) return;
      restoreSelectedTarget(lastRestoreTarget);
      // Carry the preview onto the element the re-render produced, so the value
      // stays put until the edited source is painted.
      if (selectedElement) selectionStylePreview.carryTo(selectedElement);
    };

    const publishEditableStructure = () => {
      structurePublishFrame = 0;
      const nodes = collectPreviewEditableNodes(document);
      const signature = JSON.stringify(nodes);
      if (signature === lastStructureSignature) return;
      lastStructureSignature = signature;
      postPreviewToEditorMessage({
        type: "morph:storefront-preview-structure",
        nodes,
      });
    };

    const scheduleEditableStructure = () => {
      if (structurePublishFrame) return;
      structurePublishFrame = requestAnimationFrame(publishEditableStructure);
    };

    const spacingSides: readonly SpacingOverlaySide[] = [
      "top",
      "right",
      "bottom",
      "left",
    ];
    const spacingKinds: readonly SpacingOverlayKind[] = ["margin", "padding"];

    const createSpacingOverlayVisual = (): SpacingOverlayVisual => {
      const root = document.createElement("div");
      Object.assign(root.style, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
      });
      const strips = new Map<string, HTMLElement>();
      spacingKinds.forEach((kind) => {
        spacingSides.forEach((side) => {
          const strip = document.createElement("div");
          strip.dataset.spacingKind = kind;
          strip.dataset.spacingSide = side;
          Object.assign(strip.style, {
            position: "absolute",
            display: "none",
            boxSizing: "border-box",
            pointerEvents: "none",
          });
          const label = document.createElement("span");
          label.dataset.spacingLabel = "true";
          Object.assign(label.style, {
            position: "absolute",
            left: "50%",
            top: "50%",
            zIndex: "1",
            display: "none",
            transform: "translate(-50%, -50%)",
            padding: "2px 4px",
            borderRadius: "3px",
            background: "oklch(42% 0.2 302 / 0.94)",
            color: "oklch(98% 0.01 302)",
            boxShadow: "0 1px 3px oklch(18% 0.03 302 / 0.28)",
            font: "600 9px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            letterSpacing: "0.01em",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          });
          strip.appendChild(label);
          root.appendChild(strip);
          strips.set(`${kind}-${side}`, strip);
        });
      });
      spacingOverlayLayer.appendChild(root);
      return { root, strips };
    };

    const clearSpacingOverlays = () => {
      spacingOverlayVisuals.forEach(({ root }) => root.remove());
      spacingOverlayVisuals.clear();
    };

    const spacingOverlayTargets = (): HTMLElement[] => {
      if (spacingOverlayMode === "off") return [];
      if (spacingOverlayMode === "selected") {
        return selectedItem?.element ? [selectedItem.element] : [];
      }

      const targets = Array.from(
        document.querySelectorAll<HTMLElement>(SPACING_OVERLAY_TARGET_SELECTOR),
      );
      if (selectedItem?.element && !targets.includes(selectedItem.element)) {
        targets.unshift(selectedItem.element);
      }
      return targets.slice(0, 160);
    };

    const measureSpacingOverlays = (): SpacingOverlayMeasurement[] =>
      spacingOverlayTargets().flatMap((element) => {
        if (!document.body.contains(element)) return [];
        const bounds = element.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) return [];
        const computed = window.getComputedStyle(element);
        if (computed.display === "none" || computed.visibility === "hidden") {
          return [];
        }
        const strips = buildSpacingOverlayStrips(
          {
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
          },
          {
            margin: {
              top: cssPixelValue(computed.marginTop),
              right: cssPixelValue(computed.marginRight),
              bottom: cssPixelValue(computed.marginBottom),
              left: cssPixelValue(computed.marginLeft),
            },
            padding: {
              top: cssPixelValue(computed.paddingTop),
              right: cssPixelValue(computed.paddingRight),
              bottom: cssPixelValue(computed.paddingBottom),
              left: cssPixelValue(computed.paddingLeft),
            },
            border: {
              top: cssPixelValue(computed.borderTopWidth),
              right: cssPixelValue(computed.borderRightWidth),
              bottom: cssPixelValue(computed.borderBottomWidth),
              left: cssPixelValue(computed.borderLeftWidth),
            },
          },
        );
        if (strips.length === 0) return [];
        return [
          {
            element,
            strips,
            showLabels:
              element === selectedItem?.element ||
              element === hoveredItem?.element,
          },
        ];
      });

    const renderSpacingOverlays = (
      measurements: SpacingOverlayMeasurement[],
    ) => {
      const activeElements = new Set(
        measurements.map((measurement) => measurement.element),
      );
      spacingOverlayVisuals.forEach((visual, element) => {
        if (activeElements.has(element)) return;
        visual.root.remove();
        spacingOverlayVisuals.delete(element);
      });

      measurements.forEach(({ element, strips, showLabels }) => {
        const visual =
          spacingOverlayVisuals.get(element) ?? createSpacingOverlayVisual();
        spacingOverlayVisuals.set(element, visual);
        visual.strips.forEach((strip) => {
          strip.style.display = "none";
        });
        strips.forEach((measurement) => {
          const strip = visual.strips.get(
            `${measurement.kind}-${measurement.side}`,
          );
          if (!strip) return;
          const isMargin = measurement.kind === "margin";
          Object.assign(strip.style, {
            display: "block",
            left: `${measurement.rect.left}px`,
            top: `${measurement.rect.top}px`,
            width: `${measurement.rect.width}px`,
            height: `${measurement.rect.height}px`,
            background: isMargin
              ? "repeating-linear-gradient(135deg, oklch(62% 0.22 302 / 0.46) 0 1px, oklch(62% 0.22 302 / 0.1) 1px 6px)"
              : "repeating-linear-gradient(135deg, oklch(76% 0.15 302 / 0.4) 0 1px, oklch(76% 0.15 302 / 0.1) 1px 6px)",
            outline: measurement.negative
              ? "1px dashed oklch(68% 0.24 25 / 0.82)"
              : `1px solid ${
                  isMargin
                    ? "oklch(62% 0.22 302 / 0.38)"
                    : "oklch(76% 0.15 302 / 0.34)"
                }`,
          });
          const label = strip.querySelector<HTMLElement>(
            "[data-spacing-label]",
          );
          if (!label) return;
          label.style.display = showLabels ? "block" : "none";
          label.textContent = `${isMargin ? "M" : "P"} ${measurement.side.charAt(0).toUpperCase()} ${formatSpacingOverlayValue(measurement.value)}`;
        });
      });
    };

    const emptyTextCandidateSelector = [
      PREVIEW_EDITABLE_NODE_SELECTOR,
      "h1, h2, h3, h4, h5, h6, p, blockquote, code, pre, label",
      `[${PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE}]`,
    ].join(",");

    /**
     * Keeps one real rendered line for every empty editable text element. The
     * marker only drives an editor-only pseudo-element, so content metadata and
     * persisted props continue to observe the authored empty string.
     */
    const syncEmptyTextLines = () => {
      const elements = Array.from(
        document.querySelectorAll<HTMLElement>(emptyTextCandidateSelector),
      );
      const candidates = elements.map((element) => {
        const selectable = resolveSelectable(element);
        return {
          element,
          kind:
            selectable?.element === element
              ? selectionKindOf(selectable)
              : ("container" as const),
        };
      });
      return syncPreviewEmptyTextLines(candidates);
    };

    const inlineEditor = createInlineTextEditor({
      onCommit: (commit) =>
        postPreviewToEditorMessage({
          type: "morph:storefront-preview-commit-inline-text",
          ...commit,
        }),
      onLayoutChanged: () => {
        syncEmptyTextLines();
        positionOverlays();
      },
    });
    const startInlineTextEdit = (item: SelectableInfo) =>
      inlineEditor.begin(
        { ...item, kind: selectionKindOf(item) },
        { selectionEnabled },
      );
    const finishInlineTextEdit = (commit: boolean) =>
      inlineEditor.finish(commit);

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
      const spacingMeasurements = measureSpacingOverlays();
      overlays.position({
        enabled: selectionEnabled,
        selected: toOverlayItem(selectedItem),
        hovered: toOverlayItem(hoveredItem),
        selectedFrozen: Boolean(overlaySettler?.isFrozen()),
        inlineEditing: inlineEditor.editingElement() === selectedItem?.element,
      });
      renderSpacingOverlays(spacingMeasurements);
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
            previewSectionSelector(selectedItem.sectionId),
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
      if (inlineEditor.editingElement()) return;
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
        event.target instanceof Node &&
        inlineEditor.editingElement()?.contains(event.target)
      ) {
        return;
      }
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
      // The gap a deleted component leaves behind is the one element here that
      // is not content to select: it is a report, and its only useful action is
      // getting the file back. Handled before selection so it works even while
      // selection is switched off.
      const missing =
        event.target instanceof Element
          ? event.target.closest("[data-morph-missing-component]")
          : null;
      const missingPath = missing?.getAttribute("data-morph-missing-component");
      if (missingPath) {
        event.preventDefault();
        event.stopPropagation();
        postPreviewToEditorMessage({
          type: "morph:storefront-preview-open-file-history",
          path: missingPath,
        });
        return;
      }
      if (
        event.target instanceof Node &&
        inlineEditor.editingElement()?.contains(event.target)
      ) {
        return;
      }
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
      selectionRevision += 1;

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
      if (
        previousSelectedElement &&
        previousSelectedElement !== selectable.element
      ) {
        selectionStylePreview.clear();
      }
      selectedElement = selectable.element;
      selectedItem = selectable;
      selectedSectionId = selectable.sectionId;
      // Recorded here too: a click is a selection the editor never sent us, so
      // without this a re-render right after clicking would have nothing to
      // re-attach to.
      lastRestoreTarget = selectable.sectionId
        ? {
            sectionId: selectable.sectionId,
            sourceLocation: selectable.sourceLocation ?? undefined,
            nodeId: selectable.element.dataset.morphNode ?? undefined,
            fieldPath: selectable.fieldPath ?? undefined,
            elementKey: selectable.elementKey ?? undefined,
            fieldKey: selectable.fieldKey ?? undefined,
            isSection: selectable.element === selectable.section,
          }
        : null;

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
          selectionRevision,
          componentType: selectable.type,
          nodeId: morphNodeId,
          sourceLocation: selectable.element.dataset.morphLoc ?? null,
          elementKey: selectable.elementKey,
          fieldKey: selectable.fieldKey,
          field:
            selectable.descendantFields.length > 0
              ? null
              : (selectable.fieldKey ?? selectable.elementKey),
          descendantFields: selectable.descendantFields,
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
      if (
        event.target instanceof Node &&
        inlineEditor.editingElement()?.contains(event.target)
      ) {
        return;
      }
      if (selectionEnabled) {
        event.preventDefault();
        event.stopPropagation();
        const selectable = resolveSelectable(event.target);
        if (selectable) startInlineTextEdit(selectable);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      postPreviewToEditorMessage({
        type: "morph:storefront-preview-reset-canvas",
      });
    };

    const handleDragStart = (event: DragEvent) => {
      if (inlineEditor.editingElement()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
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
      positionOverlays();
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
      // Sent on every move, including the ones where no drop target resolves:
      // reaching a section further down the page means dragging across the gap
      // between two of them.
      postPreviewToEditorMessage({
        type: "morph:storefront-preview-drag-autoscroll",
        phase: "move",
        clientX: event.clientX,
        clientY: event.clientY,
      });
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
      stopDragAutoScroll();
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

      const commit = reorderCommitFor(gesture, target.identity);
      if (commit) postPreviewToEditorMessage(commit);
    };

    const stopDragAutoScroll = () => {
      postPreviewToEditorMessage({
        type: "morph:storefront-preview-drag-autoscroll",
        phase: "end",
        clientX: 0,
        clientY: 0,
      });
    };

    const handleDragEnd = () => {
      reorderGesture = null;
      clearReorderFeedback();
      stopDragAutoScroll();
    };

    const publishPendingWheel = () => {
      wheelPostFrame = 0;
      const wheel = pendingWheel;
      pendingWheel = null;
      if (!wheel) return;

      postPreviewToEditorMessage({
        type: "morph:storefront-preview-wheel",
        ...wheel,
      });
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();

      // The editor moves the canvas with its own rAF-driven transform. Posting
      // every native wheel event can be much noisier than the display rate
      // (high-resolution trackpads commonly emit 100+ events per second), and
      // each message is parsed by several editor bridges. Sum the deltas and
      // forward one message per frame instead. Keep zoom gestures and scroll
      // gestures separate so a modifier change cannot combine two operations.
      if (
        pendingWheel &&
        (pendingWheel.ctrlKey !== event.ctrlKey ||
          pendingWheel.deltaMode !== event.deltaMode)
      ) {
        publishPendingWheel();
      }

      pendingWheel = {
        deltaY: (pendingWheel?.deltaY ?? 0) + event.deltaY,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        // For zooming, the most recent pointer location is the intended
        // anchor. For scrolling these values are ignored by the editor.
        clientX: event.clientX,
        clientY: event.clientY,
      };
      if (wheelPostFrame === 0) {
        wheelPostFrame = requestAnimationFrame(publishPendingWheel);
      }
    };

    const restoreSelectedSection = () => {
      const previousSelectedElement = selectedElement;
      selectedElement?.removeAttribute("data-storefront-editor-selected");
      hideSelectedDragHandle();
      clearReorderFeedback();
      if (selectionEnabled && selectedSectionId) {
        const sectionEl = document.querySelector<HTMLElement>(
          previewSectionSelector(selectedSectionId),
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
          selectedElement = null;
        }
      } else {
        selectedItem = null;
        selectedElement = null;
      }
      if (
        previousSelectedElement &&
        previousSelectedElement !== selectedElement
      ) {
        selectionStylePreview.clear();
      }
      positionOverlays();
      syncSelectedDraggable();
    };

    const restoreSelectedTarget = (target: PreviewSelectionRestoreTarget) => {
      const previousTarget = lastRestoreTarget;
      const targetChanged =
        !previousTarget ||
        previousTarget.sectionId !== target.sectionId ||
        previousTarget.sourceLocation !== target.sourceLocation ||
        previousTarget.nodeId !== target.nodeId ||
        previousTarget.fieldPath !== target.fieldPath ||
        previousTarget.elementKey !== target.elementKey ||
        previousTarget.fieldKey !== target.fieldKey ||
        previousTarget.isSection !== target.isSection;
      if (targetChanged) selectionStylePreview.clear();
      lastRestoreTarget = target;
      selectedElement?.removeAttribute("data-storefront-editor-selected");
      hideSelectedDragHandle();
      clearReorderFeedback();
      selectedSectionId = target.sectionId;

      const section = document.querySelector<HTMLElement>(
        previewSectionSelector(target.sectionId),
      );
      if (!section) {
        selectedElement = null;
        selectedItem = null;
        positionOverlays();
        syncSelectedDraggable();
        return;
      }

      const nextElement = resolvePreviewSelectionRestoreElement(
        section,
        target,
      );

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

      if (message.type === "morph:storefront-preview-request-structure") {
        lastStructureSignature = "";
        scheduleEditableStructure();
        return;
      }

      if (
        message.type ===
        "morph:storefront-preview-reset-selection-style-preview"
      ) {
        // Cleared as well as restored. The pending map exists to carry a
        // drag-time style across the re-render the edit causes; leaving it set
        // would re-apply the style the editor just asked to drop, the moment
        // anything re-renders — which is exactly what reversing an edit does.
        // Pins what is on screen now and carries it across the re-render the
        // incoming edit causes. Without it the element sits at its unstyled
        // size from the moment the new class lands until the stylesheet is
        // recompiled; the normal applied-styles path releases the pin a frame
        // after that, so the value only ever moves once.
        if (selectedElement) {
          selectionStylePreview.holdCurrentStyles(selectedElement);
        }
        return;
      }

      if (message.type === "morph:storefront-preview-set-spacing-overlay") {
        spacingOverlayMode = message.mode;
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
        const groupedImagePath =
          message.fieldKey === "image" && fieldPath?.endsWith(".alt")
            ? fieldPath.slice(0, -4)
            : null;
        const target =
          (fieldPath
            ? scope.querySelector<HTMLElement>(
                `[data-storefront-field-path="${CSS.escape(fieldPath)}"]`,
              )
            : null) ??
          (groupedImagePath
            ? scope.querySelector<HTMLElement>(
                `[data-storefront-field-path="${CSS.escape(groupedImagePath)}"]`,
              )
            : null) ??
          scope.querySelector<HTMLElement>(
            `[data-storefront-field="${CSS.escape(message.fieldKey)}"]`,
          ) ??
          (selectedItem.fieldKey === message.fieldKey
            ? selectedItem.element
            : null);
        if (!target) return;
        const mediaTarget =
          message.fieldKey === "image" ||
          message.fieldKey === "imageSrc" ||
          message.fieldKey === "imageAlt"
            ? target.matches("img,video,audio")
              ? target
              : (target.querySelector<HTMLElement>("img,video,audio") ?? target)
            : target;
        if (message.fieldKey === "image" && groupedImagePath) {
          mediaTarget.setAttribute("alt", message.value);
        } else if (message.fieldKey === "image") {
          mediaTarget.setAttribute("src", message.value);
        } else if (message.fieldKey === "imageSrc") {
          mediaTarget.setAttribute("src", message.value);
        } else if (message.fieldKey === "imageAlt") {
          mediaTarget.setAttribute("alt", message.value);
        } else if (message.fieldKey === "actionHref") {
          target.setAttribute("href", message.value);
        } else {
          target.textContent = message.value;
        }
        syncEmptyTextLines();
        positionOverlays();
        return;
      }

      if (
        message.type === "morph:storefront-preview-update-selection-style" &&
        selectedItem?.element
      ) {
        const targetKey = message.targetElement;
        const scope = selectedItem.section ?? document;
        // Shared with the AST patch and the Inspector so live feedback covers
        // exactly the elements those two can address.
        const selectedElementMatchesTarget =
          selectedItem.elementKey === targetKey ||
          domElementMatchesTarget(
            selectedItem.element,
            targetKey,
            message.sourceLocation,
          );
        const previewTarget =
          targetKey === "section" || targetKey === "root"
            ? (selectedItem.section ?? selectedItem.element)
            : selectedElementMatchesTarget
              ? selectedItem.element
              : scope.querySelector<HTMLElement>(
                  [
                    `[data-morph-node="${CSS.escape(targetKey)}"]`,
                    `[data-morph-element="${CSS.escape(targetKey)}"]`,
                    `[data-storefront-field="${CSS.escape(targetKey)}"]`,
                    ...(message.sourceLocation
                      ? [
                          `[data-morph-loc="${CSS.escape(message.sourceLocation)}"]`,
                        ]
                      : []),
                  ].join(","),
                );
        if (!previewTarget) return;
        const previewStyles = message.styles;
        selectionStylePreview.apply(previewTarget, previewStyles);
        if (selectionStylePreviewNeedsOverlayUpdate(previewStyles)) {
          syncEmptyTextLines();
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
            selectionRevision,
            componentType: selectedItem.type,
            sourceLocation: selectedItem.element.dataset.morphLoc ?? null,
            nodeId:
              selectedItem.element.getAttribute("data-morph-node") ||
              selectedItem.element.dataset.morphNode ||
              undefined,
            elementKey: selectedItem.elementKey,
            fieldKey: selectedItem.fieldKey,
            field:
              selectedItem.descendantFields.length > 0
                ? null
                : (selectedItem.fieldKey ?? selectedItem.elementKey),
            descendantFields: selectedItem.descendantFields,
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
        if (message.selectionRevision !== undefined) {
          selectionRevision = Math.max(
            selectionRevision,
            message.selectionRevision,
          );
        }
        if (!message.enabled) {
          finishInlineTextEdit(false);
          // Mode changes do not unmount this iframe. Restore any drag-time
          // inline styles now, otherwise the old image/layout can reappear
          // when Design becomes visible again.
          selectionStylePreview.clear();
        }
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

      if (message.selectionRevision !== undefined) {
        selectionRevision = Math.max(
          selectionRevision,
          message.selectionRevision,
        );
      }
      // A section-only command intentionally selects the section. A route
      // sync that needs to preserve a descendant must carry that target
      // explicitly; never infer it from a stale iframe-local selection.
      lastRestoreTarget = message.restoreTarget ?? null;
      selectedSectionId = message.sectionId;
      if (selectionEnabled && message.restoreTarget) {
        restoreSelectedTarget(message.restoreTarget);
      } else {
        restoreSelectedSection();
      }
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
    /**
     * Forwards the undo shortcut to the editor.
     *
     * The canvas is an iframe, so a key pressed here never reaches the editor's
     * own listener. Clicking an element to select it puts focus in here, which
     * is exactly when someone is most likely to press undo — without this the
     * shortcut works from the toolbar but appears dead from the keyboard.
     */
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "z"
      ) {
        return;
      }
      if (shouldDeferUndoShortcut(event.target as HTMLElement | null)) return;
      event.preventDefault();
      postPreviewToEditorMessage({
        type: "morph:storefront-preview-history-shortcut",
        direction: event.shiftKey ? "redo" : "undo",
      });
    };

    window.addEventListener("keydown", handleHistoryShortcut);
    window.addEventListener("message", handleEditorMessage);
    // Announce readiness only after the selection listener exists. The Theme
    // source bridge lives in a child tree, whose passive effect can run before
    // this outer bridge; announcing there let the editor restore its active
    // tool into a listener gap and left the toolbar and canvas out of sync.
    postPreviewToEditorMessage({ type: "morph:storefront-preview-ready" });
    /**
     * Clears the drag-time inline styles one frame after the source styles land.
     *
     * Removing them in the same frame can expose the previous value: the new
     * class is already on the element, but the stylesheet rule for it may not
     * have been generated yet, so the element briefly renders at its old size
     * before snapping to the edited one. Waiting a frame lets the new rule take
     * effect first, so the value only ever moves once.
     */
    const handleSelectionStyleApplied = () => {
      requestAnimationFrame(() => selectionStylePreview.clear());
    };

    window.addEventListener(
      SELECTION_STYLE_APPLIED_EVENT,
      handleSelectionStyleApplied,
    );
    const structureObserver = new MutationObserver((mutations) => {
      if (inlineEditor.editingElement()?.isConnected === false) {
        finishInlineTextEdit(false);
      }
      if (
        inlineEditor.editingElement() &&
        mutations.every(
          (mutation) =>
            mutation.target === inlineEditor.editingElement() ||
            inlineEditor.editingElement()?.contains(mutation.target),
        )
      ) {
        // Typing is intentionally DOM-local until commit. The input handler
        // already moves the overlay; rescanning the whole preview structure on
        // every character would turn one contenteditable keystroke into O(DOM).
        return;
      }
      // Re-attach synchronously: publishing the structure is throttled to a
      // frame, and waiting that long leaves the element unstyled for one paint.
      reattachSelectionIfDetached();
      if (syncEmptyTextLines()) schedulePositionOverlays();
      scheduleEditableStructure();
    });
    syncEmptyTextLines();
    structureObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "data-morph-node",
        "data-morph-element",
        "data-storefront-component",
        "data-storefront-field",
        "data-storefront-field-path",
        "data-storefront-section-id",
      ],
    });
    scheduleEditableStructure();

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
      cancelAnimationFrame(wheelPostFrame);
      wheelPostFrame = 0;
      pendingWheel = null;
      window.removeEventListener("scroll", schedulePositionOverlays, true);
      window.removeEventListener("resize", schedulePositionOverlays);
      cancelAnimationFrame(overlayPositionFrame);
      window.removeEventListener("keydown", handleHistoryShortcut);
      window.removeEventListener("message", handleEditorMessage);
      window.removeEventListener(
        SELECTION_STYLE_APPLIED_EVENT,
        handleSelectionStyleApplied,
      );
      structureObserver.disconnect();
      cancelAnimationFrame(structurePublishFrame);
      selectionStylePreview.restore();
      finishInlineTextEdit(false);
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
      overlays.dispose();
      reorderTargetOverlay.remove();
      reorderCandidateLayer.remove();
      clearSpacingOverlays();
      spacingOverlayLayer.remove();
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
    return (
      startPreviewHeightReporter({
        resolveRoot: () =>
          document.querySelector<HTMLElement>("[data-storefront-preview-root]"),
      }) ?? undefined
    );
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
import { storefrontCatalogQueries } from "@/routes/_editor/-queries/storefront-catalog.queries";
