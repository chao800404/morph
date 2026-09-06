import {
  domElementMatchesTarget,
  sourceLocationKey,
} from "@/lib/storefront/ast/element-target";
import { shouldDeferUndoShortcut } from "@/lib/storefront/editor/editor-history";
import { StorefrontPreview } from "@/components/storefront/storefront-preview";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { buildThemeRouteRegistry } from "@/lib/storefront/compiler/theme-route-registry";
import {
  deriveThemeRouteSections,
  mergeDocumentWithRouteSections,
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
import {
  selectionKindFromElement,
  type EditableDescendantField,
} from "@/lib/storefront/editor/selection-taxonomy";
import { createSelectionOverlaySettler } from "@/lib/storefront/editor/selection-overlay-settler";
import {
  isSelectionOverlayTextFallbackCandidate,
  selectionOverlayGeometry,
  type SelectionOverlayBounds,
  INLINE_EDIT_OUTSET_PX,
  outsetOverlayBounds,
} from "@/lib/storefront/editor/selection-overlay-geometry";
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
  parseEditorToPreviewWindowEvent,
  postPreviewToEditorMessage,
  type PreviewEditableNode,
  type PreviewSelectionRestoreTarget,
  type PreviewStyleSnapshot,
} from "@/lib/storefront/editor/preview-protocol";
import { parseArrayItemFieldPath } from "@/lib/storefront/editor/reorder-array-items";
import { readSelectionContentValue } from "@/lib/storefront/editor/selection-content-value";
import {
  PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE,
  syncPreviewEmptyTextLines,
} from "@/lib/storefront/editor/preview-empty-text-layout";
import {
  INLINE_TEXT_EDIT_MAX_LENGTH,
  isInlineTextEditCandidate,
  normalizeInlineTextEditValue,
  shouldNormalizeInlineTextInput,
} from "@/lib/storefront/editor/inline-text-edit";

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
  const sourceLocationSelector = target.sourceLocation
    ? `[data-morph-loc="${CSS.escape(target.sourceLocation)}"]`
    : null;
  const selectorWithSourceLocation = (selector: string) =>
    sourceLocationSelector ? `${selector}${sourceLocationSelector}` : null;
  const selectors = [
    // A source location can be stale while the preview is being replaced. Use
    // it to disambiguate an authored identity first, but never let it override
    // a field/node identity and select an adjacent wrapper instead.
    target.nodeId && target.fieldPath
      ? selectorWithSourceLocation(
          `[data-morph-node="${CSS.escape(target.nodeId)}"][data-storefront-field-path="${CSS.escape(target.fieldPath)}"]`,
        )
      : null,
    target.fieldPath
      ? selectorWithSourceLocation(
          `[data-storefront-field-path="${CSS.escape(target.fieldPath)}"]`,
        )
      : null,
    target.nodeId
      ? selectorWithSourceLocation(
          `[data-morph-node="${CSS.escape(target.nodeId)}"]`,
        )
      : null,
    target.elementKey
      ? selectorWithSourceLocation(
          `[data-morph-element="${CSS.escape(target.elementKey)}"]`,
        )
      : null,
    target.fieldKey
      ? selectorWithSourceLocation(
          `[data-storefront-field="${CSS.escape(target.fieldKey)}"]`,
        )
      : null,
    target.nodeId && target.fieldPath
      ? `[data-morph-node="${CSS.escape(target.nodeId)}"][data-storefront-field-path="${CSS.escape(target.fieldPath)}"]`
      : null,
    target.fieldPath
      ? `[data-storefront-field-path="${CSS.escape(target.fieldPath)}"]`
      : null,
    target.nodeId ? `[data-morph-node="${CSS.escape(target.nodeId)}"]` : null,
    target.elementKey
      ? `[data-morph-element="${CSS.escape(target.elementKey)}"]`
      : null,
    target.fieldKey
      ? `[data-storefront-field="${CSS.escape(target.fieldKey)}"]`
      : null,
    sourceLocationSelector,
  ].filter((selector): selector is string => selector !== null);
  for (const selector of selectors) {
    const match = section.querySelector<HTMLElement>(selector);
    if (match) return match;
  }
  return section;
}

const PREVIEW_EDITABLE_NODE_SELECTOR = [
  "[data-morph-node]",
  "[data-storefront-field-path]",
  "[data-storefront-field]",
  // Compile-time source positions make any authored element selectable, so a
  // component works in the editor without hand-written identity markers.
  "[data-morph-loc]",
].join(",");

/**
 * Elements that act as a selectable section root.
 *
 * `data-storefront-section-id` is injected when a component resolves to a
 * Document section. `data-morph-section` is authored in the component's own
 * source, so a component added purely in code is selectable without being
 * registered in the manifest or given a Document section first.
 */
export const PREVIEW_SECTION_ROOT_SELECTOR =
  // Over-selects on purpose: every candidate is still filtered by
  // `isPreviewSectionRoot`, which decides whether it really starts a section.
  "[data-storefront-section-id],[data-morph-section],[data-morph-component]";

/** Section identity, preferring the Document binding when both are present. */
export function previewSectionIdOf(element: HTMLElement): string | undefined {
  return (
    element.dataset.storefrontSectionId ??
    element.dataset.morphSection ??
    // Falls back to the component's own source file, so a component with no
    // authored markers still has a stable section identity.
    element.dataset.morphSourceFile ??
    undefined
  );
}

/**
 * Whether an element acts as a section root.
 *
 * A Document-bound section always is. An authored `data-morph-section` only
 * counts outside a Document section: treating a nested one as its own root
 * would cut its children out of the enclosing section and leave them
 * unselectable.
 */
export function isPreviewSectionRoot(element: HTMLElement): boolean {
  if (element.dataset.storefrontSectionId) return true;
  if (element.dataset.morphSection) {
    return !element.parentElement?.closest("[data-storefront-section-id]");
  }
  // The preview renderer marks the root element of every component it renders,
  // which is exactly where one component's markup ends and another's begins.
  // Deriving this from source-file changes instead would also match a route's
  // own markup, and that outer element would then absorb every component
  // nested inside it.
  if (!element.dataset.morphComponent) return false;
  return !element.parentElement?.closest("[data-storefront-section-id]");
}

export function closestPreviewSectionRoot(
  element: HTMLElement,
): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current) {
    if (isPreviewSectionRoot(current)) return current;
    current = current.parentElement;
  }
  return null;
}

export function previewSectionSelector(sectionId: string): string {
  const escaped = CSS.escape(sectionId);
  return [
    `[data-storefront-section-id="${escaped}"]`,
    `[data-morph-section="${escaped}"]`,
    // A component with no authored markers is identified by its source file.
    `[data-morph-source-file="${escaped}"]`,
  ].join(",");
}

function previewEditableNodeLabel(element: HTMLElement): string {
  const fieldPath = element.dataset.storefrontFieldPath ?? "";
  const rawLabel =
    element.dataset.morphElement ??
    element.dataset.storefrontComponent ??
    element.dataset.storefrontField ??
    element.dataset.morphNode ??
    element.tagName.toLowerCase();
  const label = rawLabel
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (character) => character.toUpperCase());
  const pathSegments = fieldPath.split(".");
  const lastSegment = pathSegments.at(-1);
  const resolvedLabel = label || element.tagName.toLowerCase();
  return (
    /^\d+$/.test(lastSegment ?? "")
      ? `${resolvedLabel} ${Number(lastSegment) + 1}`
      : resolvedLabel
  ).slice(0, 200);
}

export function collectPreviewEditableNodes(root: {
  querySelectorAll<T extends Element = Element>(
    selectors: string,
  ): NodeListOf<T>;
}): PreviewEditableNode[] {
  const nodes: PreviewEditableNode[] = [];
  const nodeIds = new Set<string>();
  const sections = root.querySelectorAll<HTMLElement>(
    PREVIEW_SECTION_ROOT_SELECTOR,
  );

  for (const section of sections) {
    if (!isPreviewSectionRoot(section)) continue;
    // Components nest by nature, so a nested component root stays its own
    // section and simply owns fewer elements. Only Document sections are
    // flattened, because a Document section inside another would double-count
    // the same content.
    if (
      section.dataset.storefrontSectionId &&
      section.parentElement?.closest("[data-storefront-section-id]")
    ) {
      continue;
    }
    const sectionId = previewSectionIdOf(section);
    if (!sectionId || sectionId.length > 100) continue;
    const candidates = Array.from(
      section.querySelectorAll<HTMLElement>(PREVIEW_EDITABLE_NODE_SELECTOR),
    ).filter((candidate) => closestPreviewSectionRoot(candidate) === section);
    const morphNodeCounts = new Map<string, number>();
    const fieldKeyCounts = new Map<string, number>();
    const sourceLocationCounts = new Map<string, number>();
    for (const candidate of candidates) {
      const morphNode = candidate.dataset.morphNode;
      const fieldKey = candidate.dataset.storefrontField;
      const sourceLocation = candidate.dataset.morphLoc;
      if (sourceLocation) {
        sourceLocationCounts.set(
          sourceLocation,
          (sourceLocationCounts.get(sourceLocation) ?? 0) + 1,
        );
      }
      if (morphNode) {
        morphNodeCounts.set(
          morphNode,
          (morphNodeCounts.get(morphNode) ?? 0) + 1,
        );
      }
      if (fieldKey) {
        fieldKeyCounts.set(fieldKey, (fieldKeyCounts.get(fieldKey) ?? 0) + 1);
      }
    }

    const elementNodeIds = new Map<HTMLElement, string>();
    for (const candidate of candidates) {
      if (nodes.length >= 500) return nodes;
      const nodeId = candidate.dataset.morphNode;
      const fieldPath = candidate.dataset.storefrontFieldPath;
      const fieldKey = candidate.dataset.storefrontField;
      const elementKey = candidate.dataset.morphElement;
      const itemId = candidate.closest<HTMLElement>("[data-storefront-item-id]")
        ?.dataset.storefrontItemId;
      if (
        (nodeId?.length ?? 0) > 200 ||
        (fieldPath?.length ?? 0) > 500 ||
        (fieldKey?.length ?? 0) > 200 ||
        (elementKey?.length ?? 0) > 200
      ) {
        continue;
      }
      const sourceLocation = candidate.dataset.morphLoc;
      const hasUniqueNodeId =
        Boolean(nodeId) && morphNodeCounts.get(nodeId ?? "") === 1;
      const hasUniqueFieldKey =
        Boolean(fieldKey) && fieldKeyCounts.get(fieldKey ?? "") === 1;
      const hasUniqueSourceLocation =
        Boolean(sourceLocation) &&
        sourceLocationCounts.get(sourceLocation ?? "") === 1;
      if (
        !fieldPath &&
        !hasUniqueNodeId &&
        !hasUniqueFieldKey &&
        !hasUniqueSourceLocation
      ) {
        continue;
      }

      const identity = itemId
        ? `item:${itemId}:${nodeId ? `node:${nodeId}` : `field:${fieldKey ?? fieldPath}`}`
        : fieldPath
          ? `path:${fieldPath}${nodeId ? `:node:${nodeId}` : ""}`
          : nodeId
            ? `node:${nodeId}`
            : fieldKey
              ? `field:${fieldKey}`
              : `loc:${sourceLocation}`;
      const id = `${sectionId}:${identity}`;
      if (id.length > 500 || nodeIds.has(id)) continue;

      let parentElement = candidate.parentElement;
      let parentId: string | null = null;
      while (parentElement && parentElement !== section) {
        const matchedParentId = elementNodeIds.get(parentElement);
        if (matchedParentId) {
          parentId = matchedParentId;
          break;
        }
        parentElement = parentElement.parentElement;
      }

      const target: PreviewSelectionRestoreTarget = {
        sectionId,
        sourceLocation: sourceLocation || undefined,
        nodeId: nodeId || undefined,
        fieldPath: fieldPath || undefined,
        elementKey: elementKey || undefined,
        fieldKey: fieldKey || undefined,
        isSection: false,
      };
      const kind = selectionKindFromElement({
        component: candidate.dataset.storefrontComponent,
        morphElement: elementKey,
        tagName: candidate.tagName,
        role: candidate.getAttribute("role"),
        inputType: candidate.getAttribute("type"),
      });
      nodes.push({
        id,
        parentId,
        sectionId,
        label: previewEditableNodeLabel(candidate),
        kind,
        tagName: candidate.tagName.toLowerCase().slice(0, 32),
        // Reported, not used as the label: only an element with one can carry a
        // style bound to a single instance, and that is worth being able to see.
        stableId: nodeId || elementKey || undefined,
        target,
      });
      nodeIds.add(id);
      elementNodeIds.set(candidate, id);
    }
  }

  return nodes;
}

export function collectEditableDescendantFields(
  element: HTMLElement,
): EditableDescendantField[] {
  const result: EditableDescendantField[] = [];
  const identities = new Set<string>();
  const candidates = element.querySelectorAll<HTMLElement>(
    "[data-storefront-field]",
  );

  for (const candidate of candidates) {
    if (candidate.querySelector("[data-storefront-field]")) continue;
    const fieldKey = candidate.dataset.storefrontField;
    if (!fieldKey) continue;
    const fieldPath = candidate.dataset.storefrontFieldPath ?? fieldKey;
    const sectionId = previewSectionIdOf(
      closestPreviewSectionRoot(candidate) ?? candidate,
    );
    const identity = `${sectionId ?? ""}\u0000${fieldKey}\u0000${fieldPath}`;
    if (identities.has(identity)) continue;
    identities.add(identity);
    result.push({ fieldKey, fieldPath, sectionId: sectionId ?? null });
  }

  return result;
}

/**
 * Field annotations are the most precise identity available for a content
 * control. Keep this small helper public so selection behavior can be tested
 * without mounting the whole preview route.
 */
export function closestPreviewFieldElement(
  element: HTMLElement,
): HTMLElement | null {
  return element.closest<HTMLElement>("[data-storefront-field]");
}

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
  const routeDocument = useMemo(() => {
    if (!template?.document || !activeRoutePath) return template?.document;
    const registry = buildThemeRouteRegistry(renderThemeFiles);
    if (!registry.valid) return template.document;
    const route = registry.routes.find(
      (candidate) =>
        candidate.kind === "route" && candidate.path === activeRoutePath,
    );
    if (!route) return template.document;
    const derived = deriveThemeRouteSections(
      renderThemeFiles,
      route.sourcePath,
    );
    if (
      derived.diagnostics.length > 0 ||
      (derived.sections.length === 0 && !derived.hasContentImport)
    ) {
      return template.document;
    }
    return mergeDocumentWithRouteSections(template.document, derived.sections, {
      routeOwnsStructure: derived.hasContentImport,
    });
  }, [activeRoutePath, renderThemeFiles, template?.document]);
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

    type SelectableInfo = {
      element: HTMLElement;
      section: HTMLElement | null;
      /** `file:line:column`, when the element carries a compiled position. */
      sourceLocation?: string | null;
      sectionId: string | null;
      type: string;
      label: string;
      elementKey: string | null;
      fieldKey: string | null;
      field: string | null;
      fieldPath: string | null;
      descendantFields: EditableDescendantField[];
      tagName: string;
      role: string | null;
      inputType: string | null;
    };

    const selectionKindOf = (item: SelectableInfo) =>
      selectionKindFromElement({
        component: item.type,
        morphElement: item.elementKey,
        tagName: item.tagName,
        role: item.role,
        inputType: item.inputType,
        isSection: item.element === item.section,
      });

    const selectionMetadata = (item: SelectableInfo) => {
      const sourceElement = item.element.closest<HTMLElement>(
        "[data-morph-source-file]",
      );
      const kind = selectionKindOf(item);
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
        contentValue:
          item.descendantFields.length === 0 && item.fieldKey
            ? readSelectionContentValue(item.element)
            : null,
      };
    };

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
    let inlineTextEdit: {
      element: HTMLElement;
      item: SelectableInfo;
      originalValue: string;
      originalChildren: Node[];
      previousContentEditable: string | null;
      previousSpellcheck: string | null;
      isComposing: boolean;
      abortController: AbortController;
    } | null = null;
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

      // 0. A content field is more precise than an ancestor AST marker. Some
      // rendered fields (notably action labels) intentionally have no source
      // location of their own, so resolving the ancestor first would make the
      // inspector show the container instead of the actual field.
      const fieldEl = closestPreviewFieldElement(target);
      if (fieldEl) {
        const sectionEl = closestPreviewSectionRoot(fieldEl);
        const descendantFields = collectEditableDescendantFields(fieldEl);
        const fieldKey =
          descendantFields.length > 0
            ? null
            : (fieldEl.dataset.storefrontField ?? null);
        const fieldPath = fieldEl.dataset.storefrontFieldPath ?? fieldKey;
        const elementKey = fieldEl.dataset.morphElement ?? null;
        const selectableType =
          fieldEl.dataset.storefrontComponent ??
          elementKey ??
          fieldEl.tagName.toLowerCase();

        return {
          element: fieldEl,
          section: sectionEl,
          sourceLocation: fieldEl.dataset.morphLoc ?? null,
          sectionId: sectionEl ? (previewSectionIdOf(sectionEl) ?? null) : null,
          type: selectableType,
          label: getComponentDisplayName(selectableType),
          elementKey,
          fieldKey,
          field: fieldKey,
          fieldPath,
          descendantFields,
          tagName: fieldEl.tagName.toLowerCase(),
          role: fieldEl.getAttribute("role"),
          inputType: fieldEl instanceof HTMLInputElement ? fieldEl.type : null,
        };
      }

      // 1. Prefer the nearest AST-backed Morph identity annotation.
      const morphEl = target.closest<HTMLElement>(
        // Compile-time source positions make an element identifiable even when
        // the author wrote no markers, so they select like any other element.
        "[data-morph-node], [data-morph-element], [data-morph-loc]",
      );
      if (morphEl) {
        const sectionEl = closestPreviewSectionRoot(morphEl);
        const nodeId = morphEl.dataset.morphNode ?? null;
        const elementKey = morphEl.dataset.morphElement ?? null;
        const descendantFields = collectEditableDescendantFields(morphEl);
        const fieldKey =
          descendantFields.length > 0
            ? null
            : (morphEl.dataset.storefrontField ??
              (elementKey
                ? elementKey === "action"
                  ? "actionLabel"
                  : elementKey === "image"
                    ? "imageSrc"
                    : elementKey
                : null));
        const fieldPath = morphEl.dataset.storefrontFieldPath ?? fieldKey;
        const selectableType =
          elementKey ?? nodeId ?? morphEl.tagName.toLowerCase();

        return {
          element: morphEl,
          section: sectionEl,
          sourceLocation: morphEl.dataset.morphLoc ?? null,
          sectionId: sectionEl ? (previewSectionIdOf(sectionEl) ?? null) : null,
          type: selectableType,
          label: getComponentDisplayName(selectableType),
          elementKey,
          fieldKey,
          field: fieldKey,
          fieldPath,
          descendantFields,
          tagName: morphEl.tagName.toLowerCase(),
          role: morphEl.getAttribute("role"),
          inputType: morphEl instanceof HTMLInputElement ? morphEl.type : null,
        };
      }

      // 2. Prioritize explicit component annotation
      const componentEl = target.closest<HTMLElement>(
        "[data-storefront-component]",
      );
      if (componentEl) {
        const sectionEl = closestPreviewSectionRoot(componentEl);
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
        const descendantFields = collectEditableDescendantFields(componentEl);

        return {
          element: componentEl,
          section: sectionEl,
          sectionId: sectionEl ? (previewSectionIdOf(sectionEl) ?? null) : null,
          type: compType,
          label: getComponentDisplayName(compType),
          elementKey,
          fieldKey,
          field: fieldKey ?? elementKey,
          fieldPath,
          descendantFields,
          tagName: componentEl.tagName.toLowerCase(),
          role: componentEl.getAttribute("role"),
          inputType:
            componentEl instanceof HTMLInputElement ? componentEl.type : null,
        };
      }

      // 3. Standard interactive & typography sub-elements
      const elementEl = target.closest<HTMLElement>(
        "h1, h2, h3, h4, h5, h6, p, blockquote, code, pre, img, picture, svg, video, audio, canvas, iframe, embed, map, a, button, nav, details, summary, form, fieldset, input, textarea, select, option, ul, ol, li, table, thead, tbody, tfoot, tr, td, th, hr, article",
      );
      if (elementEl) {
        const sectionEl = closestPreviewSectionRoot(elementEl);
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
        const descendantFields = collectEditableDescendantFields(elementEl);

        return {
          element: elementEl,
          section: sectionEl,
          sectionId: sectionEl ? (previewSectionIdOf(sectionEl) ?? null) : null,
          type: compType,
          label: getComponentDisplayName(compType),
          elementKey: compType,
          fieldKey,
          field: fieldKey,
          fieldPath,
          descendantFields,
          tagName: tag,
          role: elementEl.getAttribute("role"),
          inputType:
            elementEl instanceof HTMLInputElement ? elementEl.type : null,
        };
      }

      // 4. Fallback to outer Section
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
          descendantFields: collectEditableDescendantFields(section),
          tagName: section.tagName.toLowerCase(),
          role: section.getAttribute("role"),
          inputType: null,
        };
      }

      return null;
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

    const editableElementText = (element: HTMLElement) =>
      normalizeInlineTextEditValue(
        element.innerText ?? element.textContent ?? "",
      );

    const finishInlineTextEdit = (commit: boolean) => {
      const edit = inlineTextEdit;
      if (!edit) return;
      inlineTextEdit = null;
      edit.abortController.abort();

      const editedValue = editableElementText(edit.element);
      const value = commit ? editedValue : edit.originalValue;
      if (!commit && editedValue !== edit.originalValue) {
        edit.element.replaceChildren(...edit.originalChildren);
      } else if (commit && value !== edit.originalValue) {
        // The persisted contract is text, never the browser-created editing
        // markup (`div`, `br`, or pasted HTML in older engines).
        edit.element.textContent = value;
      }
      edit.element.removeAttribute("data-storefront-editor-inline-editing");
      if (edit.previousContentEditable === null) {
        edit.element.removeAttribute("contenteditable");
      } else {
        edit.element.setAttribute(
          "contenteditable",
          edit.previousContentEditable,
        );
      }
      if (edit.previousSpellcheck === null) {
        edit.element.removeAttribute("spellcheck");
      } else {
        edit.element.setAttribute("spellcheck", edit.previousSpellcheck);
      }

      syncEmptyTextLines();
      positionOverlays();
      if (
        commit &&
        value !== edit.originalValue &&
        edit.item.sectionId &&
        edit.item.fieldKey &&
        edit.item.fieldPath
      ) {
        postPreviewToEditorMessage({
          type: "morph:storefront-preview-commit-inline-text",
          sectionId: edit.item.sectionId,
          fieldKey: edit.item.fieldKey,
          fieldPath: edit.item.fieldPath,
          value,
        });
      }
    };

    const insertPlainTextAtSelection = (text: string) => {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    };

    const normalizeEditableElement = (element: HTMLElement) => {
      const value = editableElementText(element);
      if ((element.innerText ?? element.textContent ?? "") !== value) {
        element.textContent = value;
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      positionOverlays();
    };

    const startInlineTextEdit = (item: SelectableInfo) => {
      const kind = selectionKindOf(item);
      if (
        !isInlineTextEditCandidate({
          selectionEnabled,
          kind,
          sectionId: item.sectionId,
          fieldKey: item.fieldKey,
          fieldPath: item.fieldPath,
          descendantFieldCount: item.descendantFields.length,
          isSection: item.element === item.section,
        })
      ) {
        return false;
      }

      finishInlineTextEdit(false);
      const element = item.element;
      const originalValue = editableElementText(element);
      const abortController = new AbortController();
      inlineTextEdit = {
        element,
        item,
        originalValue,
        originalChildren: Array.from(element.childNodes, (node) =>
          node.cloneNode(true),
        ),
        previousContentEditable: element.getAttribute("contenteditable"),
        previousSpellcheck: element.getAttribute("spellcheck"),
        isComposing: false,
        abortController,
      };

      element.setAttribute("data-storefront-editor-inline-editing", "true");
      element.removeAttribute(PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE);
      element.setAttribute("contenteditable", "plaintext-only");
      element.setAttribute("spellcheck", "true");

      element.addEventListener(
        "compositionstart",
        () => {
          if (inlineTextEdit?.element === element)
            inlineTextEdit.isComposing = true;
        },
        { signal: abortController.signal },
      );
      element.addEventListener(
        "compositionend",
        () => {
          if (inlineTextEdit?.element === element) {
            inlineTextEdit.isComposing = false;
            normalizeEditableElement(element);
          }
        },
        { signal: abortController.signal },
      );
      for (const eventName of ["pointerdown", "click", "dblclick"] as const) {
        element.addEventListener(
          eventName,
          (event) => event.stopPropagation(),
          { signal: abortController.signal },
        );
      }
      element.addEventListener(
        "keydown",
        (event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            finishInlineTextEdit(false);
            return;
          }
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.isComposing &&
            !inlineTextEdit?.isComposing
          ) {
            event.preventDefault();
            finishInlineTextEdit(true);
          }
        },
        { capture: true, signal: abortController.signal },
      );
      element.addEventListener(
        "paste",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          const remaining = Math.max(
            0,
            INLINE_TEXT_EDIT_MAX_LENGTH - editableElementText(element).length,
          );
          insertPlainTextAtSelection(
            normalizeInlineTextEditValue(
              event.clipboardData?.getData("text/plain") ?? "",
            ).slice(0, remaining),
          );
          positionOverlays();
        },
        { signal: abortController.signal },
      );
      element.addEventListener(
        "input",
        (event) => {
          if (
            !shouldNormalizeInlineTextInput(
              inlineTextEdit?.isComposing ?? false,
              event instanceof InputEvent && event.isComposing,
            )
          ) {
            // Replacing textContent during an active composition destroys the
            // browser's marked range and drops partially composed CJK text.
            positionOverlays();
            return;
          }
          normalizeEditableElement(element);
        },
        { signal: abortController.signal },
      );
      element.addEventListener("blur", () => finishInlineTextEdit(true), {
        signal: abortController.signal,
      });

      element.focus({ preventScroll: true });
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
      positionOverlays();
      return true;
    };

    const sourceFilePathFor = (element: HTMLElement) =>
      element.closest<HTMLElement>("[data-morph-source-file]")?.dataset
        .morphSourceFile ??
      element.closest<HTMLElement>("[data-storefront-section-id]")?.dataset
        .morphSourceFile ??
      null;

    /**
     * `line:column` of an element, when nothing else in the same source file
     * renders from that position. A JSX element inside `map()` renders once per
     * item and shares one position, which is precisely the ambiguity that must
     * not be reordered through source.
     */
    const uniqueSourceLocationKey = (element: HTMLElement) => {
      const sourceLocation = element.dataset.morphLoc;
      if (!sourceLocation) return null;
      const key = sourceLocationKey(sourceLocation);
      if (!key) return null;
      const scope =
        element.closest<HTMLElement>("[data-storefront-section-id]") ??
        document;
      const matches = scope.querySelectorAll<HTMLElement>(
        `[data-morph-loc="${CSS.escape(sourceLocation)}"]`,
      );
      return matches.length === 1 ? key : null;
    };

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
      if (!parent || !sectionId || !sourceFilePath) return null;
      // A section root belongs to the route's section list, not to the JSX
      // siblings inside one component, so it reorders through the same path the
      // sidebar uses rather than through a source-file rewrite.
      if (element === section) {
        return {
          kind: "section" as const,
          nodeId: sectionId,
          fieldPath: null,
          arrayPath: null,
          parent,
          sectionId,
          sourceFilePath,
        };
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
      // An unmarked element is reordered by its source position instead. The
      // transformer accepts either, so a component with no authored markers is
      // still draggable — but the position must resolve to one element in this
      // file, exactly as a marker must.
      const targetKey =
        nodeId && isUniqueMorphNode(element, nodeId)
          ? nodeId
          : uniqueSourceLocationKey(element);
      if (!targetKey) return null;
      return {
        kind: "source" as const,
        nodeId: targetKey,
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
      // Two sections are exchangeable precisely because they are different
      // sections; everything else has to stay within one section and one file.
      (identity.kind === "section"
        ? identity.sectionId !== gesture.sectionId
        : identity.sectionId === gesture.sectionId &&
          identity.sourceFilePath === gesture.sourceFilePath) &&
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
      const spacingMeasurements = measureSpacingOverlays();
      if (!selectionEnabled) {
        hoverOverlay.style.display = "none";
        selectedOverlay.style.display = "none";
        renderSpacingOverlays(spacingMeasurements);
        return;
      }

      // Measure every target before mutating either overlay. Keeping the reads
      // together avoids a selected-overlay write forcing the following hover
      // measurement to synchronously recalculate layout.
      const selectedElementForOverlay = selectedItem?.element ?? null;
      const selectedRawBounds =
        selectedElementForOverlay &&
        !overlaySettler?.isFrozen() &&
        document.body.contains(selectedElementForOverlay)
          ? selectedElementForOverlay.getBoundingClientRect()
          : null;
      const hoverElementForOverlay = hoveredItem?.element ?? null;
      const hoverRawBounds =
        hoverElementForOverlay &&
        document.body.contains(hoverElementForOverlay) &&
        hoverElementForOverlay !== selectedElementForOverlay
          ? hoverElementForOverlay.getBoundingClientRect()
          : null;

      const resolveOverlayGeometry = (
        item: SelectableInfo | null,
        element: HTMLElement | null,
        bounds: SelectionOverlayBounds | null,
      ) => {
        if (!item || !element || !bounds) return null;
        const candidate = {
          bounds,
          kind: selectionKindOf(item),
          content: element.textContent ?? "",
          inlineHeight: element.style.height,
          inlineMaxHeight: element.style.maxHeight,
        };
        if (!isSelectionOverlayTextFallbackCandidate(candidate)) return bounds;
        const computed = window.getComputedStyle(element);
        return selectionOverlayGeometry({
          ...candidate,
          lineHeight: computed.lineHeight,
          fontSize: computed.fontSize,
          display: computed.display,
        });
      };
      const selectedBounds = resolveOverlayGeometry(
        selectedItem,
        selectedElementForOverlay,
        selectedRawBounds,
      );
      const hoverBounds = resolveOverlayGeometry(
        hoveredItem,
        hoverElementForOverlay,
        hoverRawBounds,
      );

      // Keep the last stable selected geometry while live authoring replaces
      // the selected DOM node. The settled pass below rebinds its identity and
      // measures the final element once.
      if (selectedItem && overlaySettler?.isFrozen()) {
        selectedOverlay.style.display = "block";
        updateOverlayLabel(selectedLabelName, selectedLabelTag, selectedItem);
      } else if (selectedItem && selectedBounds) {
        const ring = outsetOverlayBounds(
          selectedBounds,
          inlineTextEdit?.element === selectedElementForOverlay
            ? INLINE_EDIT_OUTSET_PX
            : undefined,
        );
        selectedOverlay.style.display = "block";
        selectedOverlay.style.left = `${ring.left}px`;
        selectedOverlay.style.top = `${ring.top}px`;
        selectedOverlay.style.width = `${ring.width}px`;
        selectedOverlay.style.height = `${ring.height}px`;
        updateOverlayLabel(selectedLabelName, selectedLabelTag, selectedItem);
      } else {
        selectedOverlay.style.display = "none";
      }

      // 2. Position Hover Overlay (dashed + mask, hidden if hovering over selected item)
      if (hoveredItem && hoverBounds) {
        const ring = outsetOverlayBounds(hoverBounds);
        hoverOverlay.style.display = "block";
        hoverOverlay.style.left = `${ring.left}px`;
        hoverOverlay.style.top = `${ring.top}px`;
        hoverOverlay.style.width = `${ring.width}px`;
        hoverOverlay.style.height = `${ring.height}px`;
        updateOverlayLabel(hoverLabelName, hoverLabelTag, hoveredItem);
      } else {
        hoverOverlay.style.display = "none";
      }
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
      if (inlineTextEdit) return;
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
        inlineTextEdit &&
        event.target instanceof Node &&
        inlineTextEdit.element.contains(event.target)
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
      if (
        inlineTextEdit &&
        event.target instanceof Node &&
        inlineTextEdit.element.contains(event.target)
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
        inlineTextEdit &&
        event.target instanceof Node &&
        inlineTextEdit.element.contains(event.target)
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
      if (inlineTextEdit) {
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
        gesture.kind === "section" &&
        target.identity.kind === "section"
      ) {
        postPreviewToEditorMessage({
          type: "morph:storefront-preview-commit-section-reorder",
          draggedSectionId: gesture.sectionId,
          targetSectionId: target.identity.sectionId,
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
      if (inlineTextEdit && !inlineTextEdit.element.isConnected) {
        finishInlineTextEdit(false);
      }
      if (
        inlineTextEdit &&
        mutations.every(
          (mutation) =>
            mutation.target === inlineTextEdit?.element ||
            inlineTextEdit?.element.contains(mutation.target),
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
      hoverOverlay.remove();
      selectedOverlay.remove();
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

    const previewRoot = document.querySelector<HTMLElement>(
      "[data-storefront-preview-root]",
    );
    if (!previewRoot) return;

    const previousDocumentOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    // The editor frame is sized from the rendered page. A page shell that
    // uses `min-h-screen` creates a circular dependency here: the iframe
    // height becomes the CSS viewport height, which becomes the shell's
    // minimum height, which is then reported back as the iframe height. Keep
    // the production theme untouched and replace viewport-relative sizing only
    // inside the preview. Resolve it against the editor-provided viewport
    // height instead of the iframe's own height: that preserves the page's
    // intended minimum while preventing a route's `min-h-screen` from growing
    // every time the iframe is measured. Apply this to descendants too because
    // authored routes commonly put viewport sizing on their `<main>`.
    const previewSizingStyle = document.createElement("style");
    previewSizingStyle.dataset.storefrontPreviewSizing = "true";
    previewSizingStyle.textContent = `
      [data-storefront-preview-root] > [data-morph-source-file] {
        min-height: 0 !important;
      }
      [data-storefront-preview-root] [class~="min-h-screen"],
      [data-storefront-preview-root] [class~="min-h-svh"],
      [data-storefront-preview-root] [class~="min-h-dvh"],
      [data-storefront-preview-root] [class~="min-h-lvh"],
      [data-storefront-preview-root] [class~="sm:min-h-screen"],
      [data-storefront-preview-root] [class~="md:min-h-screen"],
      [data-storefront-preview-root] [class~="lg:min-h-screen"],
      [data-storefront-preview-root] [class~="xl:min-h-screen"],
      [data-storefront-preview-root] [class~="2xl:min-h-screen"],
      [data-storefront-preview-root] [class~="min-h-[100vh]"],
      [data-storefront-preview-root] [class~="min-h-[100svh]"],
      [data-storefront-preview-root] [class~="min-h-[100dvh]"],
      [data-storefront-preview-root] [class~="min-h-[100lvh]"] {
        min-height: var(--storefront-preview-viewport-height, 100vh) !important;
      }
      [data-storefront-preview-root] [data-morph-source-file][class*="h-screen"],
      [data-storefront-preview-root] [data-morph-source-file][class*="h-svh"],
      [data-storefront-preview-root] [data-morph-source-file][class*="h-dvh"],
      [data-storefront-preview-root] [data-morph-source-file][class*="h-lvh"],
      [data-storefront-preview-root] [class~="h-screen"],
      [data-storefront-preview-root] [class~="h-svh"],
      [data-storefront-preview-root] [class~="h-dvh"],
      [data-storefront-preview-root] [class~="h-lvh"],
      [data-storefront-preview-root] [class~="sm:h-screen"],
      [data-storefront-preview-root] [class~="md:h-screen"],
      [data-storefront-preview-root] [class~="lg:h-screen"],
      [data-storefront-preview-root] [class~="xl:h-screen"],
      [data-storefront-preview-root] [class~="2xl:h-screen"],
      [data-storefront-preview-root] [class~="h-[100vh]"],
      [data-storefront-preview-root] [class~="h-[100svh]"],
      [data-storefront-preview-root] [class~="h-[100dvh]"],
      [data-storefront-preview-root] [class~="h-[100lvh]"] {
        height: var(--storefront-preview-viewport-height, 100vh) !important;
      }
    `;
    document.head.appendChild(previewSizingStyle);

    let animationFrame = 0;
    let candidateHeight: number | null = null;
    let stableFrameCount = 0;
    let lastPublishedHeight: number | null = null;
    let measurementRevision = 0;
    let isDisposed = false;

    const measureUntilStable = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        if (isDisposed) return;

        // `getBoundingClientRect()` captures the visible border box while
        // `scrollHeight` captures content that extends beyond it. Reading
        // both in the same animation frame keeps this a read-only geometry
        // phase and avoids layout read/write thrashing.
        const nextHeight = Math.ceil(
          Math.max(
            previewRoot.getBoundingClientRect().height,
            previewRoot.scrollHeight,
          ),
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
          measurementRevision,
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
        measurementRevision = message.measurementRevision;
        // An explicit request means the editor does not know the height, so the
        // answer has to be sent even when it repeats the last one. Skipping it
        // as a duplicate is how a re-measure could leave the editor holding the
        // provisional height it shrank to in order to ask.
        lastPublishedHeight = null;
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
      previewSizingStyle.remove();
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
import { storefrontCatalogQueries } from "@/routes/_editor/-queries/storefront-catalog.queries";
