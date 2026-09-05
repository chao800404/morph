import { Button } from "@/components/ui/button";
import { usePanelResize } from "./use-panel-resize";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { MAX_RELEASE_NOTE_LENGTH } from "@/lib/storefront/release-note";
import { RouteFullscreenSurface } from "@/components/dialog/route-fullscreen-surface";
import { useCloseOnEscape } from "@/components/dialog/route-modal-close";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrubbableNumberInput } from "@/components/ui/scrubbable-number-input";
import { Separator } from "@/components/ui/separator";
import {
  buildThemeRouteRegistry,
  themeRoutePathAfterFileMoves,
  type ThemeRouteRecord,
} from "@/lib/storefront/compiler/theme-route-registry";
import {
  addThemeRouteSection,
  deriveThemeRouteSections,
  listThemeRouteSectionOptions,
  mergeDocumentWithRouteSections,
  removeThemeRouteSection,
  reorderThemeRouteSections,
  type ThemeRouteSectionOption,
} from "@/lib/storefront/compiler/theme-route-sections";
import type {
  StorefrontCommentGroupDTO,
  StorefrontCommentThreadDTO,
} from "@/lib/storefront/dto/storefront-comment.dto";
import type {
  StorefrontThemeBuildDTO,
  StorefrontThemeBuildPreviewDTO,
} from "@/lib/storefront/dto/storefront-theme-build.dto";
import type {
  StorefrontThemeFileDTO,
  StorefrontThemeFileTreeNode,
} from "@/lib/storefront/dto/storefront-theme-file.dto";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import { dragAutoScrollStep } from "@/lib/storefront/editor/drag-autoscroll";
import {
  sectionHistoryScope,
  themeFileHistoryScope,
} from "@/lib/storefront/editor/editor-history";
import { cn } from "@/lib/utils";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AppWindow,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Code2,
  ExternalLink,
  History,
  Layers,
  Layout,
  LoaderCircle,
  Square,
  Lock,
  MessageCircle,
  Monitor,
  MousePointer2,
  Play,
  Redo2,
  Ruler,
  Smartphone,
  Tablet,
  Undo2,
  Unlock,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";
import { useEditorHistory } from "./use-editor-history";
import type { EditorCodeWorkspaceHandle } from "./editor-code-workspace";

import {
  createStorefrontCommentGroup,
  updateStorefrontCommentGroup,
} from "@/server/storefront/storefront-comments.serverFn";
import {
  createPreviewBuild,
  getPreviewBuildToken,
  cancelThemeBuild,
  getThemeBuild,
} from "@/server/storefront/storefront-theme-builds.serverFn";
import {
  createStorefrontThemeRevision,
  getStorefrontThemeFile,
  initStorefrontStarterTheme,
  saveStorefrontThemeFile,
} from "@/server/storefront/storefront-theme-files.serverFn";
import {
  publishStorefrontThemeTemplate,
  updateStorefrontThemeSectionProps,
} from "@/server/storefront/storefront-themes.serverFn";

import { reportAuthenticatedUserActivity } from "@/lib/auth/idle-activity";
import {
  patchElementClassNameResult,
  removeJsxElement,
  swapSiblingMorphNodes,
} from "@/lib/storefront/ast/theme-ast-transformer";
import {
  patchThemeLinkBinding,
  patchThemeLinkElement,
} from "@/lib/storefront/ast/theme-link-binding";
import { waitForThemeBuild } from "@/lib/storefront/editor/theme-build-wait";
import { resolveBuildRunOwnership } from "@/lib/storefront/editor/build-run-ownership";
import { resolvePublishBuildPlan } from "@/lib/storefront/editor/publish-build-plan";
import {
  describeThemeSourceChanges,
  describeUnpublishedChanges,
} from "@/lib/storefront/editor/unpublished-changes";
import { sourceLocationKey } from "@/lib/storefront/ast/element-target";
import {
  hasInlineTextDocumentTarget,
  isInlineTextEditCandidate,
} from "@/lib/storefront/editor/inline-text-edit";
import {
  buildLivePreviewUrl,
  resolveLivePreviewSecurity,
} from "@/lib/storefront/editor/live-preview-security";
import {
  parsePreviewSectionProps,
  type PreviewEditableNode,
  type PreviewSectionProps,
  type PreviewSelectionRestoreTarget,
  type PreviewSpacingOverlayMode,
} from "@/lib/storefront/editor/preview-protocol";
import { swapArrayItemsAtFieldPaths } from "@/lib/storefront/editor/reorder-array-items";
import {
  setFieldPathValue,
  type EditableDescendantField,
  type EditorSelectionDescriptor,
} from "@/lib/storefront/editor/selection-taxonomy";
import { isPreviewSpacingOverlayMode } from "@/lib/storefront/editor/spacing-overlay";
import {
  findLegacyThemeInstanceStyleSheet,
  patchThemeInstanceStyleClasses,
  readLegacyThemeInstanceStyleClasses,
  removeLegacyThemeInstanceStyle,
  removeLegacyThemeInstanceStyleImport,
  type ThemeInstanceStyleTarget,
} from "@/lib/storefront/editor/theme-instance-style-source";
import { parseThemeSourceLocation } from "@/lib/storefront/compiler/theme-source-location-plugin";
import {
  toWorkspaceKey,
  themeFileWritePrecondition,
  useThemeWorkspaceStore,
} from "@/lib/storefront/store/theme-workspace-store";
import { storefrontCommentQueries } from "../-queries/storefront-comment.queries";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";
import {
  EditorAssistantPanel,
  readStoredEditorAssistantPanelTab,
  type EditorAssistantPanelTab,
} from "./editor-assistant-panel";
import { EditorCanvasComments } from "./editor-canvas-comments";
import { resolveCodeSelectionTarget } from "./editor-code-selection";
import { EditorPathNavigator } from "./editor-path-navigator";
import { EditorReleaseHistoryDialog } from "./editor-release-history";
import {
  EditorSectionsPanel,
  type EditorEditableNodeDeleteResult,
} from "./editor-sections-panel";
import type { InspectorPropsChangeOptions } from "./editor-style-inspector";
import { resolveStylesSelectionTransition } from "./editor-styles-selection-mode";
import {
  resolveEditorTemplate,
  templateTypeForRoute,
  toEditorRouteSearch,
} from "./editor-template";
import {
  EditorToolbar,
  EditorToolbarGroup,
  EditorToolbarMode,
} from "./editor-toolbar";
import {
  isLatestStyleRevision,
  isPreviewHandshakePending,
  shouldRevealPreviewForStyleAck,
} from "./style-revision";
import {
  useLivePreviewMessageBridge,
  useStableLivePreviewSession,
} from "./use-live-preview-message-bridge";

const loadEditorCodeWorkspace = () =>
  import("./editor-code-workspace").then((module) => ({
    default: module.EditorCodeWorkspace,
  }));

const EditorCodeWorkspace = lazy(loadEditorCodeWorkspace);

function preloadEditorCodeWorkspace() {
  // The browser deduplicates this import with React.lazy. Starting it from
  // hover/focus keeps Design's initial bundle lean while moving Monaco and the
  // managed declaration graph off the click-to-visible interaction path.
  void loadEditorCodeWorkspace().catch(() => undefined);
}

export function EditorModeSurface({
  active,
  className,
  children,
  style,
  surfaceRef,
}: {
  active: boolean;
  className?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  /**
   * Lets a caller write to this element directly. The panel resize handles use
   * it to update a CSS custom property per frame without re-rendering.
   */
  surfaceRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={surfaceRef}
      style={style}
      aria-hidden={!active}
      inert={!active}
      className={cn(
        "col-start-1 row-start-2 min-h-0 min-w-0 flex relative",
        // Keep the iframe/Monaco layout alive while the other mode is shown.
        // `hidden` would set display:none, causing the preview's size bridge
        // to measure its viewport at the minimum height and briefly expose a
        // dark canvas gap when switching modes. Opacity makes the inactive
        // grid layer fully transparent even for composited children such as
        // Monaco and the iframe, while z-index gives the active layer a
        // deterministic stacking order.
        active
          ? "visible z-10 opacity-100"
          : "invisible z-0 opacity-0 pointer-events-none",
        className,
      )}
      data-editor-mode-surface="true"
    >
      {children}
    </div>
  );
}

export function EditorCodeModeSurface({
  active,
  preload,
  children,
}: {
  active: boolean;
  preload?: boolean;
  children: React.ReactNode;
}) {
  const [hasMounted, setHasMounted] = useState(active || preload);

  useEffect(() => {
    if (active || preload) setHasMounted(true);
  }, [active, preload]);

  if (!active && !hasMounted) return null;

  return (
    <EditorModeSurface active={active} className="flex-1 overflow-hidden">
      {children}
    </EditorModeSurface>
  );
}

export function createSelectionRestoreMessages(
  selectionMode: boolean,
  restoreTarget: PreviewSelectionRestoreTarget | null,
  selectionRevision?: number,
) {
  const messages: Array<
    | {
        type: "morph:storefront-preview-set-selection-mode";
        enabled: boolean;
        restoreTarget?: PreviewSelectionRestoreTarget;
        selectionRevision?: number;
      }
    | { type: "morph:storefront-preview-request-selection-style" }
  > = [
    {
      type: "morph:storefront-preview-set-selection-mode",
      enabled: selectionMode,
      restoreTarget: selectionMode ? (restoreTarget ?? undefined) : undefined,
      ...(selectionRevision === undefined ? {} : { selectionRevision }),
    },
  ];
  if (selectionMode && restoreTarget) {
    messages.push({
      type: "morph:storefront-preview-request-selection-style",
    });
  }
  return messages;
}

function collectEditableNodeDescendantFields(
  selectedNode: PreviewEditableNode | null,
  nodes: readonly PreviewEditableNode[],
): readonly EditableDescendantField[] {
  if (!selectedNode) return [];

  const childrenByParent = new Map<string, PreviewEditableNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }

  const result: EditableDescendantField[] = [];
  const identities = new Set<string>();
  const visit = (parentId: string) => {
    for (const node of childrenByParent.get(parentId) ?? []) {
      const children = childrenByParent.get(node.id) ?? [];
      if (children.length > 0) {
        visit(node.id);
        continue;
      }
      const fieldKey = node.target.fieldKey;
      if (!fieldKey) continue;
      const fieldPath = node.target.fieldPath ?? fieldKey;
      const identity = `${node.target.sectionId}\u0000${fieldKey}\u0000${fieldPath}`;
      if (identities.has(identity)) continue;
      identities.add(identity);
      result.push({
        fieldKey,
        fieldPath,
        sectionId: node.target.sectionId,
      });
    }
  };

  visit(selectedNode.id);
  return result;
}

function previewSelectionTargetMatches(
  left: PreviewSelectionRestoreTarget,
  right: PreviewSelectionRestoreTarget,
): boolean {
  if (
    left.sectionId !== right.sectionId ||
    Boolean(left.isSection) !== Boolean(right.isSection)
  ) {
    return false;
  }
  if (left.isSection) return true;

  // Preview responses can enrich a target with a source location or a DOM
  // marker that was not present in the tree payload. Compare the strongest
  // shared identity instead of requiring every optional field to be equal.
  const identityKeys = [
    "fieldPath",
    "nodeId",
    "elementKey",
    "fieldKey",
    "sourceLocation",
  ] as const;
  return identityKeys.some(
    (key) =>
      left[key] !== undefined &&
      right[key] !== undefined &&
      left[key] === right[key],
  );
}

export function createEditorSelectionDescriptor(
  target: PreviewSelectionRestoreTarget,
  node: PreviewEditableNode | null,
  componentType: string,
  descendantFields: readonly EditableDescendantField[] = [],
): EditorSelectionDescriptor {
  return {
    sectionId: target.sectionId,
    kind: node?.kind ?? "custom",
    componentType,
    tagName: node?.tagName ?? null,
    role: null,
    inputType: null,
    nodeId: target.nodeId ?? null,
    sourceFilePath: null,
    sourceLocation: target.sourceLocation ?? null,
    elementKey: target.elementKey ?? null,
    fieldKey: target.fieldKey ?? null,
    fieldPath: target.fieldPath ?? target.fieldKey ?? null,
    contentValue: null,
    descendantFields,
    className: "",
    isSection: target.isSection === true,
    computed: null,
    parentComputed: null,
    sectionComputed: null,
    inspectorOverride: null,
  };
}

type EditorShellProps = {
  context: StorefrontThemeEditorDTO;
  search: StorefrontThemeEditorSearch;
  onSearchChange: (next: Partial<StorefrontThemeEditorSearch>) => void;
  currentUser?: {
    id?: string;
    name?: string;
    email?: string;
    image?: string | null;
  };
};

const previewDefaultWidths = {
  desktop: 1440,
  tablet: 768,
  mobile: 390,
} as const;

const previewDefaultHeights = {
  desktop: 900,
  tablet: 1024,
  mobile: 844,
} as const;

const DEFAULT_PREVIEW_VIEWPORT_HEIGHT = previewDefaultHeights.desktop;
/** Settling time before re-measuring, so a burst of edits measures once. */
const PREVIEW_REMEASURE_DELAY_MS = 500;
// The current Live Preview parses Theme Source into the compatibility renderer;
// it does not execute the user's JavaScript bundle. Switching this to
// "user-code" intentionally fails closed until an isolated origin is configured.
const LIVE_PREVIEW_EXECUTION_MODE = "compatibility-renderer" as const;
const MIN_CANVAS_SCALE = 0.25;
const MAX_CANVAS_SCALE = 2;
const CANVAS_SCALE_STEP = 0.1;
const CANVAS_DEFAULT_SCALE = 1;
const CANVAS_DEFAULT_SCALE_SNAP_THRESHOLD = 0.02;
const MIN_PREVIEW_WIDTH = 320;
const MAX_PREVIEW_WIDTH = 1920;
const PREVIEW_WIDTH_STEP = 16;
const TABLET_PREVIEW_WIDTH = 768;
const DESKTOP_PREVIEW_WIDTH = 1024;
const CANVAS_TOP_INSET = 48;
const CANVAS_BOTTOM_INSET = 80;
const CANVAS_VERTICAL_OVERSCROLL = 200;
const CANVAS_SCROLL_COMMIT_DELAY_MS = 120;

/**
 * Result of one build attempt.
 *
 * The build is reported back rather than only written to state: a caller that
 * builds in order to do something next — publishing — continues in the same
 * tick and would otherwise read the previous render's value.
 */
type BuildAttempt = {
  ok: boolean;
  build?: StorefrontThemeBuildDTO;
  sourceGeneration?: number;
};

type CanvasTransform = {
  x: number;
  y: number;
  scale: number;
};

const EMPTY_THEME_FILES: StorefrontThemeFileDTO[] = [];
const EMPTY_THEME_TREE: StorefrontThemeFileTreeNode[] = [];

const initialCanvasTransform: CanvasTransform = {
  x: 0,
  y: 0,
  scale: 1,
};

function clampCanvasScale(scale: number) {
  return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, scale));
}

function snapCanvasScaleTowardDefault(currentScale: number, nextScale: number) {
  if (currentScale === CANVAS_DEFAULT_SCALE) return nextScale;

  const isMovingTowardDefault =
    (currentScale < CANVAS_DEFAULT_SCALE && nextScale > currentScale) ||
    (currentScale > CANVAS_DEFAULT_SCALE && nextScale < currentScale);
  const crossedDefault =
    (currentScale < CANVAS_DEFAULT_SCALE &&
      nextScale >= CANVAS_DEFAULT_SCALE) ||
    (currentScale > CANVAS_DEFAULT_SCALE && nextScale <= CANVAS_DEFAULT_SCALE);
  const isWithinSnapThreshold =
    Math.abs(nextScale - CANVAS_DEFAULT_SCALE) <=
    CANVAS_DEFAULT_SCALE_SNAP_THRESHOLD;

  return isMovingTowardDefault && (crossedDefault || isWithinSnapThreshold)
    ? CANVAS_DEFAULT_SCALE
    : nextScale;
}

function clampPreviewWidth(width: number) {
  return Math.min(MAX_PREVIEW_WIDTH, Math.max(MIN_PREVIEW_WIDTH, width));
}

function resolvePreviewViewport(width: number) {
  if (width >= DESKTOP_PREVIEW_WIDTH) return "desktop" as const;
  if (width >= TABLET_PREVIEW_WIDTH) return "tablet" as const;
  return "mobile" as const;
}

function clampCanvasTransform(
  transform: CanvasTransform,
  viewportHeight: number,
  contentHeight: number,
) {
  const minimumY =
    Math.min(
      0,
      viewportHeight -
        CANVAS_TOP_INSET -
        CANVAS_BOTTOM_INSET -
        contentHeight * transform.scale,
    ) - CANVAS_VERTICAL_OVERSCROLL;
  const maximumY = CANVAS_VERTICAL_OVERSCROLL;

  return {
    ...transform,
    y: Math.min(maximumY, Math.max(minimumY, transform.y)),
  };
}

function normalizeWheelDelta(
  deltaY: number,
  deltaMode: number,
  viewportHeight: number,
) {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * viewportHeight;
  return deltaY;
}

const DEFAULT_LEFT_PANEL_WIDTH = 260;
const MIN_LEFT_PANEL_WIDTH = 220;
const MAX_LEFT_PANEL_WIDTH = 460;

const DEFAULT_RIGHT_PANEL_WIDTH = 380;
const MIN_RIGHT_PANEL_WIDTH = 280;
const MAX_RIGHT_PANEL_WIDTH = 640;

const LEFT_PANEL_WIDTH_VARIABLE = "--editor-left-panel-width";
const RIGHT_PANEL_WIDTH_VARIABLE = "--editor-right-panel-width";

/**
 * Module constants, not inline literals: both panels are `memo`-wrapped, and a
 * fresh style object on every render would defeat that — which is exactly what
 * used to happen on each frame of a resize drag.
 */
const LEFT_PANEL_STYLE: React.CSSProperties = {
  width: `var(${LEFT_PANEL_WIDTH_VARIABLE})`,
};
const RIGHT_PANEL_STYLE: React.CSSProperties = {
  width: `var(${RIGHT_PANEL_WIDTH_VARIABLE})`,
};

const viewportOptions = [
  { value: "desktop", label: "Desktop", icon: Monitor },
  { value: "tablet", label: "Tablet", icon: Tablet },
  { value: "mobile", label: "Mobile", icon: Smartphone },
] as const;

export function VisualEditorShell({
  context,
  search,
  onSearchChange,
  currentUser,
}: EditorShellProps) {
  // The design surface owns the panel widths as CSS custom properties so a
  // resize drag can repaint without re-rendering this component. See
  // `usePanelResize` for why that matters here specifically.
  const designSurfaceRef = useRef<HTMLDivElement>(null);

  const leftPanelResize = usePanelResize({
    initialWidth: context.panelWidths?.left ?? DEFAULT_LEFT_PANEL_WIDTH,
    defaultWidth: DEFAULT_LEFT_PANEL_WIDTH,
    minWidth: MIN_LEFT_PANEL_WIDTH,
    maxWidth: MAX_LEFT_PANEL_WIDTH,
    edge: "left",
    cssVariable: LEFT_PANEL_WIDTH_VARIABLE,
    surfaceRef: designSurfaceRef,
    storageKey: "morph:editor-left-panel-width",
  });

  const rightPanelResize = usePanelResize({
    initialWidth: context.panelWidths?.right ?? DEFAULT_RIGHT_PANEL_WIDTH,
    defaultWidth: DEFAULT_RIGHT_PANEL_WIDTH,
    minWidth: MIN_RIGHT_PANEL_WIDTH,
    maxWidth: MAX_RIGHT_PANEL_WIDTH,
    edge: "right",
    cssVariable: RIGHT_PANEL_WIDTH_VARIABLE,
    surfaceRef: designSurfaceRef,
    storageKey: "morph:editor-right-panel-width",
  });

  const leftPanelWidth = leftPanelResize.width;
  const rightPanelWidth = rightPanelResize.width;

  const [previewRevision, setPreviewRevision] = useState(0);
  const [loadedPreviewKey, setLoadedPreviewKey] = useState<string | null>(null);
  const [previewLoadFailure, setPreviewLoadFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [previewFrameReady, setPreviewFrameReady] = useState<{
    key: string;
    sequence: number;
  } | null>(null);
  const initialPreviewSyncRef = useRef<{
    key: string;
    readySequence: number;
    styleRevision: number;
    filesFingerprint: string;
  } | null>(null);
  const [previewContentSize, setPreviewContentSize] = useState<{
    key: string;
    height: number;
  } | null>(null);
  const [previewStructure, setPreviewStructure] = useState<{
    key: string;
    nodes: readonly PreviewEditableNode[];
  } | null>(null);
  const [canvasTransform, setCanvasTransform] = useState<CanvasTransform>(
    initialCanvasTransform,
  );
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [spacingOverlayMode, setSpacingOverlayMode] =
    useState<PreviewSpacingOverlayMode>("off");
  const [assistantPanelTab, setAssistantPanelTab] =
    useState<EditorAssistantPanelTab>(readStoredEditorAssistantPanelTab);
  const previousAssistantPanelTabRef =
    useRef<EditorAssistantPanelTab>(assistantPanelTab);
  const autoEnabledSelectionForStylesRef = useRef(false);
  const [draftSaveState, setDraftSaveState] = useState<
    "idle" | "saving" | "error"
  >("idle");
  const [previewWidth, setPreviewWidth] = useState(
    () => search.canvasWidth ?? previewDefaultWidths[search.viewport],
  );
  const [isCommentMode, setIsCommentMode] = useState(false);
  const [commentFilter, setCommentFilter] = useState<"open" | "resolved">(
    "open",
  );
  const [activeCommentThreadId, setActiveCommentThreadId] = useState<
    string | null
  >(null);
  const [draftCommentPin, setDraftCommentPin] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [isWidthLocked, setIsWidthLocked] = useState(true);

  useEffect(() => {
    const previousTab = previousAssistantPanelTabRef.current;
    const transition = resolveStylesSelectionTransition({
      previousTab,
      nextTab: assistantPanelTab,
      selectionMode: isSelectionMode,
      commentMode: isCommentMode,
      autoEnabled: autoEnabledSelectionForStylesRef.current,
    });

    autoEnabledSelectionForStylesRef.current = transition.autoEnabled;
    if (transition.selectionMode !== isSelectionMode) {
      setIsSelectionMode(transition.selectionMode);
    }

    previousAssistantPanelTabRef.current = assistantPanelTab;
  }, [assistantPanelTab, isCommentMode, isSelectionMode]);

  const activeTemplate = resolveEditorTemplate(context, search);
  const queryClient = useQueryClient();
  const [pendingRoutePath, setPendingRoutePath] = useState<string | null>(null);
  const currentSearchRoutePathRef = useRef(search.routePath);
  currentSearchRoutePathRef.current = search.routePath;
  const handleRouteIntent = useCallback((routePath?: string) => {
    setPendingRoutePath(routePath ?? null);
  }, []);

  const handleThemeFilesMoved = useCallback(
    (moves: ReadonlyArray<{ from: string; to: string }>) => {
      const nextRoutePath = themeRoutePathAfterFileMoves(
        currentSearchRoutePathRef.current,
        moves,
      );
      if (nextRoutePath) setPendingRoutePath(nextRoutePath);
    },
    [],
  );

  useEffect(() => {
    if (
      pendingRoutePath !== null &&
      pendingRoutePath === (search.routePath ?? null)
    ) {
      setPendingRoutePath(null);
    }
  }, [pendingRoutePath, search.routePath]);

  const commentGroupsQuery = useQuery({
    ...storefrontCommentQueries.groups(
      context.storefront.id,
      context.theme.id,
      activeTemplate?.id ?? "",
    ),
    enabled: Boolean(activeTemplate?.id),
  });
  const commentGroups = (
    commentGroupsQuery.data?.success ? commentGroupsQuery.data.data : []
  ) as StorefrontCommentGroupDTO[];

  useEffect(() => {
    if (commentGroups.length === 0) {
      setActiveGroupId(null);
      return;
    }
    setActiveGroupId((prev) => {
      if (!prev) return commentGroups[0].id;
      if (commentGroups.some((g) => g.id === prev)) return prev;
      return commentGroups[0].id;
    });
  }, [commentGroups]);

  const createGroupMutation = useMutation({
    mutationFn: async () => {
      const res = await createStorefrontCommentGroup({
        data: {
          storefrontId: context.storefront.id,
          themeId: context.theme.id,
          templateId: activeTemplate?.id ?? "",
          name: `Group ${commentGroups.length + 1}`,
          viewportWidth: previewWidth,
        },
      });
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    onSuccess: (newGroup) => {
      if (newGroup?.id) {
        setActiveGroupId(newGroup.id);
        if (newGroup.viewportWidth > 0) {
          applyPreviewWidth(newGroup.viewportWidth, true);
        }
      }
      setCommentFilter("open");
      queryClient.invalidateQueries({
        queryKey: storefrontCommentQueries.all(),
      });
      setActiveCommentThreadId(null);
      setDraftCommentPin(null);
      setIsWidthLocked(true);
      toast.success("Comment group created");
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to create group",
      );
    },
  });

  const syncGroupWidthMutation = useMutation({
    mutationFn: async ({
      groupId,
      viewportWidth,
    }: {
      groupId: string;
      viewportWidth: number;
    }) => {
      const res = await updateStorefrontCommentGroup({
        data: {
          storefrontId: context.storefront.id,
          themeId: context.theme.id,
          groupId,
          viewportWidth,
        },
      });
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    onSuccess: (updatedGroup) => {
      if (updatedGroup?.id) {
        queryClient.setQueryData(
          storefrontCommentQueries.groups(
            context.storefront.id,
            context.theme.id,
            activeTemplate?.id ?? "",
          ).queryKey,
          (old: any) => {
            if (!old || !old.success || !Array.isArray(old.data)) return old;
            return {
              ...old,
              data: old.data.map((g: StorefrontCommentGroupDTO) =>
                g.id === updatedGroup.id
                  ? { ...g, viewportWidth: updatedGroup.viewportWidth }
                  : g,
              ),
            };
          },
        );
      }
    },
  });

  const commentsQuery = useQuery({
    ...storefrontCommentQueries.list(
      context.storefront.id,
      context.theme.id,
      activeTemplate?.id ?? "",
      "all",
    ),
    enabled: Boolean(activeTemplate?.id),
  });
  const commentThreads = commentsQuery.data?.data ?? [];
  const publishMutation = useMutation({
    mutationFn: (variables: {
      sourceRevisionId?: string;
      themeBuildId?: string;
      note?: string;
      expectedDraftRevisionId: string;
      expectedDraftGeneration: number;
      expectedReleaseGeneration: number;
    }) => {
      if (!activeTemplate) throw new Error("No active template");
      return publishStorefrontThemeTemplate({
        data: {
          storefrontId: context.storefront.id,
          themeId: context.theme.id,
          templateId: activeTemplate.id,
          sourceRevisionId: variables.sourceRevisionId,
          themeBuildId: variables.themeBuildId,
          note: variables.note,
          expectedDraftRevisionId: variables.expectedDraftRevisionId,
          expectedDraftGeneration: variables.expectedDraftGeneration,
          expectedReleaseGeneration: variables.expectedReleaseGeneration,
        },
      });
    },
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: storefrontThemeQueries.detail(
            context.storefront.id,
            context.theme.id,
          ).queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: storefrontThemeFileQueries.tree(
            context.storefront.id,
            context.theme.id,
          ).queryKey,
        }),
      ]);
      toast.success(result.message);
    },
    onError: () => toast.error("Failed to publish theme"),
  });
  const pendingPropsTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const pendingPropsMapRef = useRef<
    Map<string, { sectionId: string; props: Record<string, unknown> }>
  >(new Map());
  /** Section props as they stood when the current debounce window opened. */
  const pendingPropsBaselineRef = useRef<Map<string, Record<string, unknown>>>(
    new Map(),
  );
  const templateMutationQueueRef = useRef<Map<string, Promise<unknown>>>(
    new Map(),
  );
  const templateDraftGenerationRef = useRef<Map<string, number>>(new Map());
  const templateDraftRevisionIdRef = useRef<Map<string, string>>(new Map());

  const updatePropsMutation = useMutation({
    mutationFn: (variables: {
      sectionId: string;
      props: Record<string, unknown>;
      expectedDraftGeneration: number;
    }) => {
      if (!activeTemplate) throw new Error("No active template");
      return updateStorefrontThemeSectionProps({
        data: {
          storefrontId: context.storefront.id,
          themeId: context.theme.id,
          templateId: activeTemplate.id,
          sectionId: variables.sectionId,
          props: variables.props,
          expectedDraftGeneration: variables.expectedDraftGeneration,
        },
      });
    },
    onMutate: () => setDraftSaveState("saving"),
    onSuccess: async (result) => {
      if (!result.success) {
        setDraftSaveState("error");
        toast.error(result.message);
        return;
      }
      setDraftSaveState("idle");
      await queryClient.invalidateQueries({
        queryKey: storefrontThemeQueries.detail(
          context.storefront.id,
          context.theme.id,
        ).queryKey,
      });
    },
    onError: () => {
      setDraftSaveState("error");
      toast.error("Failed to update section properties");
    },
  });

  /**
   * Drops any drag-time inline styles before reversing an edit.
   *
   * They exist to carry a value across the re-render an edit causes. When the
   * edit is being reversed they describe the state being undone, so the
   * re-render would put the old value straight back on screen.
   */
  const resetPreviewSelectionStyle = useCallback(() => {
    postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
      type: "morph:storefront-preview-reset-selection-style-preview",
    });
  }, []);

  const { actions: history, state: historyState } = useEditorHistory();

  const enqueueTemplateMutation = useCallback(
    (templateId: string, op: (generation: number) => Promise<any>) => {
      const currentQueue =
        templateMutationQueueRef.current.get(templateId) ?? Promise.resolve();
      const nextPromise = currentQueue
        .catch(() => {})
        .then(async () => {
          const expectedDraftGeneration =
            templateDraftGenerationRef.current.get(templateId) ??
            activeTemplate?.draftGeneration ??
            1;
          const result = await op(expectedDraftGeneration);
          if (result?.success && result.data) {
            if (typeof result.data.draftGeneration === "number") {
              templateDraftGenerationRef.current.set(
                templateId,
                result.data.draftGeneration,
              );
            }
            if (result.data.draftRevisionId) {
              templateDraftRevisionIdRef.current.set(
                templateId,
                result.data.draftRevisionId,
              );
            }
          }
          return result;
        });
      templateMutationQueueRef.current.set(templateId, nextPromise);
      return nextPromise;
    },
    [activeTemplate?.draftGeneration],
  );

  const flushTemplatePendingProps = useCallback(
    async (targetTemplateId?: string) => {
      const tid = targetTemplateId ?? activeTemplate?.id;
      if (!tid) return;
      const prefix = `${tid}:`;
      const flushPromises: Promise<unknown>[] = [];

      // Driven by the pending payloads, not by the timers.
      //
      // A debounced save clears its own timer before awaiting, so an edit whose
      // write was rejected still has a payload but no timer. Walking timers
      // skipped exactly those — the entries the retry exists for.
      for (const key of Array.from(pendingPropsMapRef.current.keys())) {
        if (!key.startsWith(prefix)) continue;

        const timer = pendingPropsTimersRef.current.get(key);
        if (timer !== undefined) {
          clearTimeout(timer);
          pendingPropsTimersRef.current.delete(key);
        }

        const pending = pendingPropsMapRef.current.get(key);
        if (!pending) continue;

        flushPromises.push(
          (async () => {
            const result = await enqueueTemplateMutation(tid, (gen) =>
              updatePropsMutation.mutateAsync({
                sectionId: pending.sectionId,
                props: pending.props,
                expectedDraftGeneration: gen,
              }),
            );
            // Dropped only once the write is acknowledged, for the same reason
            // the debounced path keeps it: a rejected edit that has been
            // forgotten cannot be retried by anything.
            if (
              result?.success &&
              pendingPropsMapRef.current.get(key) === pending
            ) {
              pendingPropsMapRef.current.delete(key);
              pendingPropsBaselineRef.current.delete(key);
            }
            return result;
          })(),
        );
      }

      await Promise.all(flushPromises);
      await templateMutationQueueRef.current.get(tid);
    },
    [activeTemplate?.id, enqueueTemplateMutation, updatePropsMutation],
  );

  const livePreviewSecurity = resolveLivePreviewSecurity({
    editorOrigin: context.previewChannel?.editorOrigin ?? "",
    configuredPreviewOrigin: import.meta.env
      .VITE_STOREFRONT_LIVE_PREVIEW_ORIGIN,
    executionMode: LIVE_PREVIEW_EXECUTION_MODE,
  });
  const livePreviewWorkspaceKey = `${context.storefront.id}:${context.theme.id}`;
  const stablePreviewSession = useStableLivePreviewSession(
    livePreviewWorkspaceKey,
    context.previewChannel?.sessionId ?? "",
  );
  const livePreviewChannel = {
    targetOrigin: livePreviewSecurity.enabled
      ? livePreviewSecurity.previewOrigin
      : (context.previewChannel?.editorOrigin ?? ""),
    previewSession: stablePreviewSession,
  };
  // Keep the iframe document stable while the editor changes route search
  // state. The initial path still travels in the URL for a correct first
  // paint; subsequent paths are switched in-place through the preview bridge.
  const previewRouteSeedRef = useRef<{
    templateId: string | null;
    routePath?: string;
  }>({
    templateId: activeTemplate?.id ?? null,
    routePath: search.routePath,
  });
  const previewTemplateId = activeTemplate?.id ?? null;
  if (previewRouteSeedRef.current.templateId === null && previewTemplateId) {
    previewRouteSeedRef.current = {
      templateId: previewTemplateId,
      routePath: search.routePath,
    };
  }
  const previewSeedRevisionRef = useRef(previewRevision);
  if (previewSeedRevisionRef.current !== previewRevision) {
    // A deliberate preview refresh recreates the iframe. Carry the current
    // route/template into that new document instead of returning to the path
    // that happened to be open on the first editor paint.
    previewSeedRevisionRef.current = previewRevision;
    previewRouteSeedRef.current = {
      templateId: previewTemplateId,
      routePath: search.routePath,
    };
  }
  const previewUrl =
    activeTemplate && livePreviewSecurity.enabled
      ? buildLivePreviewUrl({
          previewOrigin: livePreviewSecurity.previewOrigin,
          storefrontId: context.storefront.id,
          themeId: context.theme.id,
          templateId:
            previewRouteSeedRef.current.templateId ?? activeTemplate.id,
          routePath: previewRouteSeedRef.current.routePath,
          viewportHeight: DEFAULT_PREVIEW_VIEWPORT_HEIGHT,
          editorOrigin: context.previewChannel?.editorOrigin ?? "",
          previewSession: stablePreviewSession,
        })
      : null;
  const previewKey = previewUrl ? `${previewUrl}-${previewRevision}` : null;
  const isPreviewLoading = isPreviewHandshakePending(
    previewKey,
    loadedPreviewKey,
    previewLoadFailure?.key ?? null,
  );
  useEffect(() => {
    // Do not start the confirmation timeout while the frame or source query
    // is still booting. The old timer started at iframe creation, so a slow
    // first query could report a false Live Preview failure before any source
    // update had been sent.
    if (
      !previewKey ||
      loadedPreviewKey === previewKey ||
      previewFrameReady?.key !== previewKey
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setPreviewLoadFailure((current) =>
        current?.key === previewKey
          ? current
          : {
              key: previewKey,
              message:
                "Live Preview did not confirm the current Theme source. The last rendered frame remains available.",
            },
      );
    }, 15_000);

    return () => window.clearTimeout(timeout);
  }, [loadedPreviewKey, previewFrameReady?.key, previewKey]);
  const previewFrameHeight =
    previewContentSize?.key === previewKey
      ? previewContentSize.height
      : previewDefaultHeights[search.viewport];
  const ActiveViewportIcon =
    viewportOptions.find((option) => option.value === search.viewport)?.icon ??
    Monitor;

  const [editorMode, setEditorMode] = useState<"design" | "code">("design");
  const [shouldPreloadCodeWorkspace, setShouldPreloadCodeWorkspace] =
    useState(false);
  const [previewMode, setPreviewMode] = useState<"live" | "build">("live");

  /**
   * Leaves the compiled build and returns to the editor.
   *
   * Stable so the shared Escape hook does not rebind on every render.
   */
  const returnToLivePreview = useCallback(() => {
    setPreviewMode((mode) => (mode === "build" ? "live" : mode));
  }, []);

  // Esc closes the full-screen build the same way it closes every other
  // full-screen surface in the app.
  useCloseOnEscape(returnToLivePreview);
  const isImmutableBuildPreview = previewMode === "build";
  const [activeBuildPreview, setActiveBuildPreview] =
    useState<StorefrontThemeBuildDTO | null>(null);
  const [activeBuildSourceGeneration, setActiveBuildSourceGeneration] =
    useState<number | null>(null);
  const [activePreviewToken, setActivePreviewToken] = useState<string | null>(
    null,
  );
  const [isBuildPending, setIsBuildPending] = useState(false);
  /**
   * True only for a build that publishing started for itself.
   *
   * Separate from `isBuildPending` because the Publish button must report the
   * publish it was asked for, not any build that happens to be running.
   */
  const [isPublishBuilding, setIsPublishBuilding] = useState(false);
  const { buildOwnsRun: isOwnBuildPending } = resolveBuildRunOwnership({
    isBuildPending,
    isPublishBuilding,
  });
  const [isPublishNoteOpen, setIsPublishNoteOpen] = useState(false);
  const [publishNote, setPublishNote] = useState("");
  /**
   * Stops waiting on a build, and on an explicit cancel also stops the build.
   *
   * Unmounting only abandons the wait: leaving the editor is not a decision
   * about the build. A cancel additionally asks the server to claim the build
   * and destroy its Sandbox, so the work actually ends instead of running on
   * and competing with the next build.
   */
  const buildWaitAbortRef = useRef<AbortController | null>(null);
  const buildIdRef = useRef<string | null>(null);
  const abortBuildWait = useCallback((reason: "user" | "unmount") => {
    const controller = buildWaitAbortRef.current;
    if (!controller || controller.signal.aborted) return;
    controller.abort(reason);
  }, []);

  useEffect(() => () => abortBuildWait("unmount"), [abortBuildWait]);

  const handleCancelBuild = useCallback(async () => {
    const buildId = buildIdRef.current;
    abortBuildWait("user");
    if (!buildId) return;
    try {
      const result = await cancelThemeBuild({
        data: {
          storefrontId: context.storefront.id,
          themeId: context.theme.id,
          buildId,
        },
      });
      if (!result.success) {
        toast.error(result.message || "Failed to cancel the build.");
        return;
      }
      toast.success(result.message ?? "Theme build cancelled");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to cancel the build.",
      );
    }
  }, [abortBuildWait, context.storefront.id, context.theme.id]);
  const [isReleaseHistoryOpen, setIsReleaseHistoryOpen] = useState(false);
  const releaseHistoryTriggerRef = useRef<HTMLButtonElement>(null);
  const [buildDiagnostics, setBuildDiagnostics] = useState<any | null>(null);

  const [activeCodeFilePath, setActiveCodeFilePath] = useState<
    string | undefined
  >();
  const [jumpLocation, setJumpLocation] = useState<
    { filePath: string; line?: number; column?: number } | undefined
  >();

  const handleJumpToCode = useCallback(
    (filePath?: string, line?: number, column?: number) => {
      if (filePath) {
        setActiveCodeFilePath(filePath);
        setJumpLocation({ filePath, line, column });
      }
      setEditorMode("code");
    },
    [],
  );

  /**
   * Selection the side panels may act on.
   *
   * Build Preview shows an immutable artifact: its iframe carries no editor
   * channel, so nothing in it can be selected, and the workspace source it was
   * built from may already have moved on. Presenting a stale Live selection
   * there would let the panels edit source that does not correspond to what is
   * on screen. The selection is kept in state, so switching back to Live
   * restores it.
   */
  const [activeSelection, setActiveSelection] =
    useState<EditorSelectionDescriptor | null>(null);
  /**
   * The shell owns selection identity for both side panels. The iframe only
   * confirms the same target with computed-style data; it is never allowed to
   * replace a newer sidebar intent with an older section-level response.
   */
  const editableSelection = isImmutableBuildPreview ? null : activeSelection;
  const previewSelectionRevisionRef = useRef(0);
  const nextPreviewSelectionRevision = useCallback(() => {
    previewSelectionRevisionRef.current += 1;
    return previewSelectionRevisionRef.current;
  }, []);
  const lastPreviewSelectionRef = useRef<PreviewSelectionRestoreTarget | null>(
    null,
  );
  /**
   * The last inline style preview is already painted in the iframe. When its
   * source patch commits, the iframe can compile the new CSS without asking
   * React to rebuild the entire Theme tree. Empty values are excluded because
   * removing an old utility requires the source render to remove its class.
   */
  const pendingSelectionStyleRef = useRef<{
    selectionKey: string;
    targetElement: string;
    styles: Record<string, string>;
  } | null>(null);
  const previousTemplateIdRef = useRef(search.templateId);
  const previousRoutePathRef = useRef(search.routePath);
  const pendingPreviewSelectionRef = useRef<{
    target: PreviewSelectionRestoreTarget;
    revision: number;
  } | null>(null);
  const [activeComputedStyleRevision, setActiveComputedStyleRevision] =
    useState(0);
  const latestStyleRevisionRef = useRef(0);
  const latestAppliedStyleRevisionRef = useRef(0);
  const [monacoDirtyFiles, setMonacoDirtyFiles] = useState<string[]>([]);
  const editorCodeWorkspaceRef = useRef<EditorCodeWorkspaceHandle>(null);
  const [isUnsavedCodeDialogOpen, setIsUnsavedCodeDialogOpen] = useState(false);
  const [isSavingCodeBeforeModeSwitch, setIsSavingCodeBeforeModeSwitch] =
    useState(false);

  const themeFilesQuery = useQuery({
    ...storefrontThemeFileQueries.tree(context.storefront.id, context.theme.id),
  });
  const themeFiles = themeFilesQuery.data?.files ?? EMPTY_THEME_FILES;
  const themeTree = themeFilesQuery.data?.tree ?? EMPTY_THEME_TREE;
  const starterInitAttemptRef = useRef<string | null>(null);
  const starterInitMutation = useMutation({
    mutationFn: async () => {
      const result = await initStorefrontStarterTheme({
        data: {
          storefrontId: context.storefront.id,
          themeId: context.theme.id,
        },
      });
      if (!result.success) throw new Error(result.message);
      return result.data;
    },
    onSuccess: async (data) => {
      useThemeWorkspaceStore
        .getState()
        .acceptRemoteGeneration(data.sourceGeneration, {
          storefrontId: context.storefront.id,
          themeId: context.theme.id,
        });
      await queryClient.invalidateQueries({
        queryKey: storefrontThemeFileQueries.tree(
          context.storefront.id,
          context.theme.id,
        ).queryKey,
      });
      setPreviewRevision((revision) => revision + 1);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to initialize theme source workspace",
      );
    },
  });

  useEffect(() => {
    if (!themeFilesQuery.isSuccess || themeFiles.length > 0) return;
    const workspaceKey = `${context.storefront.id}:${context.theme.id}`;
    if (starterInitAttemptRef.current === workspaceKey) return;
    starterInitAttemptRef.current = workspaceKey;
    starterInitMutation.mutate();
  }, [
    context.storefront.id,
    context.theme.id,
    starterInitMutation,
    themeFiles.length,
    themeFilesQuery.isSuccess,
  ]);

  useEffect(() => {
    if (!previewKey || !themeFilesQuery.isError) return;
    setPreviewLoadFailure((current) =>
      current?.key === previewKey
        ? current
        : {
            key: previewKey,
            message:
              "Live Preview could not load the Theme source. Apply the latest database migration, then retry Preview.",
          },
    );
  }, [previewKey, themeFilesQuery.isError]);

  const workspaceFiles = useThemeWorkspaceStore((state) => state.files);
  const activeWorkspaceKey = useThemeWorkspaceStore(
    (state) => state.activeWorkspaceKey,
  );
  const setActiveWorkspace = useThemeWorkspaceStore(
    (state) => state.setActiveWorkspace,
  );
  const hydrateWorkspace = useThemeWorkspaceStore(
    (state) => state.hydrateFromQuery,
  );
  const updateWorkspaceLocal = useThemeWorkspaceStore(
    (state) => state.updateLocalContent,
  );
  const markWorkspaceDebouncing = useThemeWorkspaceStore(
    (state) => state.markDebouncing,
  );
  const markWorkspaceSaving = useThemeWorkspaceStore(
    (state) => state.markSaving,
  );
  const markWorkspaceSaved = useThemeWorkspaceStore((state) => state.markSaved);
  const markWorkspaceError = useThemeWorkspaceStore((state) => state.markError);
  const markWorkspaceConflict = useThemeWorkspaceStore(
    (state) => state.markConflict,
  );
  const resolveWorkspaceConflict = useThemeWorkspaceStore(
    (state) => state.resolveConflict,
  );

  const workspaceScope = useMemo(
    () => ({
      storefrontId: context.storefront.id,
      themeId: context.theme.id,
    }),
    [context.storefront.id, context.theme.id],
  );

  // Package requests must be tied to the exact source snapshot that was
  // successfully built.  Once source files move on (or a conflict/error is
  // present), fail closed until the user saves and builds a fresh preview.
  const dependencySourceRevisionId = useMemo(() => {
    if (
      !activeBuildPreview ||
      activeBuildPreview.status !== "succeeded" ||
      activeBuildSourceGeneration === null ||
      monacoDirtyFiles.length > 0
    ) {
      return undefined;
    }
    const workspace = useThemeWorkspaceStore.getState();
    if (
      activeBuildSourceGeneration !==
        workspace.getBaseSourceGeneration(workspaceScope) ||
      workspace.hasUnsavedEdits(workspaceScope) ||
      workspace.hasActiveConflictsOrErrors(workspaceScope)
    ) {
      return undefined;
    }
    return activeBuildPreview.sourceRevisionId;
  }, [
    activeBuildPreview,
    activeBuildSourceGeneration,
    monacoDirtyFiles.length,
    workspaceScope,
    workspaceFiles,
  ]);

  useEffect(() => {
    setActiveWorkspace(context.storefront.id, context.theme.id);
  }, [context.storefront.id, context.theme.id, setActiveWorkspace]);

  useEffect(() => {
    if (themeFilesQuery.data?.files) {
      hydrateWorkspace(
        context.storefront.id,
        context.theme.id,
        themeFilesQuery.data.files,
        themeFilesQuery.data.sourceGeneration,
      );
    }
  }, [
    context.storefront.id,
    context.theme.id,
    themeFilesQuery.data?.files,
    themeFilesQuery.data?.sourceGeneration,
    hydrateWorkspace,
  ]);

  const effectiveThemeFiles = useMemo<StorefrontThemeFileDTO[]>(() => {
    const serverPaths = new Set(themeFiles.map((file) => file.path));
    return [
      ...themeFiles.map((file) => ({
        ...file,
        content: workspaceFiles[file.path]?.localContent ?? file.content,
      })),
      ...Object.values(workspaceFiles)
        .filter((file) => !serverPaths.has(file.path))
        .map((file) => ({
          id: `local:${file.path}`,
          storefrontId: context.storefront.id,
          themeId: context.theme.id,
          path: file.path,
          content: file.localContent,
          mimeType: file.path.endsWith(".css") ? "text/css" : "text/plain",
          isEntry: false,
          version: 1,
          createdAt: "",
          updatedAt: "",
        })),
    ];
  }, [context.storefront.id, context.theme.id, themeFiles, workspaceFiles]);
  const themeRouteRegistry = useMemo(
    () => buildThemeRouteRegistry(effectiveThemeFiles),
    [effectiveThemeFiles],
  );
  // Parse every source route once per workspace revision. Route switching then
  // reads from this derived cache instead of waiting for a second render or a
  // preview round-trip to rebuild the left-hand tree.
  const themeRouteStructureCache = useMemo(() => {
    const cache = new Map<
      string,
      ReturnType<typeof deriveThemeRouteSections>
    >();
    for (const route of themeRouteRegistry.routes) {
      if (route.kind !== "route") continue;
      cache.set(
        route.sourcePath,
        deriveThemeRouteSections(effectiveThemeFiles, route.sourcePath),
      );
    }
    return cache;
  }, [effectiveThemeFiles, themeRouteRegistry.routes]);
  const handlePrefetchThemeRoute = useCallback(
    (route: ThemeRouteRecord) => {
      // The editor and preview loaders already hydrate these queries in
      // parallel. ensureQueryData is intentionally used here so hover/focus
      // never forces a refetch of a fresh workspace; this is an intent signal
      // for future route-specific data loaders as well.
      void queryClient
        .ensureQueryData(
          storefrontThemeQueries.detail(
            context.storefront.id,
            context.theme.id,
          ),
        )
        .catch(() => undefined);
      void queryClient
        .ensureQueryData(
          storefrontThemeFileQueries.tree(
            context.storefront.id,
            context.theme.id,
          ),
        )
        .catch(() => undefined);
      // Touch the derived entry so this callback remains useful even when the
      // route is not yet the active one. The map is populated synchronously
      // above and therefore does not trigger a render or a loading state.
      void themeRouteStructureCache.get(route.sourcePath);
    },
    [
      context.storefront.id,
      context.theme.id,
      queryClient,
      themeRouteStructureCache,
    ],
  );
  const activeThemeRoute = useMemo(() => {
    if (!activeTemplate) return null;
    if (search.routePath) {
      const route = themeRouteRegistry.routes.find(
        (candidate) =>
          candidate.kind === "route" && candidate.path === search.routePath,
      );
      if (route) return route;
    }
    const prefix =
      activeTemplate.type === "index"
        ? "/"
        : activeTemplate.type === "product"
          ? "/products/"
          : activeTemplate.type === "collection"
            ? "/collections/"
            : activeTemplate.type === "page"
              ? "/pages/"
              : activeTemplate.type === "blog"
                ? "/blogs/"
                : null;
    if (!prefix) return null;
    return (
      themeRouteRegistry.routes.find(
        (route) =>
          route.kind === "route" &&
          (prefix === "/" ? route.path === "/" : route.path.startsWith(prefix)),
      ) ?? null
    );
  }, [activeTemplate, search.routePath, themeRouteRegistry.routes]);
  const pendingThemeRoute = useMemo(
    () =>
      pendingRoutePath
        ? (themeRouteRegistry.routes.find(
            (route) =>
              route.kind === "route" && route.path === pendingRoutePath,
          ) ?? null)
        : null,
    [pendingRoutePath, themeRouteRegistry.routes],
  );

  // A Code Mode route rename updates the source tree asynchronously. Wait for
  // the new route to be present in the registry before changing the editor URL
  // so the preview never receives a pathname that its current files cannot
  // resolve.
  useEffect(() => {
    if (
      !pendingRoutePath ||
      pendingRoutePath === search.routePath ||
      !pendingThemeRoute
    ) {
      return;
    }
    const routeTemplate =
      context.templates.find(
        (template) => template.type === templateTypeForRoute(pendingRoutePath),
      ) ??
      activeTemplate ??
      context.templates[0];
    if (!routeTemplate) return;
    onSearchChange(toEditorRouteSearch(routeTemplate, pendingRoutePath));
  }, [
    activeTemplate,
    context.templates,
    onSearchChange,
    pendingRoutePath,
    pendingThemeRoute,
    search.routePath,
  ]);
  const routeStructurePending = Boolean(
    (pendingRoutePath !== null &&
      pendingRoutePath !== search.routePath &&
      (!pendingThemeRoute ||
        !themeRouteStructureCache.has(pendingThemeRoute.sourcePath))) ||
    (search.routePath &&
      !activeThemeRoute &&
      (!themeFilesQuery.data ||
        (effectiveThemeFiles.length === 0 &&
          !starterInitMutation.isSuccess &&
          !starterInitMutation.isError))),
  );
  const activeRouteStructure = useMemo(
    () =>
      activeThemeRoute
        ? (themeRouteStructureCache.get(activeThemeRoute.sourcePath) ??
          deriveThemeRouteSections(
            effectiveThemeFiles,
            activeThemeRoute.sourcePath,
          ))
        : { sections: [], diagnostics: [], hasContentImport: false },
    [activeThemeRoute, effectiveThemeFiles, themeRouteStructureCache],
  );
  const activeRouteSections = activeRouteStructure.sections;
  // A source-authored route is the structure owner even when it does not use
  // `content(...)` slots.  The editor still needs to scope the Sections panel
  // to that route; otherwise the template document's legacy sections (for
  // example Home's `hero`/`promo`) leak into every direct route such as
  // `/product`.
  const routeOwnsStructure = Boolean(
    search.routePath &&
    activeThemeRoute?.kind === "route" &&
    activeThemeRoute.path === search.routePath,
  );
  const routeBackedContext = useMemo<StorefrontThemeEditorDTO>(() => {
    const routeStructureIsAuthoritative =
      activeRouteStructure.hasContentImport || routeOwnsStructure;
    if (
      !activeTemplate ||
      (activeRouteSections.length === 0 && !routeStructureIsAuthoritative)
    ) {
      return context;
    }
    return {
      ...context,
      templates: context.templates.map((template) =>
        template.id === activeTemplate.id
          ? {
              ...template,
              document: mergeDocumentWithRouteSections(
                template.document,
                activeRouteSections,
                { routeOwnsStructure: routeStructureIsAuthoritative },
              ),
            }
          : template,
      ),
    };
  }, [
    activeRouteSections,
    activeRouteStructure.hasContentImport,
    activeTemplate,
    routeOwnsStructure,
    context,
  ]);
  const routeSectionOptions = useMemo(
    () => listThemeRouteSectionOptions(effectiveThemeFiles),
    [effectiveThemeFiles],
  );
  const handleOpenThemeRoute = useCallback(
    (route: ThemeRouteRecord) => {
      setPendingRoutePath(route.path);
      const routeTemplate =
        context.templates.find(
          (template) => template.type === templateTypeForRoute(route.path),
        ) ??
        activeTemplate ??
        context.templates[0];
      if (routeTemplate) {
        onSearchChange(toEditorRouteSearch(routeTemplate, route.path));
      }
      handleJumpToCode(route.sourcePath, 1, 1);
    },
    [activeTemplate, context.templates, handleJumpToCode, onSearchChange],
  );
  const handleOpenSelectedCode = useCallback(() => {
    const selectedSection = activeTemplate?.document.sections.find(
      (section) => section.id === search.section,
    );
    const target = resolveCodeSelectionTarget({
      section: selectedSection ?? null,
      selection: activeSelection,
      themeFiles: effectiveThemeFiles,
    });

    if (target) {
      handleJumpToCode(target.filePath, target.line, target.column);
      return;
    }

    setEditorMode("code");
  }, [
    activeSelection,
    activeTemplate,
    effectiveThemeFiles,
    handleJumpToCode,
    search.section,
  ]);
  const handlePreloadCodeWorkspace = useCallback(() => {
    preloadEditorCodeWorkspace();
    setShouldPreloadCodeWorkspace(true);
  }, []);
  const workspaceKey = toWorkspaceKey(context.storefront.id, context.theme.id);
  // On first paint the server tree can be used before the Zustand workspace
  // has hydrated. Once the active workspace is ready, the same path overlays
  // unsaved local content without recreating the iframe.
  const previewThemeFiles =
    activeWorkspaceKey === workspaceKey ? effectiveThemeFiles : themeFiles;
  const previewFilesFingerprint = useMemo(
    () =>
      previewThemeFiles
        .map((file) => `${file.path}\u0000${file.content}`)
        .join("\u0001"),
    [previewThemeFiles],
  );

  const pendingSaveTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const saveQueueRef = useRef<Map<string, Promise<unknown>>>(new Map());
  const fileRevisionRef = useRef<Map<string, number>>(new Map());
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const {
    parseMessage: parseLivePreviewMessage,
    postMessage: postEditorToPreviewMessage,
  } = useLivePreviewMessageBridge(livePreviewChannel, previewIframeRef);
  const previewSizeMeasurementRevisionRef = useRef(0);
  const beginPreviewSizeMeasurement = useCallback(() => {
    previewSizeMeasurementRevisionRef.current += 1;
    return previewSizeMeasurementRevisionRef.current;
  }, []);
  const requestPreviewSize = useCallback(
    (measurementRevision = beginPreviewSizeMeasurement()) => {
      postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
        type: "morph:storefront-preview-request-size",
        measurementRevision,
      });
    },
    [beginPreviewSizeMeasurement, postEditorToPreviewMessage],
  );

  // Code and Design intentionally keep their child trees mounted so switching
  // modes does not reset the editor cursor, preview scroll, or canvas state.
  // The selection is transient, though: leaving Design must not leave the
  // Inspector pointing at an image while the source is being edited.
  const previousEditorModeRef = useRef(editorMode);
  useEffect(() => {
    const previousMode = previousEditorModeRef.current;
    previousEditorModeRef.current = editorMode;
    if (previousMode === editorMode || editorMode !== "code") return;

    pendingPreviewSelectionRef.current = null;
    setActiveSelection(null);
    postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
      type: "morph:storefront-preview-set-selection-mode",
      enabled: false,
      selectionRevision: nextPreviewSelectionRevision(),
    });
  }, [editorMode, nextPreviewSelectionRevision, postEditorToPreviewMessage]);

  // A surface stays mounted so Monaco and the preview keep their local state,
  // but focus must not remain inside the surface that just became hidden. A
  // focused hidden descendant can keep browser/Monaco paint state alive and
  // make the next mode appear over the previous one.
  useEffect(() => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement)) return;
    if (
      focused.closest<HTMLElement>(
        '[data-editor-mode-surface][aria-hidden="true"]',
      )
    ) {
      focused.blur();
    }
  }, [editorMode]);

  const arrayItemReorderHandlerRef = useRef<
    (
      sectionId: string,
      draggedFieldPath: string,
      targetFieldPath: string,
    ) => void
  >(() => {});
  // Held in a ref for the same reason the array handler is: the message
  // listener is registered once, and reading the handler through a ref keeps it
  // from capturing a stale section list.
  const sectionSwapHandlerRef = useRef<
    (draggedSectionId: string, targetSectionId: string) => void
  >(() => {});
  const inlineTextCommitHandlerRef = useRef<
    (message: {
      sectionId: string;
      fieldKey: string;
      fieldPath: string;
      value: string;
    }) => void
  >(() => {});
  const previewSelectionStyle = useCallback(
    (styles: Record<string, string>, targetElement: string) => {
      const selection = lastPreviewSelectionRef.current;
      const sourceLocation = selection?.sourceLocation ?? null;
      const selectionKey = [
        selection?.sectionId ?? "",
        sourceLocation ?? "",
        selection?.nodeId ?? "",
        selection?.elementKey ?? "",
        selection?.fieldPath ?? "",
        targetElement,
      ].join("|");
      const current = pendingSelectionStyleRef.current;
      pendingSelectionStyleRef.current = {
        selectionKey,
        targetElement,
        styles:
          current?.selectionKey === selectionKey
            ? { ...current.styles, ...styles }
            : { ...styles },
      };
      postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
        type: "morph:storefront-preview-update-selection-style",
        styles,
        targetElement,
        // An unmarked element's `targetElement` is only `line:column`, which
        // matches no DOM attribute; the full position is how the preview finds
        // it for live feedback while a control is being dragged.
        sourceLocation: lastPreviewSelectionRef.current?.sourceLocation ?? null,
      });
    },
    [],
  );
  const previewSelectionField = useCallback(
    (fieldKey: string, fieldPath: string | null, value: string) => {
      postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
        type: "morph:storefront-preview-update-selection-field",
        fieldKey,
        fieldPath,
        value,
      });
      schedulePreviewRemeasureRef.current();
    },
    [],
  );
  // Assigned below, where the canvas geometry it needs is in scope.
  const schedulePreviewRemeasureRef = useRef<() => void>(() => {});
  const postPreviewThemeFiles = useCallback(
    (
      files: Array<{ path: string; content: string }>,
      options?: {
        renderDocument?: boolean;
        preserveCanvasPosition?: boolean;
      },
    ) => {
      const styleRevision = latestStyleRevisionRef.current + 1;
      latestStyleRevisionRef.current = styleRevision;
      postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
        type: "morph:storefront-preview-update-theme-files",
        files,
        styleRevision,
        ...(options?.renderDocument === undefined
          ? {}
          : { renderDocument: options.renderDocument }),
      });
      schedulePreviewRemeasureRef.current();
      return styleRevision;
    },
    [],
  );
  useEffect(() => {
    if (
      !previewKey ||
      previewFrameReady?.key !== previewKey ||
      previewThemeFiles.length === 0 ||
      (initialPreviewSyncRef.current?.key === previewKey &&
        initialPreviewSyncRef.current.readySequence ===
          previewFrameReady.sequence &&
        initialPreviewSyncRef.current.filesFingerprint ===
          previewFilesFingerprint)
    ) {
      return;
    }

    const styleRevision = postPreviewThemeFiles(
      previewThemeFiles.map((file) => ({
        path: file.path,
        content: file.content,
      })),
    );
    initialPreviewSyncRef.current = {
      key: previewKey,
      readySequence: previewFrameReady.sequence,
      styleRevision,
      filesFingerprint: previewFilesFingerprint,
    };
  }, [
    postPreviewThemeFiles,
    previewFilesFingerprint,
    previewFrameReady,
    previewKey,
    previewThemeFiles,
  ]);

  const getScopedOpKey = useCallback(
    (filePath: string) =>
      `${workspaceScope.storefrontId}:${workspaceScope.themeId}:${filePath}`,
    [workspaceScope],
  );

  const themeFileSaveStatus = useMemo(
    () =>
      Object.fromEntries(
        Object.values(workspaceFiles).map((file) => [
          file.path,
          file.saveState === "dirty"
            ? "dirty"
            : file.saveState === "debouncing" || file.saveState === "saving"
              ? "saving"
              : file.saveState === "error"
                ? "error"
                : file.saveState === "conflict"
                  ? "conflict"
                  : "saved",
        ]),
      ) as Record<string, "saved" | "dirty" | "saving" | "error" | "conflict">,
    [workspaceFiles],
  );

  const themeFileSaveErrors = useMemo(
    () =>
      Object.fromEntries(
        Object.values(workspaceFiles)
          .filter((file) => file.errorMessage)
          .map((file) => [file.path, file.errorMessage!]),
      ),
    [workspaceFiles],
  );

  const latestPublishedRevision = themeFilesQuery.data?.latestPublishedRevision;

  const publishedSnapshotMap = useMemo(() => {
    // An empty snapshot is not a published theme with no files — a theme with
    // no files cannot be published at all. It means the contents were not
    // resolved, and comparing against it makes every file look newly added.
    if (!latestPublishedRevision?.snapshot?.length) return null;
    const map = new Map<string, string>();
    for (const item of latestPublishedRevision.snapshot) {
      map.set(item.path, item.content);
    }
    return map;
  }, [latestPublishedRevision]);

  const themeSourceDiff = useMemo(
    () => describeThemeSourceChanges(effectiveThemeFiles, publishedSnapshotMap),
    [effectiveThemeFiles, publishedSnapshotMap],
  );

  const hasTemplateChanges = Boolean(
    activeTemplate?.draftRevisionId &&
    activeTemplate.draftRevisionId !== activeTemplate.publishedRevisionId,
  );
  const hasUnpublishedChanges = hasTemplateChanges || themeSourceDiff.changed;
  // Publish being lit with nothing edited is unfalsifiable from the outside,
  // so the reason travels with the state instead of having to be guessed.
  const unpublishedReason = describeUnpublishedChanges(
    themeSourceDiff,
    hasTemplateChanges,
  );

  const saveThemeFileSequentially = useCallback(
    async (
      filePath: string,
      contentToSave: string,
      targetRevision: number,
    ): Promise<
      | { status: "saved"; file: StorefrontThemeFileDTO }
      | { status: "superseded" }
      | { status: "source-conflict" }
    > => {
      const fileOpKey = getScopedOpKey(filePath);
      const themeOpKey = `${workspaceScope.storefrontId}:${workspaceScope.themeId}`;
      const previousPromise =
        saveQueueRef.current.get(themeOpKey) ?? Promise.resolve();

      const nextPromise = previousPromise
        .catch(() => {})
        .then(
          async (): Promise<
            | { status: "saved"; file: StorefrontThemeFileDTO }
            | { status: "superseded" }
            | { status: "source-conflict" }
          > => {
            const latestQueuedRevision =
              fileRevisionRef.current.get(fileOpKey) ?? 0;
            if (targetRevision < latestQueuedRevision) {
              return { status: "superseded" };
            }

            const current = useThemeWorkspaceStore
              .getState()
              .getWorkspaceFiles(
                workspaceScope.storefrontId,
                workspaceScope.themeId,
              )[filePath];
            if (!current)
              throw new Error(`Workspace file "${filePath}" is missing`);
            if (current.conflict)
              throw new Error("File has an unresolved conflict.");

            markWorkspaceSaving(filePath, workspaceScope);

            try {
              const acceptedGeneration = useThemeWorkspaceStore
                .getState()
                .getAcceptedSourceGeneration(workspaceScope);

              const res = await saveStorefrontThemeFile({
                data: {
                  storefrontId: context.storefront.id,
                  themeId: context.theme.id,
                  path: filePath,
                  content: contentToSave,
                  ...themeFileWritePrecondition(current),
                  expectedSourceGeneration: acceptedGeneration,
                },
              });

              if (!res.success) {
                if (res.error === "SOURCE_GENERATION_CONFLICT") {
                  useThemeWorkspaceStore
                    .getState()
                    .markDirty(filePath, workspaceScope);
                  await queryClient.invalidateQueries({
                    queryKey: storefrontThemeFileQueries.tree(
                      context.storefront.id,
                      context.theme.id,
                    ).queryKey,
                  });
                  toast.error("Remote source changes detected in this theme.", {
                    action: {
                      label: "Accept Remote",
                      onClick: () => {
                        useThemeWorkspaceStore
                          .getState()
                          .acceptRemoteGeneration(undefined, workspaceScope);
                        toast.success(
                          "Remote source generation accepted. You can now save your local changes.",
                        );
                      },
                    },
                  });
                  return { status: "source-conflict" };
                }

                if (
                  res.error === "FILE_VERSION_CONFLICT" ||
                  res.error === "VERSION_CONFLICT"
                ) {
                  const latestRes = await getStorefrontThemeFile({
                    data: {
                      storefrontId: context.storefront.id,
                      themeId: context.theme.id,
                      path: filePath,
                    },
                  }).catch(() => null);

                  if (latestRes?.success && latestRes.data) {
                    markWorkspaceConflict(
                      filePath,
                      {
                        kind: current.serverExists ? "modified" : "created",
                        remoteExists: true,
                        remoteFileId: latestRes.data.id,
                        remoteVersion: latestRes.data.version,
                        remoteContent: latestRes.data.content,
                      },
                      workspaceScope,
                    );
                  } else {
                    markWorkspaceConflict(
                      filePath,
                      {
                        kind: "deleted",
                        remoteExists: false,
                        remoteFileId: null,
                        remoteVersion: null,
                        remoteContent: null,
                      },
                      workspaceScope,
                    );
                  }
                }
                throw new Error(res.message);
              }

              markWorkspaceSaved(res.data, workspaceScope);
              queryClient.setQueryData(
                storefrontThemeFileQueries.tree(
                  context.storefront.id,
                  context.theme.id,
                ).queryKey,
                (old: any) => {
                  if (!old?.files) return old;
                  const exists = old.files.some(
                    (file: any) => file.path === filePath,
                  );
                  return {
                    ...old,
                    sourceGeneration:
                      res.data.sourceGeneration ?? old.sourceGeneration,
                    files: exists
                      ? old.files.map((file: any) =>
                          file.path === filePath
                            ? { ...file, ...res.data }
                            : file,
                        )
                      : [...old.files, res.data],
                  };
                },
              );

              return { status: "saved", file: res.data };
            } catch (error) {
              const afterError = useThemeWorkspaceStore
                .getState()
                .getWorkspaceFiles(
                  workspaceScope.storefrontId,
                  workspaceScope.themeId,
                )[filePath];
              if (
                afterError?.saveState !== "conflict" &&
                afterError?.saveState !== "dirty"
              ) {
                markWorkspaceError(
                  filePath,
                  error instanceof Error ? error.message : "Save failed",
                  workspaceScope,
                );
              }
              throw error;
            }
          },
        );

      saveQueueRef.current.set(themeOpKey, nextPromise);
      return nextPromise;
    },
    [
      context.storefront.id,
      context.theme.id,
      getScopedOpKey,
      markWorkspaceConflict,
      markWorkspaceError,
      markWorkspaceSaved,
      markWorkspaceSaving,
      queryClient,
      workspaceScope,
    ],
  );

  /**
   * Lets a recorded entry call back into the saver that recorded it.
   *
   * The entry outlives the render that created it, so capturing the callback
   * directly would pin a stale closure over `themeFiles`.
   */
  /**
   * Lets publishing run a build even though the build handler is declared
   * after it. Following the same indirection this file already uses for
   * `handleUnifiedSaveFile`: naming the callback directly in a dependency
   * array would read it during render, before it exists.
   */
  const handleBuildPreviewRef = useRef<(() => Promise<BuildAttempt>) | null>(
    null,
  );

  const handleUnifiedSaveFileRef = useRef<
    | ((
        filePath: string,
        content: string,
        options?: {
          fromHistory?: boolean;
          preserveCanvasPosition?: boolean;
        },
      ) => Promise<unknown>)
    | null
  >(null);

  const handleUnifiedSaveFile = useCallback(
    async (
      filePath: string,
      content: string,
      options?: {
        fromHistory?: boolean;
        preserveCanvasPosition?: boolean;
      },
    ) => {
      // Recorded here rather than at each call site: reordering siblings,
      // reordering sections, adding one and saving in Code mode all write a
      // whole file through this one path, and each would otherwise need its own
      // copy of the same before/after bookkeeping.
      //
      // Entries for this file stack rather than replace each other. Each one
      // holds the whole file before and after that write, so reversing them
      // newest-first walks the file back through exactly the states it passed
      // through — swapping two elements twice takes two presses to undo. That
      // only holds while every write to the file records an entry; the two
      // places that write one without recording retire its history instead.
      const before = options?.fromHistory
        ? null
        : (useThemeWorkspaceStore
            .getState()
            .getWorkspaceFiles(
              workspaceScope.storefrontId,
              workspaceScope.themeId,
            )[filePath]?.localContent ??
          themeFiles.find((file) => file.path === filePath)?.content ??
          null);
      const opKey = getScopedOpKey(filePath);
      const existingTimer = pendingSaveTimersRef.current.get(opKey);
      if (existingTimer) {
        clearTimeout(existingTimer);
        pendingSaveTimersRef.current.delete(opKey);
      }

      updateWorkspaceLocal(filePath, content, workspaceScope);

      postPreviewThemeFiles(
        themeFiles.map((file) => ({
          path: file.path,
          content:
            useThemeWorkspaceStore
              .getState()
              .getWorkspaceFiles(
                workspaceScope.storefrontId,
                workspaceScope.themeId,
              )[file.path]?.localContent ?? file.content,
        })),
        { preserveCanvasPosition: options?.preserveCanvasPosition },
      );

      const nextRevision = (fileRevisionRef.current.get(opKey) ?? 0) + 1;
      fileRevisionRef.current.set(opKey, nextRevision);

      const result = await saveThemeFileSequentially(
        filePath,
        content,
        nextRevision,
      );
      if (
        result.status === "superseded" ||
        result.status === "source-conflict"
      ) {
        return null;
      }

      // Only a landed write is reversible, and only one that actually changed
      // something: recording a no-op would spend an undo press doing nothing.
      if (before !== null && before !== content) {
        history.record({
          label: `Edit · ${filePath.slice(filePath.lastIndexOf("/") + 1)}`,
          scope: themeFileHistoryScope(filePath),
          undo: () =>
            handleUnifiedSaveFileRef.current?.(filePath, before, {
              fromHistory: true,
            }),
          redo: () =>
            handleUnifiedSaveFileRef.current?.(filePath, content, {
              fromHistory: true,
            }),
        });
      }

      return result.file;
    },
    [
      getScopedOpKey,
      saveThemeFileSequentially,
      themeFiles,
      updateWorkspaceLocal,
      workspaceScope,
      postPreviewThemeFiles,
    ],
  );

  handleUnifiedSaveFileRef.current = handleUnifiedSaveFile;

  const handleRepairThemeLinkBinding = useCallback(
    async (filePath: string, fieldKey: string): Promise<boolean> => {
      const source =
        useThemeWorkspaceStore
          .getState()
          .getWorkspaceFiles(
            workspaceScope.storefrontId,
            workspaceScope.themeId,
          )[filePath]?.localContent ??
        themeFiles.find((file) => file.path === filePath)?.content;
      if (!source) {
        toast.error(
          `Cannot repair link: source file ${filePath} is unavailable.`,
        );
        return false;
      }

      const result = patchThemeLinkBinding(source, fieldKey);
      if (!result.editable) {
        toast.warning(
          result.reason === "ambiguous"
            ? "This component has multiple hard-coded Links. Connect the intended one in Code mode."
            : "This link cannot be connected safely. Edit the binding in Code mode.",
        );
        return false;
      }

      try {
        const saved = await handleUnifiedSaveFile(filePath, result.code, {
          preserveCanvasPosition: true,
        });
        if (!saved) return false;
        toast.success("Link connected. The Page selector is now available.");
        return true;
      } catch {
        return false;
      }
    },
    [handleUnifiedSaveFile, themeFiles, workspaceScope],
  );

  /**
   * Switches a link between the router's `<Link>` and a plain `<a>`.
   *
   * Which element renders the link is what decides where it may point, so
   * choosing "this store" or "external" has to rewrite the source rather than
   * only change the stored value. Anything the rewrite cannot do unambiguously
   * is reported instead of guessed at.
   */
  const handleSwitchThemeLinkElement = useCallback(
    async (
      filePath: string,
      fieldKey: string,
      target: "router" | "anchor",
    ): Promise<boolean> => {
      const source =
        useThemeWorkspaceStore
          .getState()
          .getWorkspaceFiles(
            workspaceScope.storefrontId,
            workspaceScope.themeId,
          )[filePath]?.localContent ??
        themeFiles.find((file) => file.path === filePath)?.content;
      if (!source) {
        toast.error(
          `Cannot switch link: source file ${filePath} is unavailable.`,
        );
        return false;
      }

      const result = patchThemeLinkElement(source, fieldKey, target);
      if (!result.editable) {
        toast.warning(
          result.reason === "ambiguous"
            ? "This component has several links bound to the same field. Switch the intended one in Code mode."
            : "This link cannot be switched safely. Edit it in Code mode.",
        );
        return false;
      }
      if (result.code === source) return true;

      try {
        const saved = await handleUnifiedSaveFile(filePath, result.code, {
          preserveCanvasPosition: true,
        });
        if (!saved) return false;
        toast.success(
          target === "router"
            ? "Switched to an in-store link."
            : "Switched to an external link.",
        );
        return true;
      } catch {
        return false;
      }
    },
    [handleUnifiedSaveFile, themeFiles, workspaceScope],
  );

  const handleSwapThemeFileSiblings = useCallback(
    async (filePath: string, draggedNodeId: string, targetNodeId: string) => {
      const currentSource =
        useThemeWorkspaceStore
          .getState()
          .getWorkspaceFiles(
            workspaceScope.storefrontId,
            workspaceScope.themeId,
          )[filePath]?.localContent ??
        themeFiles.find((file) => file.path === filePath)?.content;
      if (!currentSource) {
        toast.error(`Cannot reorder: source file ${filePath} is unavailable.`);
        return;
      }

      const result = swapSiblingMorphNodes(
        currentSource,
        draggedNodeId,
        targetNodeId,
      );
      if (!result.editable) {
        const message = (() => {
          switch (result.reason) {
            case "not-siblings":
              return "Only elements under the same source parent can be reordered.";
            case "parse-error":
              return `Cannot reorder because ${filePath} contains a syntax error.`;
            case "same-node":
              // Dropped where it already was. Nothing changed and nothing failed.
              return null;
            default:
              return "This rendered element cannot be mapped to one unique source sibling.";
          }
        })();
        if (message) toast.warning(message);
        postPreviewThemeFiles(
          themeFiles.map((file) => ({
            path: file.path,
            content:
              useThemeWorkspaceStore
                .getState()
                .getWorkspaceFiles(
                  workspaceScope.storefrontId,
                  workspaceScope.themeId,
                )[file.path]?.localContent ?? file.content,
          })),
        );
        return;
      }

      try {
        await handleUnifiedSaveFile(filePath, result.code);
      } catch (error) {
        updateWorkspaceLocal(filePath, currentSource, workspaceScope);
        postPreviewThemeFiles(
          themeFiles.map((file) => ({
            path: file.path,
            content:
              file.path === filePath
                ? currentSource
                : (useThemeWorkspaceStore
                    .getState()
                    .getWorkspaceFiles(
                      workspaceScope.storefrontId,
                      workspaceScope.themeId,
                    )[file.path]?.localContent ?? file.content),
          })),
        );
        toast.error(
          `Failed to reorder source elements: ${error instanceof Error ? error.message : "Save failed"}`,
        );
      }
    },
    [
      handleUnifiedSaveFile,
      postPreviewThemeFiles,
      themeFiles,
      updateWorkspaceLocal,
      workspaceScope,
    ],
  );

  const handleResolveConflict = useCallback(
    async (filePath: string, resolution: "reload" | "force_mine") => {
      const resolved = resolveWorkspaceConflict(
        filePath,
        resolution,
        workspaceScope,
      );
      if (!resolved) return;

      if (resolution === "reload") {
        await queryClient.invalidateQueries({
          queryKey: storefrontThemeFileQueries.tree(
            context.storefront.id,
            context.theme.id,
          ).queryKey,
        });
        const workspace = useThemeWorkspaceStore.getState();
        if (!workspace.hasActiveConflictsOrErrors(workspaceScope)) {
          workspace.acceptRemoteGeneration(undefined, workspaceScope);
        }
        // The local content is now the remote version. Every entry for this
        // file describes the local edits that were just discarded, so replaying
        // one would bring them back over the version that won.
        history.discardScope(themeFileHistoryScope(filePath));
        postPreviewThemeFiles(
          themeFiles.flatMap((file) => {
            const current = useThemeWorkspaceStore
              .getState()
              .getWorkspaceFiles(
                workspaceScope.storefrontId,
                workspaceScope.themeId,
              )[file.path];
            return current
              ? [{ path: file.path, content: current.localContent }]
              : [];
          }),
        );
        toast.info(`Reloaded remote state of ${filePath}`);
        return;
      }

      const local = useThemeWorkspaceStore
        .getState()
        .getWorkspaceFiles(workspaceScope.storefrontId, workspaceScope.themeId)[
        filePath
      ]?.localContent;
      if (local === undefined) return;
      toast.info(`Applying local version of ${filePath}...`);
      await handleUnifiedSaveFile(filePath, local);
    },
    [
      context.storefront.id,
      context.theme.id,
      handleUnifiedSaveFile,
      history,
      queryClient,
      resolveWorkspaceConflict,
      themeFiles,
      workspaceScope,
    ],
  );

  const handlePublish = useCallback(
    async (note?: string) => {
      if (monacoDirtyFiles.length > 0) {
        toast.error(
          `Cannot publish: save Code Editor changes first (${monacoDirtyFiles.join(", ")}).`,
        );
        return;
      }

      if (
        useThemeWorkspaceStore
          .getState()
          .hasActiveConflictsOrErrors(workspaceScope)
      ) {
        toast.error(
          "Cannot publish: resolve source conflicts/save errors first.",
        );
        return;
      }

      if (!activeTemplate) {
        toast.error("Cannot publish: template is missing.");
        return;
      }

      // 1. Flush any pending debounced props saves and await queued template mutations
      await flushTemplatePendingProps(activeTemplate.id);

      const publishDraftRevisionId =
        templateDraftRevisionIdRef.current.get(activeTemplate.id) ??
        activeTemplate.draftRevisionId;
      const publishDraftGeneration =
        templateDraftGenerationRef.current.get(activeTemplate.id) ??
        activeTemplate.draftGeneration ??
        1;

      const scopedPrefix = `${workspaceScope.storefrontId}:${workspaceScope.themeId}:`;
      for (const [opKey, timer] of Array.from(
        pendingSaveTimersRef.current.entries(),
      )) {
        if (opKey.startsWith(scopedPrefix)) {
          clearTimeout(timer);
          pendingSaveTimersRef.current.delete(opKey);
          const filePath = opKey.slice(scopedPrefix.length);
          const content = useThemeWorkspaceStore
            .getState()
            .getWorkspaceFiles(
              workspaceScope.storefrontId,
              workspaceScope.themeId,
            )[filePath]?.localContent;
          if (content !== undefined) {
            try {
              await handleUnifiedSaveFile(filePath, content);
            } catch (error) {
              toast.error(
                `Failed to save ${filePath}: ${
                  error instanceof Error ? error.message : "Save failed"
                }`,
              );
              return;
            }
          }
        }
      }

      const themeOpKey = `${workspaceScope.storefrontId}:${workspaceScope.themeId}`;
      const pendingThemeSave = saveQueueRef.current.get(themeOpKey);
      if (pendingThemeSave) {
        await pendingThemeSave.catch(() => null);
      }

      const workspace = useThemeWorkspaceStore.getState();
      if (
        workspace.hasActiveConflictsOrErrors(workspaceScope) ||
        workspace.hasUnsavedEdits(workspaceScope)
      ) {
        toast.error(
          "Cannot publish: source workspace is not fully saved and conflict-free.",
        );
        return;
      }

      if (!activeTemplate || !publishDraftRevisionId) {
        toast.error("Cannot publish: template draft revision is missing.");
        return;
      }

      const currentGeneration = useThemeWorkspaceStore
        .getState()
        .getBaseSourceGeneration(workspaceScope);

      // Verify with server that no remote changes occurred behind user's back
      const refreshed = await themeFilesQuery.refetch();
      const serverGeneration = refreshed.data?.sourceGeneration;
      if (
        typeof serverGeneration === "number" &&
        serverGeneration !== currentGeneration
      ) {
        toast.error(
          "Cannot publish: remote source changes detected. Please reload/review files before publishing.",
        );
        return;
      }

      if (
        activeBuildPreview &&
        (activeBuildPreview.status !== "succeeded" ||
          activeBuildSourceGeneration === null)
      ) {
        toast.error("Cannot publish: the selected Build Preview is not ready.");
        return;
      }

      // Publishing needs an artifact that matches the source being published.
      // Building is a step of publishing, not a thing to remember to do first:
      // every comparable platform either builds as part of publishing or has
      // already built automatically, and none makes the person trigger it.
      const plan = resolvePublishBuildPlan({
        hasBuild: Boolean(activeBuildPreview),
        buildSourceGeneration: activeBuildSourceGeneration,
        currentSourceGeneration: currentGeneration,
        activeReleaseSourceGeneration:
          context.theme.activeRelease?.sourceGeneration ?? null,
      });

      let publishBuild = activeBuildPreview;
      if (plan.action === "build") {
        // Marked as publishing's own build so only this path reports progress on
        // the Publish button. A build the person started themselves is not a
        // publish in progress, and saying so would claim their store is about to
        // go live when nothing of the sort was asked for.
        setIsPublishBuilding(true);
        try {
          const attempt = await handleBuildPreviewRef.current?.();
          if (!attempt?.ok || !attempt.build) {
            // The build reported why it failed. Saying "publish failed" on top of
            // that would name the wrong step.
            return;
          }
          publishBuild = attempt.build;
        } finally {
          setIsPublishBuilding(false);
        }
      }

      await publishMutation.mutateAsync({
        sourceRevisionId: publishBuild?.sourceRevisionId,
        themeBuildId: publishBuild?.id,
        note: note?.trim() || undefined,
        expectedDraftRevisionId: publishDraftRevisionId,
        expectedDraftGeneration: publishDraftGeneration,
        expectedReleaseGeneration: context.theme.releaseGeneration ?? 1,
      });
    },
    [
      activeTemplate,
      activeBuildPreview,
      activeBuildSourceGeneration,
      context.storefront.id,
      context.theme.id,
      handleUnifiedSaveFile,
      monacoDirtyFiles,
      publishMutation,
      themeFilesQuery,
      updatePropsMutation,
      workspaceScope,
    ],
  );

  const confirmPublish = useCallback(async () => {
    // Closed first: the run reports itself on the toolbar button, and leaving
    // the panel open over a disabled field only invites a second click.
    setIsPublishNoteOpen(false);
    const note = publishNote;
    setPublishNote("");
    await handlePublish(note);
  }, [handlePublish, publishNote]);

  const handleBuildPreview = useCallback(async (): Promise<BuildAttempt> => {
    if (isBuildPending) return { ok: false };

    if (themeFiles.length === 0) {
      toast.error(
        "Cannot build preview: initialize starter theme files in Code Workspace first.",
      );
      return { ok: false };
    }

    if (
      monacoDirtyFiles.length > 0 ||
      useThemeWorkspaceStore.getState().hasUnsavedEdits(workspaceScope)
    ) {
      toast.error(
        `Cannot build preview: save Code Editor changes first (${monacoDirtyFiles.join(", ")}).`,
      );
      return { ok: false };
    }

    if (
      useThemeWorkspaceStore
        .getState()
        .hasActiveConflictsOrErrors(workspaceScope)
    ) {
      toast.error(
        "Cannot build preview: resolve source conflicts/save errors first.",
      );
      return { ok: false };
    }

    setIsBuildPending(true);
    setBuildDiagnostics(null);

    try {
      const currentGeneration = useThemeWorkspaceStore
        .getState()
        .getBaseSourceGeneration(workspaceScope);

      // 1. Freeze current source files into a revision snapshot
      const freezeResult = await createStorefrontThemeRevision({
        data: {
          storefrontId: context.storefront.id,
          themeId: context.theme.id,
          expectedSourceGeneration: currentGeneration,
          message: "Build Preview Snapshot",
          source: "manual",
        },
      });

      if (!freezeResult.success || !freezeResult.data?.id) {
        toast.error(
          freezeResult.message || "Failed to snapshot source files for build",
        );
        setIsBuildPending(false);
        return { ok: false };
      }

      // 2. Request compilation & immutable R2 artifact persistence
      const buildResult = await createPreviewBuild({
        data: {
          storefrontId: context.storefront.id,
          themeId: context.theme.id,
          sourceRevisionId: freezeResult.data.id,
        },
      });

      if (!buildResult.success || !buildResult.data) {
        toast.error(buildResult.message || "Theme build failed");
        setBuildDiagnostics({ error: buildResult.message });
        setIsBuildPending(false);
        return { ok: false };
      }

      let build: StorefrontThemeBuildDTO = buildResult.data;
      buildIdRef.current = build.id;

      const abortController = new AbortController();
      buildWaitAbortRef.current = abortController;

      const waitResult = await waitForThemeBuild({
        build,
        signal: abortController.signal,
        poll: async (buildId) => {
          const pollResult = await getThemeBuild({
            data: {
              storefrontId: context.storefront.id,
              themeId: context.theme.id,
              buildId,
            },
          });
          return pollResult.success && pollResult.data ? pollResult.data : null;
        },
      });
      build = waitResult.build;

      // Abandoning the wait says nothing about the build, so nothing is
      // reported about it. Unmounting must not raise UI at all.
      if (waitResult.outcome === "aborted") {
        if (waitResult.reason !== "unmount") {
          toast.info(
            `Stopped waiting. Build ${build.id.slice(0, 8)} is still running — reopen Build Preview to pick up the result.`,
          );
        }
        return { ok: false };
      }

      if (build.status === "succeeded") {
        let token = (buildResult.data as StorefrontThemeBuildPreviewDTO)
          .previewToken;
        if (!token) {
          const tokenResult = await getPreviewBuildToken({
            data: {
              storefrontId: context.storefront.id,
              themeId: context.theme.id,
              buildId: build.id,
            },
          });
          if (tokenResult.success && tokenResult.data) {
            token = tokenResult.data.token;
          }
        }

        if (!token) {
          toast.error("Build succeeded but preview capability token missing.");
          setBuildDiagnostics({
            error:
              "Missing preview capability token. Ensure THEME_PREVIEW_SECRET is configured.",
          });
          setActiveBuildPreview(build);
          setActivePreviewToken(null);
          return { ok: false };
        }

        setActiveBuildPreview(build);
        setActivePreviewToken(token);
        setActiveBuildSourceGeneration(currentGeneration);
        setPreviewMode("build");
        toast.success(
          `Build ${build.id.slice(0, 8)} succeeded! Showing immutable preview.`,
        );
        return { ok: true, build, sourceGeneration: currentGeneration };
      } else if (waitResult.outcome === "timeout") {
        // Running out of polls is not a build failure. Saying "failed" here
        // both misreports the build and hides that its result is still coming.
        toast.info(
          `Build ${build.id.slice(0, 8)} is taking longer than expected and is still running — reopen Build Preview to pick up the result.`,
        );
      } else {
        toast.error(build.errorMessage || `Build status: ${build.status}`);
        setBuildDiagnostics(build.diagnosticsJson);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to create preview build");
      setBuildDiagnostics({ error: err?.message || String(err) });
      return { ok: false };
    } finally {
      buildWaitAbortRef.current = null;
      buildIdRef.current = null;
      setIsBuildPending(false);
    }
    // Reached when the build failed or was still running when the wait ended.
    // Neither produced an artifact, so neither is a usable build.
    return { ok: false };
  }, [
    context.storefront.id,
    context.theme.id,
    isBuildPending,
    monacoDirtyFiles,
    themeFiles,
    workspaceScope,
  ]);

  handleBuildPreviewRef.current = handleBuildPreview;

  const handleUpdateThemeFileStyle = useCallback(
    (
      filePath: string,
      elementName: string,
      updater: (prevClasses: string) => string,
      instanceTarget?: ThemeInstanceStyleTarget,
    ) => {
      const workspaceFileSnapshot = useThemeWorkspaceStore
        .getState()
        .getWorkspaceFiles(workspaceScope.storefrontId, workspaceScope.themeId);
      const currentSource =
        workspaceFileSnapshot[filePath]?.localContent ??
        themeFiles.find((file) => file.path === filePath)?.content;
      if (!currentSource) return;

      const queueRelatedFileSave = (
        relatedPath: string,
        relatedCurrent: string,
        relatedNext: string,
      ) => {
        if (relatedNext === relatedCurrent) return;
        // Written without an entry of its own, so anything the history still
        // holds for this file describes a state this write has moved past.
        history.discardScope(themeFileHistoryScope(relatedPath));
        updateWorkspaceLocal(relatedPath, relatedNext, workspaceScope);
        const operationKey = getScopedOpKey(relatedPath);
        const revision = (fileRevisionRef.current.get(operationKey) ?? 0) + 1;
        fileRevisionRef.current.set(operationKey, revision);
        const pendingTimer = pendingSaveTimersRef.current.get(operationKey);
        if (pendingTimer) clearTimeout(pendingTimer);
        pendingSaveTimersRef.current.set(
          operationKey,
          setTimeout(() => {
            pendingSaveTimersRef.current.delete(operationKey);
            saveThemeFileSequentially(relatedPath, relatedNext, revision).catch(
              (err) => {
                toast.error(
                  "Failed to save source file " +
                    relatedPath +
                    ": " +
                    err.message,
                );
              },
            );
          }, 300),
        );
        markWorkspaceDebouncing(relatedPath, workspaceScope);
      };

      let targetFilePath = filePath;
      let targetCurrentSource = currentSource;
      let updatedContent: string;

      if (instanceTarget) {
        const currentFiles = effectiveThemeFiles;
        const legacyStyleSheet = findLegacyThemeInstanceStyleSheet(
          currentFiles,
          filePath,
          instanceTarget,
        );
        const legacyClasses = legacyStyleSheet
          ? readLegacyThemeInstanceStyleClasses(
              workspaceFileSnapshot[legacyStyleSheet.path]?.localContent ??
                legacyStyleSheet.content,
              instanceTarget,
            )
          : null;
        const instancePatch = patchThemeInstanceStyleClasses(
          currentSource,
          instanceTarget,
          elementName,
          (previousClasses) => updater(legacyClasses ?? previousClasses),
        );
        if (!instancePatch.editable) {
          if (instancePatch.reason === "dynamic-classname") {
            toast.warning(
              "Element " +
                elementName +
                " uses an unsupported dynamic className. Use Code mode to preserve component logic.",
            );
          } else if (instancePatch.reason === "parse-error") {
            toast.error(
              "Cannot modify styles: syntax error in " +
                filePath +
                ". Fix TSX in Code mode.",
            );
          } else {
            toast.warning(
              "Cannot safely isolate " +
                instanceTarget.fieldPath +
                " in this component. Add stable Morph metadata or use Code mode.",
            );
          }
          return;
        }
        updatedContent = instancePatch.code;

        if (legacyStyleSheet && legacyClasses !== null) {
          const legacyCurrent =
            workspaceFileSnapshot[legacyStyleSheet.path]?.localContent ??
            legacyStyleSheet.content;
          const nextLegacy = removeLegacyThemeInstanceStyle(
            legacyCurrent,
            instanceTarget,
          );
          queueRelatedFileSave(
            legacyStyleSheet.path,
            legacyCurrent,
            nextLegacy,
          );

          if (
            legacyStyleSheet.path.endsWith(".morph.css") &&
            nextLegacy.trim() === ""
          ) {
            const globalStyleSheet = effectiveThemeFiles.find(
              (file) => file.path === "src/styles/global.css",
            );
            if (globalStyleSheet) {
              const globalCurrent =
                workspaceFileSnapshot[globalStyleSheet.path]?.localContent ??
                globalStyleSheet.content;
              const globalNext = removeLegacyThemeInstanceStyleImport(
                globalCurrent,
                legacyStyleSheet.path,
                globalStyleSheet.path,
              );
              queueRelatedFileSave(
                globalStyleSheet.path,
                globalCurrent,
                globalNext,
              );
            }
          }
        }
      } else {
        const patchResult = patchElementClassNameResult(
          currentSource,
          elementName,
          updater,
        );

        if (!patchResult.editable) {
          if (patchResult.reason === "dynamic-classname") {
            toast.warning(
              `Element "${elementName}" has a dynamic className expression (e.g. cn(...)). Edit in Code mode to preserve component logic.`,
            );
          } else if (patchResult.reason === "parse-error") {
            toast.error(
              `Cannot modify styles: syntax error in ${filePath}. Fix TSX in Code mode.`,
            );
          }
          return;
        }
        updatedContent = patchResult.code;
      }

      if (updatedContent !== targetCurrentSource) {
        updateWorkspaceLocal(targetFilePath, updatedContent, workspaceScope);

        const previewFiles = effectiveThemeFiles.map((file) => ({
          path: file.path,
          content:
            file.path === targetFilePath
              ? updatedContent
              : (useThemeWorkspaceStore
                  .getState()
                  .getWorkspaceFiles(
                    workspaceScope.storefrontId,
                    workspaceScope.themeId,
                  )[file.path]?.localContent ?? file.content),
        }));
        if (!previewFiles.some((file) => file.path === targetFilePath)) {
          previewFiles.push({
            path: targetFilePath,
            content: updatedContent,
          });
        }
        const selection = lastPreviewSelectionRef.current;
        const selectionKey = [
          selection?.sectionId ?? "",
          selection?.sourceLocation ?? "",
          selection?.nodeId ?? "",
          selection?.elementKey ?? "",
          selection?.fieldPath ?? "",
          elementName,
        ].join("|");
        const pendingSelectionStyle = pendingSelectionStyleRef.current;
        const canKeepPreviewTree =
          !instanceTarget &&
          pendingSelectionStyle?.selectionKey === selectionKey &&
          pendingSelectionStyle.targetElement === elementName &&
          Object.values(pendingSelectionStyle.styles).every(
            (value) => value !== "",
          );
        const styleRevision = postPreviewThemeFiles(previewFiles, {
          renderDocument: !canKeepPreviewTree,
        });
        pendingSelectionStyleRef.current = null;

        // Debounce save to database (300ms)
        const opKey = getScopedOpKey(targetFilePath);
        const existingTimer = pendingSaveTimersRef.current.get(opKey);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }

        const nextRevision = (fileRevisionRef.current.get(opKey) ?? 0) + 1;
        fileRevisionRef.current.set(opKey, nextRevision);

        // Recorded against the same write path the edit used, so reversing it
        // inherits the version checks, debouncing and preview sync rather than
        // reaching around them. The value is captured now because the workspace
        // has already moved on by the time anyone presses undo.
        const styleBefore = targetCurrentSource;
        const styleAfter = updatedContent;
        const stylePath = targetFilePath;
        const historyId = history.record({
          label: `Style · ${elementName}`,
          scope: themeFileHistoryScope(stylePath),
          undo: () => {
            resetPreviewSelectionStyle();
            return handleUnifiedSaveFile(stylePath, styleBefore, {
              fromHistory: true,
            });
          },
          redo: () => {
            resetPreviewSelectionStyle();
            return handleUnifiedSaveFile(stylePath, styleAfter, {
              fromHistory: true,
            });
          },
        });

        const newTimer = setTimeout(() => {
          pendingSaveTimersRef.current.delete(opKey);
          saveThemeFileSequentially(
            targetFilePath,
            updatedContent,
            nextRevision,
          )
            .then((result) => {
              // A conflicted write never landed, so there is nothing to reverse;
              // leaving the entry would undo a change that never happened.
              if (result.status === "source-conflict")
                history.discard(historyId);
            })
            .catch((err) => {
              history.discard(historyId);
              toast.error(
                `Failed to save source file ${targetFilePath}: ${err.message}`,
              );
            });
        }, 300);

        pendingSaveTimersRef.current.set(opKey, newTimer);
        markWorkspaceDebouncing(targetFilePath, workspaceScope);
        return styleRevision;
      }
    },
    [
      getScopedOpKey,
      effectiveThemeFiles,
      markWorkspaceDebouncing,
      saveThemeFileSequentially,
      themeFiles,
      postPreviewThemeFiles,
      updateWorkspaceLocal,
      workspaceScope,
    ],
  );

  const normalWidthSessionKey = activeTemplate
    ? `morph:editor-normal-width:${context.storefront.id}:${context.theme.id}:${activeTemplate.id}`
    : null;
  const lastNormalWidthRef = useRef<number>(previewDefaultWidths.desktop);

  useEffect(() => {
    if (typeof window !== "undefined" && normalWidthSessionKey) {
      try {
        const saved = sessionStorage.getItem(normalWidthSessionKey);
        if (saved) {
          const parsed = parseInt(saved, 10);
          if (parsed > 0) {
            lastNormalWidthRef.current = parsed;
          }
        }
      } catch {}
    }
  }, [normalWidthSessionKey]);

  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const previewWidthRef = useRef(previewWidth);
  const previewFrameHeightRef = useRef(previewFrameHeight);
  const canvasTransformRef = useRef(canvasTransform);
  const canvasRenderFrameRef = useRef(0);
  const canvasTransformCommitTimerRef = useRef(0);
  const canvasViewportHeightRef = useRef(0);
  const previewRemeasureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const previewKeyRef = useRef(previewKey);
  useEffect(() => {
    previewKeyRef.current = previewKey;
  }, [previewKey]);
  const previewWidthRenderFrameRef = useRef(0);
  const lastPreviewWheelActivityAtRef = useRef(0);
  const panOriginRef = useRef<{
    pointerId: number;
    pointerX: number;
    pointerY: number;
    canvasX: number;
    canvasY: number;
    source: "canvas" | "preview";
  } | null>(null);
  const resizeOriginRef = useRef<{
    pointerId: number;
    pointerX: number;
    width: number;
    edge: "left" | "right";
    scale: number;
  } | null>(null);

  const applyCanvasTransformToDom = useCallback(
    (transform: CanvasTransform) => {
      const viewport = canvasViewportRef.current;
      if (!viewport) return;

      viewport.style.setProperty("--morph-canvas-x", `${transform.x}px`);
      viewport.style.setProperty("--morph-canvas-y", `${transform.y}px`);
      viewport.style.setProperty(
        "--morph-canvas-scale",
        String(transform.scale),
      );
      viewport.style.setProperty(
        "--morph-canvas-half-width",
        `${(previewWidthRef.current * transform.scale) / 2}px`,
      );
      viewport.style.setProperty(
        "--morph-canvas-scaled-height",
        `${previewFrameHeightRef.current * transform.scale}px`,
      );
    },
    [],
  );

  const scheduleCanvasTransformCommit = useCallback(() => {
    if (canvasTransformCommitTimerRef.current !== 0) {
      window.clearTimeout(canvasTransformCommitTimerRef.current);
    }
    canvasTransformCommitTimerRef.current = window.setTimeout(() => {
      canvasTransformCommitTimerRef.current = 0;
      const current = canvasTransformRef.current;
      setCanvasTransform((previous) =>
        previous.x === current.x &&
        previous.y === current.y &&
        previous.scale === current.scale
          ? previous
          : current,
      );
    }, CANVAS_SCROLL_COMMIT_DELAY_MS);
  }, []);

  const scheduleCanvasTransform = useCallback(
    (
      action: CanvasTransform | ((current: CanvasTransform) => CanvasTransform),
    ) => {
      const current = canvasTransformRef.current;
      const requested = typeof action === "function" ? action(current) : action;
      const viewportHeight =
        canvasViewportHeightRef.current ||
        canvasViewportRef.current?.clientHeight ||
        0;
      const next =
        viewportHeight > 0
          ? clampCanvasTransform(
              requested,
              viewportHeight,
              previewFrameHeightRef.current,
            )
          : requested;
      const didChange = !(
        next.x === current.x &&
        next.y === current.y &&
        next.scale === current.scale
      );
      if (!didChange) return;

      canvasTransformRef.current = next;
      if (canvasTransformCommitTimerRef.current !== 0) {
        window.clearTimeout(canvasTransformCommitTimerRef.current);
        canvasTransformCommitTimerRef.current = 0;
      }
      if (canvasRenderFrameRef.current !== 0) return;

      canvasRenderFrameRef.current = requestAnimationFrame(() => {
        canvasRenderFrameRef.current = 0;
        applyCanvasTransformToDom(canvasTransformRef.current);
        scheduleCanvasTransformCommit();
      });
    },
    [applyCanvasTransformToDom, scheduleCanvasTransformCommit],
  );

  // The iframe keeps its current dimensions while the preview settles. Theme
  // viewport units resolve against the separate viewport-height token inside
  // the preview, so changing the frame first would only create a visible jump
  // and reintroduce a frame/content feedback loop.
  const schedulePreviewRemeasure = useCallback(() => {
    const measurementRevision = beginPreviewSizeMeasurement();
    if (previewRemeasureTimerRef.current) {
      clearTimeout(previewRemeasureTimerRef.current);
    }
    previewRemeasureTimerRef.current = setTimeout(() => {
      previewRemeasureTimerRef.current = null;
      const key = previewKeyRef.current;
      const frameWindow = previewIframeRef.current?.contentWindow;
      if (!key || !frameWindow) return;
      // Two frames give route/source React updates and browser layout time to
      // settle. The revision was advanced before the delay, so any response
      // still in flight for the previous route/source is ignored.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (
            measurementRevision !== previewSizeMeasurementRevisionRef.current
          ) {
            return;
          }
          requestPreviewSize(measurementRevision);
        }),
      );
    }, PREVIEW_REMEASURE_DELAY_MS);
  }, [beginPreviewSizeMeasurement, requestPreviewSize]);

  useEffect(() => {
    schedulePreviewRemeasureRef.current = schedulePreviewRemeasure;
  }, [schedulePreviewRemeasure]);

  useEffect(
    () => () => {
      if (previewRemeasureTimerRef.current) {
        clearTimeout(previewRemeasureTimerRef.current);
      }
    },
    [],
  );

  const scheduleCanvasScroll = useCallback(
    (deltaY: number) => {
      scheduleCanvasTransform((current) => ({
        ...current,
        y: current.y - deltaY,
      }));
    },
    [scheduleCanvasTransform],
  );

  /**
   * Route navigation keeps the preview iframe mounted, so the editor canvas
   * transform would otherwise carry the previous page's vertical scroll into
   * the newly rendered route. Keep the current zoom and horizontal position,
   * but always start a different route at the top of the canvas.
   */
  const resetCanvasScrollPosition = useCallback(() => {
    scheduleCanvasTransform((current) =>
      current.y === 0 ? current : { ...current, y: 0 },
    );
  }, [scheduleCanvasTransform]);

  const centerCanvasOnThread = useCallback(
    (thread: StorefrontCommentThreadDTO, frameHeight: number) => {
      if (typeof thread.positionY !== "number") return;
      scheduleCanvasTransform((current) => {
        const viewportHeight = canvasViewportHeightRef.current || 800;
        const pinYInFrame = (thread.positionY / 100) * frameHeight;
        const centeredY =
          viewportHeight / 2 -
          CANVAS_TOP_INSET -
          pinYInFrame * current.scale -
          40;

        return {
          ...current,
          y: centeredY,
        };
      });
    },
    [scheduleCanvasTransform],
  );

  useEffect(() => {
    previewFrameHeightRef.current = previewFrameHeight;
    if (activeCommentThreadId) {
      const activeThread = commentThreads.find(
        (t) => t.id === activeCommentThreadId,
      );
      if (activeThread) {
        centerCanvasOnThread(activeThread, previewFrameHeight);
        return;
      }
    }
    scheduleCanvasTransform((current) => current);
  }, [
    previewFrameHeight,
    previewKey,
    activeCommentThreadId,
    commentThreads,
    centerCanvasOnThread,
    scheduleCanvasTransform,
  ]);

  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;

    canvasViewportHeightRef.current = viewport.clientHeight;
    const observer = new ResizeObserver(([entry]) => {
      canvasViewportHeightRef.current = entry?.contentRect.height ?? 0;
      scheduleCanvasTransform((current) => current);
    });
    observer.observe(viewport);

    return () => observer.disconnect();
  }, [scheduleCanvasTransform]);

  useEffect(() => {
    if (
      previousTemplateIdRef.current &&
      previousTemplateIdRef.current !== search.templateId
    ) {
      lastPreviewSelectionRef.current = null;
      pendingPreviewSelectionRef.current = null;
      setActiveSelection(null);
      resetCanvasScrollPosition();
    }
    previousTemplateIdRef.current = search.templateId;
  }, [resetCanvasScrollPosition, search.templateId]);

  useEffect(() => {
    if (previousRoutePathRef.current !== search.routePath) {
      lastPreviewSelectionRef.current = null;
      pendingPreviewSelectionRef.current = null;
      setActiveSelection(null);
      resetCanvasScrollPosition();
    }
    previousRoutePathRef.current = search.routePath;
  }, [resetCanvasScrollPosition, search.routePath]);

  useEffect(() => {
    if (activeTemplate && search.templateId !== activeTemplate.id) {
      onSearchChange({
        template: activeTemplate.type,
        templateId: activeTemplate.id,
      });
    }
  }, [activeTemplate, onSearchChange, search.templateId]);

  useEffect(() => {
    const nextWidth =
      search.canvasWidth ?? previewDefaultWidths[search.viewport];
    previewWidthRef.current = nextWidth;
    cancelAnimationFrame(previewWidthRenderFrameRef.current);
    previewWidthRenderFrameRef.current = 0;
    setPreviewWidth(nextWidth);
  }, [search.canvasWidth, search.viewport]);

  useEffect(
    () => () => {
      cancelAnimationFrame(canvasRenderFrameRef.current);
      cancelAnimationFrame(previewWidthRenderFrameRef.current);
      window.clearTimeout(canvasTransformCommitTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (draftCommentPin) {
          e.preventDefault();
          e.stopPropagation();
          setDraftCommentPin(null);
        } else if (activeCommentThreadId) {
          e.preventDefault();
          e.stopPropagation();
          setActiveCommentThreadId(null);
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown, true);
    return () =>
      window.removeEventListener("keydown", handleGlobalKeyDown, true);
  }, [draftCommentPin, activeCommentThreadId]);

  useEffect(() => {
    if (!previewKey) return;

    const handlePreviewMessage = (event: MessageEvent<unknown>) => {
      const message = parseLivePreviewMessage(event);
      if (message?.type !== "morph:storefront-preview-size") return;
      if (
        message.measurementRevision !==
        previewSizeMeasurementRevisionRef.current
      ) {
        return;
      }

      const height = Math.min(30_000, Math.max(320, Math.ceil(message.height)));
      setPreviewContentSize((current) =>
        current?.key === previewKey && Math.abs(current.height - height) < 1
          ? current
          : { key: previewKey, height },
      );
    };

    window.addEventListener("message", handlePreviewMessage);
    requestPreviewSize();
    return () => window.removeEventListener("message", handlePreviewMessage);
  }, [parseLivePreviewMessage, previewKey, requestPreviewSize]);

  useEffect(() => {
    if (!previewKey) return;

    const handlePreviewSelection = (event: MessageEvent<unknown>) => {
      const message = parseLivePreviewMessage(event);
      if (!message) {
        // A rejected message is dropped whole and the editor keeps whatever it
        // accepted last. That silence is how a structure the validator refused
        // went unnoticed while the panel kept rendering a Theme that no longer
        // existed.
        if (
          import.meta.env.DEV &&
          typeof (event.data as { type?: unknown })?.type === "string" &&
          (event.data as { type: string }).type.startsWith(
            "morph:storefront-preview-",
          )
        ) {
          console.warn(
            "[morph] preview message rejected by validation:",
            (event.data as { type: string }).type,
          );
        }
        return;
      }

      if (
        message.type === "morph:storefront-preview-commit-array-item-reorder"
      ) {
        reportAuthenticatedUserActivity();
        arrayItemReorderHandlerRef.current(
          message.sectionId,
          message.draggedFieldPath,
          message.targetFieldPath,
        );
        return;
      }

      if (message.type === "morph:storefront-preview-commit-inline-text") {
        reportAuthenticatedUserActivity();
        inlineTextCommitHandlerRef.current(message);
        return;
      }

      if (message.type === "morph:storefront-preview-commit-section-reorder") {
        reportAuthenticatedUserActivity();
        void sectionSwapHandlerRef.current(
          message.draggedSectionId,
          message.targetSectionId,
        );
        return;
      }

      if (message.type === "morph:storefront-preview-commit-sibling-reorder") {
        reportAuthenticatedUserActivity();
        void handleSwapThemeFileSiblings(
          message.sourceFilePath,
          message.draggedNodeId,
          message.targetNodeId,
        );
        return;
      }

      if (message.type === "morph:storefront-preview-ready") {
        setPreviewFrameReady((current) => ({
          key: previewKey,
          sequence: current?.key === previewKey ? current.sequence + 1 : 1,
        }));
        return;
      }
      if (message.type === "morph:storefront-preview-structure") {
        setPreviewStructure({ key: previewKey, nodes: message.nodes });
        return;
      }
      if (
        message.type === "morph:storefront-preview-theme-files-applied" ||
        message.type === "morph:storefront-preview-theme-files-failed"
      ) {
        const initialPreviewSync = initialPreviewSyncRef.current;
        if (
          initialPreviewSync?.key !== previewKey ||
          !shouldRevealPreviewForStyleAck(
            message.styleRevision,
            latestStyleRevisionRef.current,
            initialPreviewSync.styleRevision,
          )
        ) {
          return;
        }
        setLoadedPreviewKey(previewKey);
        if (message.type === "morph:storefront-preview-theme-files-failed") {
          setPreviewLoadFailure({
            key: previewKey,
            message:
              "Live Preview could not apply the current Theme source. Check the Theme compile diagnostic, then retry.",
          });
          return;
        }
        setPreviewLoadFailure((current) =>
          current?.key === previewKey ? null : current,
        );
        latestAppliedStyleRevisionRef.current = message.styleRevision;
        postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
          type: "morph:storefront-preview-request-selection-style",
          styleRevision: message.styleRevision,
        });
        return;
      }
      if (message.type !== "morph:storefront-preview-select-section") return;
      reportAuthenticatedUserActivity();

      const responseStyleRevision = message.styleRevision;
      if (
        !isLatestStyleRevision(
          responseStyleRevision,
          latestStyleRevisionRef.current,
        )
      )
        return;
      const responseSelectionRevision = message.selectionRevision ?? 0;
      if (responseSelectionRevision < previewSelectionRevisionRef.current) {
        return;
      }
      const incomingTarget: PreviewSelectionRestoreTarget = {
        sectionId: message.sectionId,
        sourceLocation: message.sourceLocation ?? undefined,
        nodeId: message.nodeId ?? undefined,
        fieldPath: message.fieldPath ?? undefined,
        elementKey: message.elementKey ?? undefined,
        fieldKey: message.fieldKey ?? message.field ?? undefined,
        isSection: message.isSection,
      };
      const pendingSelection = pendingPreviewSelectionRef.current;
      // A route/context sync can make the iframe briefly report its section
      // element after the sidebar has already requested a descendant. Keep
      // that older response out of both inspectors. A newer canvas click is
      // allowed through because its iframe revision is greater.
      if (
        pendingSelection &&
        responseSelectionRevision <= pendingSelection.revision &&
        !previewSelectionTargetMatches(pendingSelection.target, incomingTarget)
      ) {
        return;
      }
      previewSelectionRevisionRef.current = Math.max(
        previewSelectionRevisionRef.current,
        responseSelectionRevision,
      );
      pendingPreviewSelectionRef.current = null;
      const sectionId = message.sectionId;
      const nodeId = message.nodeId ?? null;
      const sourceFilePath = message.sourceFilePath;
      const elementKey = message.elementKey;
      const fieldKey = message.fieldKey ?? message.field;
      const fieldPath = message.fieldPath ?? fieldKey;
      const contentValue = message.contentValue ?? null;
      const descendantFields = message.descendantFields;
      const tagName = message.tagName;
      const role = message.role;
      const inputType = message.inputType;
      const selectionKind = message.kind;
      const className = message.className;
      const selectionIsSection = message.isSection;
      const computedStyle = message.computedStyle;
      const parentComputedStyle = message.parentComputedStyle;
      const sectionComputedStyle = message.sectionComputedStyle;
      const inspectorOverride = message.inspectorOverride;
      lastPreviewSelectionRef.current = incomingTarget;
      const componentType =
        activeRouteSections.find((section) => section.slotId === sectionId)
          ?.sectionType ??
        activeTemplate?.document.sections.find(
          (section) => section.id === sectionId,
        )?.type ??
        "custom";

      setActiveSelection({
        sectionId,
        kind: selectionKind,
        componentType,
        tagName,
        role,
        inputType,
        nodeId,
        sourceFilePath,
        sourceLocation: message.sourceLocation ?? null,
        elementKey,
        fieldKey,
        fieldPath,
        contentValue,
        descendantFields,
        className,
        isSection: selectionIsSection,
        computed: computedStyle,
        parentComputed: parentComputedStyle,
        sectionComputed: sectionComputedStyle,
        inspectorOverride,
      });
      setActiveComputedStyleRevision(responseStyleRevision);

      if (sectionId !== search.section) {
        onSearchChange({ section: sectionId });
      }
    };

    window.addEventListener("message", handlePreviewSelection);
    return () => window.removeEventListener("message", handlePreviewSelection);
  }, [
    activeTemplate,
    activeRouteSections,
    handleSwapThemeFileSiblings,
    handleUpdateThemeFileStyle,
    isSelectionMode,
    onSearchChange,
    previewKey,
    search.section,
    search.viewport,
  ]);

  const syncPreviewRoute = useCallback(() => {
    if (!activeTemplate) return;
    postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
      type: "morph:storefront-preview-set-route",
      templateId: activeTemplate.id,
      routePath: search.routePath ?? null,
    });
  }, [activeTemplate, postEditorToPreviewMessage, search.routePath]);

  useEffect(() => {
    if (!previewKey || previewFrameReady?.key !== previewKey) return;

    const measurementRevision = beginPreviewSizeMeasurement();
    syncPreviewRoute();
    // Let the preview commit the route state before asking for its structure
    // and size. This avoids reading the previous page's DOM in the same task.
    const frame = window.requestAnimationFrame(() => {
      postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
        type: "morph:storefront-preview-request-structure",
      });
      requestPreviewSize(measurementRevision);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    postEditorToPreviewMessage,
    previewFrameReady?.key,
    previewKey,
    beginPreviewSizeMeasurement,
    requestPreviewSize,
    syncPreviewRoute,
  ]);

  const syncPreviewSection = useCallback(() => {
    const restoreTarget =
      isSelectionMode &&
      lastPreviewSelectionRef.current?.sectionId === (search.section ?? null)
        ? lastPreviewSelectionRef.current
        : undefined;
    postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
      type: "morph:storefront-preview-set-section",
      sectionId: search.section ?? null,
      ...(restoreTarget
        ? {
            restoreTarget,
            selectionRevision: previewSelectionRevisionRef.current,
          }
        : {}),
    });
  }, [isSelectionMode, search.section]);

  const handleSectionsSearchChange = useCallback(
    (next: Partial<StorefrontThemeEditorSearch>) => {
      if (next.section !== undefined) {
        const sectionId = next.section ?? null;
        if (!sectionId) {
          pendingPreviewSelectionRef.current = null;
          lastPreviewSelectionRef.current = null;
          setActiveSelection(null);
          setActiveComputedStyleRevision(0);
        } else {
          const target = {
            sectionId,
            isSection: true,
          } satisfies PreviewSelectionRestoreTarget;
          const componentType =
            activeRouteSections.find((section) => section.slotId === sectionId)
              ?.sectionType ??
            activeTemplate?.document.sections.find(
              (section) => section.id === sectionId,
            )?.type ??
            "custom";
          lastPreviewSelectionRef.current = target;
          setActiveSelection(
            createEditorSelectionDescriptor(target, null, componentType),
          );
          setActiveComputedStyleRevision(0);
          if (isSelectionMode) {
            const selectionRevision = nextPreviewSelectionRevision();
            pendingPreviewSelectionRef.current = {
              target,
              revision: selectionRevision,
            };
            for (const message of createSelectionRestoreMessages(
              true,
              target,
              selectionRevision,
            )) {
              postEditorToPreviewMessage(
                previewIframeRef.current?.contentWindow,
                {
                  ...message,
                },
              );
            }
          } else {
            pendingPreviewSelectionRef.current = null;
          }
        }
      }
      onSearchChange(next);
    },
    [
      activeRouteSections,
      activeTemplate,
      isSelectionMode,
      nextPreviewSelectionRevision,
      onSearchChange,
    ],
  );

  const handleEditableNodeSelect = useCallback(
    (target: PreviewSelectionRestoreTarget) => {
      reportAuthenticatedUserActivity();
      const previewNodes =
        previewStructure?.key === previewKey ? previewStructure.nodes : [];
      const selectedNode =
        previewNodes.find((node) =>
          previewSelectionTargetMatches(node.target, target),
        ) ?? null;
      const componentType =
        activeRouteSections.find(
          (section) => section.slotId === target.sectionId,
        )?.sectionType ??
        activeTemplate?.document.sections.find(
          (section) => section.id === target.sectionId,
        )?.type ??
        "custom";
      const nextSelection = createEditorSelectionDescriptor(
        target,
        selectedNode,
        componentType,
        collectEditableNodeDescendantFields(selectedNode, previewNodes),
      );
      const selectionRevision = nextPreviewSelectionRevision();
      pendingPreviewSelectionRef.current = {
        target,
        revision: selectionRevision,
      };
      setActiveSelection(nextSelection);
      setActiveComputedStyleRevision(0);
      lastPreviewSelectionRef.current = target;
      if (target.sectionId !== search.section) {
        onSearchChange({ section: target.sectionId });
      }
      setIsSelectionMode(true);
      for (const message of createSelectionRestoreMessages(
        true,
        target,
        selectionRevision,
      )) {
        postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
          ...message,
        });
      }
    },
    [
      activeRouteSections,
      activeTemplate,
      nextPreviewSelectionRevision,
      onSearchChange,
      previewKey,
      previewStructure,
      search.section,
    ],
  );

  const handleDeleteEditableNode = useCallback(
    async (
      node: PreviewEditableNode,
    ): Promise<EditorEditableNodeDeleteResult> => {
      reportAuthenticatedUserActivity();

      if (node.target.isSection) {
        return {
          success: false,
          message: "Sections are managed from the page structure tree.",
        };
      }

      // A repeated runtime item is rendered from one shared JSX node. Deleting
      // it from the source would silently remove every item, so keep this
      // destructive action bounded to the shared, non-repeated component tree.
      if (
        node.target.fieldPath?.split(".").some((part) => /^\d+$/.test(part))
      ) {
        return {
          success: false,
          message:
            "Repeated items cannot be deleted from one preview row. Use Code mode to remove the shared component safely.",
        };
      }

      const sourceLocation = parseThemeSourceLocation(
        node.target.sourceLocation,
      );
      const filePath = sourceLocation?.filePath ?? null;
      const targetKey =
        node.target.nodeId ?? sourceLocationKey(node.target.sourceLocation);
      if (!filePath || !targetKey) {
        return {
          success: false,
          message:
            "This element has no stable source mapping. Open Code mode to remove it safely.",
        };
      }

      const sourceFile = effectiveThemeFiles.find(
        (file) => file.path === filePath,
      );
      const currentSource =
        useThemeWorkspaceStore
          .getState()
          .getWorkspaceFiles(
            workspaceScope.storefrontId,
            workspaceScope.themeId,
          )[filePath]?.localContent ?? sourceFile?.content;
      if (!sourceFile || currentSource === undefined) {
        return {
          success: false,
          message: `The source file ${filePath} is unavailable.`,
        };
      }

      const result = removeJsxElement(currentSource, targetKey);
      if (!result.editable) {
        const message =
          result.reason === "parse-error"
            ? `Cannot delete from ${filePath}: fix its TSX syntax in Code mode first.`
            : result.reason === "not-direct-child"
              ? "This element is inside a dynamic expression and cannot be removed safely from the tree."
              : "This element no longer maps to one unique source node. Refresh the preview and try again.";
        return { success: false, message };
      }

      try {
        const saved = await handleUnifiedSaveFile(filePath, result.code, {
          preserveCanvasPosition: true,
        });
        if (saved === null) {
          return {
            success: false,
            message: `Could not delete from ${filePath} because the source changed remotely.`,
          };
        }
      } catch (error) {
        return {
          success: false,
          message:
            error instanceof Error
              ? error.message
              : `Failed to delete from ${filePath}.`,
        };
      }

      lastPreviewSelectionRef.current = null;
      pendingPreviewSelectionRef.current = null;
      setActiveSelection(null);
      setActiveComputedStyleRevision(0);
      return { success: true };
    },
    [effectiveThemeFiles, handleUnifiedSaveFile, workspaceScope],
  );

  const handleDeleteSection = useCallback(
    async (sectionId: string): Promise<EditorEditableNodeDeleteResult> => {
      reportAuthenticatedUserActivity();

      if (!activeThemeRoute) {
        return {
          success: false,
          message: "The active template has no source-authored route.",
        };
      }
      if (activeTemplate) await flushTemplatePendingProps(activeTemplate.id);

      const routeFile = effectiveThemeFiles.find(
        (file) => file.path === activeThemeRoute.sourcePath,
      );
      if (!routeFile) {
        return {
          success: false,
          message: "The active route source is unavailable.",
        };
      }

      const result = removeThemeRouteSection(
        routeFile.content,
        effectiveThemeFiles,
        activeThemeRoute.sourcePath,
        sectionId,
      );
      if (result.diagnostic) {
        return { success: false, message: result.diagnostic };
      }
      if (!result.changed) {
        return {
          success: false,
          message: `Section "${sectionId}" could not be removed from the route source.`,
        };
      }

      try {
        const saved = await handleUnifiedSaveFile(
          activeThemeRoute.sourcePath,
          result.code,
          { preserveCanvasPosition: true },
        );
        if (saved === null) {
          return {
            success: false,
            message:
              "Could not delete the section because the source changed remotely.",
          };
        }
      } catch (error) {
        return {
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Failed to delete the section from the route source.",
        };
      }

      if (search.section === sectionId) {
        const nextSectionId = activeRouteSections.find(
          (section) => section.slotId !== sectionId,
        )?.slotId;
        onSearchChange({ section: nextSectionId ?? "" });
      }
      lastPreviewSelectionRef.current = null;
      pendingPreviewSelectionRef.current = null;
      setActiveSelection(null);
      setActiveComputedStyleRevision(0);
      return { success: true };
    },
    [
      activeRouteSections,
      activeTemplate,
      activeThemeRoute,
      effectiveThemeFiles,
      flushTemplatePendingProps,
      handleUnifiedSaveFile,
      onSearchChange,
      search.section,
    ],
  );

  const syncPreviewSectionOrder = useCallback((sectionIds: string[]) => {
    postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
      type: "morph:storefront-preview-set-section-order",
      sectionIds,
    });
    schedulePreviewRemeasureRef.current();
  }, []);

  const syncPreviewSectionProps = useCallback(
    (sectionId: string, props?: PreviewSectionProps, enabled?: boolean) => {
      postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
        type: "morph:storefront-preview-update-section-props",
        sectionId,
        props,
        enabled,
      });
      // Anything that changes what the canvas renders has to re-measure, not
      // just a file write. The theme's own `min-h-screen` resolves against the
      // frame, so content that becomes shorter cannot report itself shorter —
      // hiding a section or shortening a heading would otherwise leave the
      // space it used to occupy behind.
      schedulePreviewRemeasureRef.current();
    },
    [],
  );

  /**
   * The stored props of one section, as a plain object to restore later.
   *
   * Read from the active template rather than from the Inspector's local state,
   * because the Inspector has already applied the edit optimistically by the
   * time this runs.
   */
  const sectionPropsSnapshot = useCallback(
    (sectionId: string): Record<string, unknown> => {
      const section = activeTemplate?.document.sections.find(
        (candidate) => candidate.id === sectionId,
      );
      return { ...((section?.props ?? {}) as Record<string, unknown>) };
    },
    [activeTemplate],
  );

  const handleSectionPropsChange = useCallback(
    (
      sectionId: string,
      nextProps: Record<string, unknown>,
      options?: InspectorPropsChangeOptions,
    ) => {
      // 1. Instant 0ms visual sync to iframe canvas
      const previewProps = parsePreviewSectionProps(nextProps);
      if (!options?.skipPreviewSync && previewProps) {
        syncPreviewSectionProps(sectionId, previewProps);
      }

      if (!activeTemplate) return;
      const templateId = activeTemplate.id;
      const key = `${templateId}:${sectionId}`;

      // 2. Debounced per-section timer (does NOT cancel edits on other sections)
      const existingTimer = pendingPropsTimersRef.current.get(key);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const existingProps = pendingPropsMapRef.current.get(key)?.props ?? {};
      const mergedProps = { ...existingProps, ...nextProps };
      // The value to go back to is whatever was stored before this run of edits
      // began — not the previous keystroke. Captured once per debounce window so
      // typing a word is one undo, not one per character.
      if (!pendingPropsMapRef.current.has(key)) {
        pendingPropsBaselineRef.current.set(
          key,
          sectionPropsSnapshot(sectionId),
        );
      }
      pendingPropsMapRef.current.set(key, { sectionId, props: mergedProps });

      const timer = setTimeout(async () => {
        pendingPropsTimersRef.current.delete(key);
        const pending = pendingPropsMapRef.current.get(key);
        if (!pending) return;

        const baseline = pendingPropsBaselineRef.current.get(key);

        // The entry stays queued until the write is acknowledged. Clearing it
        // before awaiting meant a rejected edit was gone: the preview had
        // already been updated, so the canvas and Inspector went on showing
        // content the server refused, with nothing left to retry from.
        let result: Awaited<ReturnType<typeof enqueueTemplateMutation>>;
        try {
          result = await enqueueTemplateMutation(templateId, (gen) =>
            updatePropsMutation.mutateAsync({
              sectionId: pending.sectionId,
              props: pending.props,
              expectedDraftGeneration: gen,
            }),
          );
        } catch (error) {
          // Kept for the next edit or an explicit retry, unless a newer edit to
          // the same section has already replaced it.
          if (pendingPropsMapRef.current.get(key) === pending) {
            pendingPropsMapRef.current.set(key, pending);
          }
          throw error;
        }

        if (!result?.success) {
          if (pendingPropsMapRef.current.get(key) === pending) {
            pendingPropsMapRef.current.set(key, pending);
          }
          return;
        }

        // Acknowledged: only now is it safe to forget.
        if (pendingPropsMapRef.current.get(key) === pending) {
          pendingPropsMapRef.current.delete(key);
        }
        pendingPropsBaselineRef.current.delete(key);

        // Recorded only once the write landed: an entry for a rejected edit
        // would reverse a change that never happened.
        if (baseline && result?.success) {
          const after = pending.props;
          history.record({
            label: `Content · ${Object.keys(after).join(", ").slice(0, 40)}`,
            scope: sectionHistoryScope(pending.sectionId),
            undo: () => handleSectionPropsChange(pending.sectionId, baseline),
            redo: () => handleSectionPropsChange(pending.sectionId, after),
          });
        }
      }, 300);

      pendingPropsTimersRef.current.set(key, timer);
    },
    [
      activeTemplate,
      enqueueTemplateMutation,
      syncPreviewSectionProps,
      updatePropsMutation,
    ],
  );

  useEffect(() => {
    inlineTextCommitHandlerRef.current = (message) => {
      const selection = activeSelection;
      const lastSelection = lastPreviewSelectionRef.current;
      if (
        !selection ||
        !activeTemplate ||
        !isInlineTextEditCandidate({
          selectionEnabled: isSelectionMode,
          kind: selection.kind,
          sectionId: selection.sectionId,
          fieldKey: selection.fieldKey,
          fieldPath: selection.fieldPath,
          // An older/stale selection without descendant metadata is not safe
          // to treat as a direct text field; fail closed until Preview sends
          // the complete descriptor again.
          descendantFieldCount: selection.descendantFields?.length ?? 1,
          isSection: selection.isSection,
        }) ||
        selection.sectionId !== message.sectionId ||
        selection.fieldKey !== message.fieldKey ||
        selection.fieldPath !== message.fieldPath ||
        lastSelection?.sectionId !== message.sectionId ||
        lastSelection.fieldKey !== message.fieldKey ||
        lastSelection.fieldPath !== message.fieldPath ||
        !hasInlineTextDocumentTarget(
          message.sectionId,
          activeTemplate.document.sections.map((section) => section.id),
          activeRouteSections.map((section) => section.slotId),
        )
      ) {
        return;
      }

      // Keep the Inspector's content control aligned with the value just
      // committed in the canvas. The preview edits its DOM optimistically, so
      // waiting for the debounced Document refetch would otherwise leave the
      // right panel showing the previous value.
      setActiveSelection((current) =>
        current &&
        current.sectionId === message.sectionId &&
        current.fieldKey === message.fieldKey &&
        current.fieldPath === message.fieldPath
          ? { ...current, contentValue: message.value }
          : current,
      );

      const key = `${activeTemplate.id}:${message.sectionId}`;
      const currentProps = {
        ...sectionPropsSnapshot(message.sectionId),
        ...(pendingPropsMapRef.current.get(key)?.props ?? {}),
      };
      handleSectionPropsChange(
        message.sectionId,
        setFieldPathValue(currentProps, message.fieldPath, message.value),
      );
    };
    return () => {
      inlineTextCommitHandlerRef.current = () => {};
    };
  }, [
    activeSelection,
    activeTemplate,
    activeRouteSections,
    handleSectionPropsChange,
    isSelectionMode,
    sectionPropsSnapshot,
  ]);

  /**
   * Retires a section's history after something rewrote its stored props
   * without going through the history.
   *
   * Those entries hold the props as they were before an earlier edit, so
   * replaying one would put them back and discard the newer write.
   */
  const invalidateSectionHistory = useCallback(
    (sectionId: string) => history.discardScope(sectionHistoryScope(sectionId)),
    [history],
  );

  const handleSwapSectionArrayItems = useCallback(
    async (
      sectionId: string,
      draggedFieldPath: string,
      targetFieldPath: string,
    ) => {
      invalidateSectionHistory(sectionId);
      if (!activeTemplate) return;
      const section = activeTemplate.document.sections.find(
        (candidate) => candidate.id === sectionId,
      );
      if (!section) {
        toast.error("Cannot reorder: the selected section is unavailable.");
        return;
      }

      const templateId = activeTemplate.id;
      const key = `${templateId}:${sectionId}`;
      const pendingProps = pendingPropsMapRef.current.get(key)?.props ?? {};
      const currentProps = { ...section.props, ...pendingProps };
      const result = swapArrayItemsAtFieldPaths(
        currentProps,
        draggedFieldPath,
        targetFieldPath,
      );
      const restoreSelectionAndProps = () => {
        postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
          type: "morph:storefront-preview-set-selection-field-path",
          sectionId,
          fieldPath: draggedFieldPath,
        });
        setActiveSelection((current) => {
          if (!current?.fieldPath) return current;
          if (
            current.fieldPath !== targetFieldPath &&
            !current.fieldPath.startsWith(`${targetFieldPath}.`)
          ) {
            return current;
          }
          return {
            ...current,
            fieldPath: `${draggedFieldPath}${current.fieldPath.slice(targetFieldPath.length)}`,
          };
        });
        const rollbackProps = parsePreviewSectionProps(currentProps);
        if (rollbackProps) syncPreviewSectionProps(sectionId, rollbackProps);
      };
      if (!result.editable) {
        restoreSelectionAndProps();
        toast.warning(
          result.reason === "different-arrays"
            ? "Only items in the same data array can be reordered."
            : "This repeated item cannot be mapped to a safe array position.",
        );
        return;
      }

      const previewProps = parsePreviewSectionProps(result.value);
      if (!previewProps) {
        restoreSelectionAndProps();
        toast.error("Cannot reorder: the resulting section data is invalid.");
        return;
      }

      const existingTimer = pendingPropsTimersRef.current.get(key);
      if (existingTimer) {
        clearTimeout(existingTimer);
        pendingPropsTimersRef.current.delete(key);
      }
      pendingPropsMapRef.current.delete(key);
      syncPreviewSectionProps(sectionId, previewProps);
      setActiveSelection((current) => {
        if (!current?.fieldPath) return current;
        if (
          current.fieldPath !== draggedFieldPath &&
          !current.fieldPath.startsWith(`${draggedFieldPath}.`)
        ) {
          return current;
        }
        return {
          ...current,
          fieldPath: `${targetFieldPath}${current.fieldPath.slice(draggedFieldPath.length)}`,
        };
      });

      try {
        const mutationResult = await enqueueTemplateMutation(
          templateId,
          (generation) =>
            updatePropsMutation.mutateAsync({
              sectionId,
              props: result.value,
              expectedDraftGeneration: generation,
            }),
        );
        if (!mutationResult?.success) {
          restoreSelectionAndProps();
          return;
        }
        // Reversing a swap is the same swap again, so both directions write the
        // props the other one started from.
        history.record({
          label: "Reorder · item",
          scope: sectionHistoryScope(sectionId),
          undo: () => handleSectionPropsChange(sectionId, currentProps),
          redo: () => handleSectionPropsChange(sectionId, result.value),
        });
      } catch {
        restoreSelectionAndProps();
      }
    },
    [
      history,
      handleSectionPropsChange,
      invalidateSectionHistory,
      activeTemplate,
      enqueueTemplateMutation,
      syncPreviewSectionProps,
      updatePropsMutation,
    ],
  );

  useEffect(() => {
    arrayItemReorderHandlerRef.current = (
      sectionId,
      draggedFieldPath,
      targetFieldPath,
    ) => {
      void handleSwapSectionArrayItems(
        sectionId,
        draggedFieldPath,
        targetFieldPath,
      );
    };
  }, [handleSwapSectionArrayItems]);

  /** Lets a recorded toggle call back without pinning a stale closure. */
  const handleSectionToggleEnabledRef = useRef<
    ((sectionId: string, enabled: boolean) => Promise<void>) | null
  >(null);

  const handleSectionToggleEnabled = useCallback(
    async (sectionId: string, enabled: boolean) => {
      invalidateSectionHistory(sectionId);
      // 1. Instant 0ms visual toggle on canvas
      syncPreviewSectionProps(sectionId, undefined, enabled);

      if (!activeTemplate) return;
      const templateId = activeTemplate.id;
      const key = `${templateId}:${sectionId}`;

      const existingTimer = pendingPropsTimersRef.current.get(key);
      if (existingTimer) {
        clearTimeout(existingTimer);
        pendingPropsTimersRef.current.delete(key);
      }

      const existingProps = pendingPropsMapRef.current.get(key)?.props ?? {};
      pendingPropsMapRef.current.delete(key);
      const mergedProps = { ...existingProps, enabled };

      const result = await enqueueTemplateMutation(templateId, (gen) =>
        updatePropsMutation.mutateAsync({
          sectionId,
          props: mergedProps,
          expectedDraftGeneration: gen,
        }),
      );

      if (result?.success) {
        history.record({
          label: enabled ? "Show section" : "Hide section",
          scope: sectionHistoryScope(sectionId),
          undo: () =>
            handleSectionToggleEnabledRef.current?.(sectionId, !enabled),
          redo: () =>
            handleSectionToggleEnabledRef.current?.(sectionId, enabled),
        });
      }
    },
    [
      history,
      invalidateSectionHistory,
      activeTemplate,
      enqueueTemplateMutation,
      syncPreviewSectionProps,
      updatePropsMutation,
    ],
  );

  handleSectionToggleEnabledRef.current = handleSectionToggleEnabled;

  const handleReorderSections = useCallback(
    async (sectionIds: string[]) => {
      if (!activeThemeRoute) {
        throw new Error("The active template has no source-authored route.");
      }
      if (activeTemplate) await flushTemplatePendingProps(activeTemplate.id);
      const routeFile = effectiveThemeFiles.find(
        (file) => file.path === activeThemeRoute.sourcePath,
      );
      if (!routeFile)
        throw new Error("The active route source is unavailable.");
      const result = reorderThemeRouteSections(
        routeFile.content,
        effectiveThemeFiles,
        activeThemeRoute.sourcePath,
        sectionIds,
      );
      if (result.diagnostic) throw new Error(result.diagnostic);
      if (!result.changed) return { success: true };
      await handleUnifiedSaveFile(activeThemeRoute.sourcePath, result.code);
      return { success: true };
    },
    [
      activeTemplate,
      activeThemeRoute,
      effectiveThemeFiles,
      flushTemplatePendingProps,
      handleUnifiedSaveFile,
    ],
  );

  const handleSwapPreviewSections = useCallback(
    async (draggedSectionId: string, targetSectionId: string) => {
      const sectionIds = (activeTemplate?.document.sections ?? []).map(
        (section) => section.id,
      );
      const from = sectionIds.indexOf(draggedSectionId);
      const to = sectionIds.indexOf(targetSectionId);
      if (from < 0 || to < 0 || from === to) return;
      const next = [...sectionIds];
      next[from] = targetSectionId;
      next[to] = draggedSectionId;
      try {
        await handleReorderSections(next);
      } catch (error) {
        toast.error(
          `Failed to reorder sections: ${error instanceof Error ? error.message : "Save failed"}`,
        );
      }
    },
    [activeTemplate, handleReorderSections],
  );

  useEffect(() => {
    sectionSwapHandlerRef.current = (draggedSectionId, targetSectionId) => {
      void handleSwapPreviewSections(draggedSectionId, targetSectionId);
    };
  }, [handleSwapPreviewSections]);

  const handleAddSection = useCallback(
    async (option: ThemeRouteSectionOption) => {
      if (!activeThemeRoute) {
        throw new Error("The active template has no source-authored route.");
      }
      if (activeTemplate) await flushTemplatePendingProps(activeTemplate.id);
      const routeFile = effectiveThemeFiles.find(
        (file) => file.path === activeThemeRoute.sourcePath,
      );
      if (!routeFile)
        throw new Error("The active route source is unavailable.");
      const usedSlots = new Set(
        activeRouteSections.map((section) => section.slotId),
      );
      const baseSlot = option.sectionType || "section";
      let slotId = baseSlot;
      let suffix = 2;
      while (usedSlots.has(slotId)) {
        slotId = `${baseSlot}-${suffix}`;
        suffix += 1;
      }
      const result = addThemeRouteSection({
        source: routeFile.content,
        files: effectiveThemeFiles,
        routeSourcePath: activeThemeRoute.sourcePath,
        option,
        slotId,
      });
      if (result.diagnostic) throw new Error(result.diagnostic);
      if (!result.changed) return;
      await handleUnifiedSaveFile(activeThemeRoute.sourcePath, result.code);
      onSearchChange({ section: slotId });
    },
    [
      activeRouteSections,
      activeTemplate,
      activeThemeRoute,
      effectiveThemeFiles,
      flushTemplatePendingProps,
      handleUnifiedSaveFile,
      onSearchChange,
    ],
  );

  useEffect(() => {
    if (!previewKey) return;
    syncPreviewSection();
  }, [previewKey, search.section, syncPreviewSection]);

  const syncPreviewSelectionMode = useCallback(() => {
    const selectionRevision = nextPreviewSelectionRevision();
    postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
      type: "morph:storefront-preview-set-selection-mode",
      enabled: isSelectionMode,
      selectionRevision,
      restoreTarget: isSelectionMode
        ? (lastPreviewSelectionRef.current ?? undefined)
        : undefined,
    });
  }, [isSelectionMode, nextPreviewSelectionRevision]);

  const syncPreviewSpacingOverlay = useCallback(() => {
    postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
      type: "morph:storefront-preview-set-spacing-overlay",
      mode: spacingOverlayMode,
    });
  }, [spacingOverlayMode]);

  const switchToDesign = useCallback(() => {
    setEditorMode("design");
    syncPreviewSpacingOverlay();
    const selectionRevision = nextPreviewSelectionRevision();
    if (isCommentMode) return;

    for (const message of createSelectionRestoreMessages(
      isSelectionMode,
      lastPreviewSelectionRef.current,
      selectionRevision,
    )) {
      postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
        ...message,
      });
    }
  }, [
    isCommentMode,
    isSelectionMode,
    nextPreviewSelectionRevision,
    syncPreviewSpacingOverlay,
  ]);

  const handleContinueToDesign = useCallback(() => {
    setIsUnsavedCodeDialogOpen(false);
    switchToDesign();
  }, [switchToDesign]);

  const handleSaveAndSwitchToDesign = useCallback(async () => {
    const saveAll = editorCodeWorkspaceRef.current?.saveAll;
    if (!saveAll) {
      toast.error("Code Workspace is still loading. Try again in a moment.");
      return;
    }

    setIsSavingCodeBeforeModeSwitch(true);
    try {
      const saved = await saveAll();
      if (!saved) {
        toast.error(
          "Could not save all Code Editor changes. Resolve any conflicts and try again.",
        );
        return;
      }
      setIsUnsavedCodeDialogOpen(false);
      switchToDesign();
    } catch {
      // The Code Workspace reports the concrete save error. Keep the dialog
      // open so a failed save never silently changes the editing mode.
    } finally {
      setIsSavingCodeBeforeModeSwitch(false);
    }
  }, [switchToDesign]);

  const handleSwitchToDesign = useCallback(() => {
    if (editorMode === "code" && monacoDirtyFiles.length > 0) {
      setIsUnsavedCodeDialogOpen(true);
      return;
    }
    switchToDesign();
  }, [editorMode, monacoDirtyFiles.length, switchToDesign]);

  useEffect(() => {
    if (!previewKey) return;
    syncPreviewSelectionMode();
  }, [
    previewFrameReady?.key,
    previewFrameReady?.sequence,
    previewKey,
    syncPreviewSelectionMode,
  ]);

  useEffect(() => {
    if (!previewKey) return;
    syncPreviewSpacingOverlay();
  }, [previewKey, syncPreviewSpacingOverlay]);

  const syncPreviewViewportHeight = useCallback(() => {
    postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
      type: "morph:storefront-preview-set-viewport-height",
      height: previewDefaultHeights[search.viewport],
    });
  }, [search.viewport]);

  useEffect(() => {
    if (!previewKey) return;
    syncPreviewViewportHeight();
  }, [previewKey, syncPreviewViewportHeight]);

  const resetCanvas = useCallback(() => {
    scheduleCanvasTransform(initialCanvasTransform);
  }, [scheduleCanvasTransform]);

  const beginCanvasPan = useCallback(
    (
      source: "canvas" | "preview",
      pointerId: number,
      pointerX: number,
      pointerY: number,
    ) => {
      panOriginRef.current = {
        pointerId,
        pointerX,
        pointerY,
        canvasX: canvasTransformRef.current.x,
        canvasY: canvasTransformRef.current.y,
        source,
      };
      canvasViewportRef.current?.setAttribute("data-panning", "true");
    },
    [],
  );

  const moveCanvasPan = useCallback(
    (
      source: "canvas" | "preview",
      pointerId: number,
      pointerX: number,
      pointerY: number,
    ) => {
      const origin = panOriginRef.current;
      if (
        !origin ||
        origin.source !== source ||
        origin.pointerId !== pointerId
      ) {
        return;
      }

      scheduleCanvasTransform((current) => ({
        ...current,
        x: origin.canvasX + pointerX - origin.pointerX,
        y: origin.canvasY + pointerY - origin.pointerY,
      }));
    },
    [scheduleCanvasTransform],
  );

  const endCanvasPan = useCallback(
    (source: "canvas" | "preview", pointerId: number) => {
      const origin = panOriginRef.current;
      if (
        !origin ||
        origin.source !== source ||
        origin.pointerId !== pointerId
      ) {
        return;
      }

      panOriginRef.current = null;
      canvasViewportRef.current?.removeAttribute("data-panning");
    },
    [],
  );

  const handleCanvasWheel = useCallback(
    (event: WheelEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest?.("[data-thread-card]") ||
        target?.closest?.("[data-comment-popover]") ||
        target?.closest?.("[data-scroll-container]") ||
        target?.closest?.("[data-slot='scroll-area-viewport']") ||
        target?.closest?.("[data-slot='scroll-area']") ||
        target?.closest?.("[data-radix-scroll-area-viewport]") ||
        target?.closest?.(".overscroll-contain")
      ) {
        return;
      }

      event.preventDefault();

      const viewport = canvasViewportRef.current;
      if (!viewport) return;

      const viewportHeight =
        canvasViewportHeightRef.current || viewport.clientHeight;
      const deltaY = normalizeWheelDelta(
        event.deltaY,
        event.deltaMode,
        viewportHeight,
      );

      if (!event.ctrlKey) {
        scheduleCanvasScroll(deltaY);
        return;
      }

      const bounds = viewport.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left - bounds.width / 2;
      const pointerY = event.clientY - bounds.top - bounds.height / 2;

      scheduleCanvasTransform((current) => {
        const zoomFactor = Math.exp(-deltaY * 0.001);
        const nextScale = snapCanvasScaleTowardDefault(
          current.scale,
          clampCanvasScale(current.scale * zoomFactor),
        );

        if (nextScale === current.scale) {
          return current;
        }

        const contentX = (pointerX - current.x) / current.scale;
        const contentY = (pointerY - current.y) / current.scale;

        return {
          scale: nextScale,
          x: pointerX - contentX * nextScale,
          y: pointerY - contentY * nextScale,
        };
      });
    },
    [scheduleCanvasScroll, scheduleCanvasTransform],
  );

  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;

    viewport.addEventListener("wheel", handleCanvasWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleCanvasWheel);
  }, [handleCanvasWheel]);

  useEffect(() => {
    if (!previewKey) return;

    const handlePreviewWheel = (event: MessageEvent<unknown>) => {
      const message = parseLivePreviewMessage(event);
      if (message?.type !== "morph:storefront-preview-wheel") return;
      // Wheel messages can arrive once per display frame. Resetting the
      // authenticated idle timer for every one also performs its timer and
      // cross-tab bookkeeping at scroll frequency, even though one reset per
      // second is enough to keep an active editor session alive.
      const now = Date.now();
      if (now - lastPreviewWheelActivityAtRef.current >= 1_000) {
        lastPreviewWheelActivityAtRef.current = now;
        reportAuthenticatedUserActivity();
      }

      const viewport = canvasViewportRef.current;
      const frame = previewIframeRef.current;
      if (!viewport || !frame) return;
      const viewportHeight =
        canvasViewportHeightRef.current || viewport.clientHeight;
      const deltaY = normalizeWheelDelta(
        message.deltaY,
        message.deltaMode,
        viewportHeight,
      );

      if (!message.ctrlKey) {
        scheduleCanvasScroll(deltaY);
        return;
      }

      const viewportBounds = viewport.getBoundingClientRect();
      const frameBounds = frame.getBoundingClientRect();
      const pointerX =
        frameBounds.left +
        message.clientX * canvasTransformRef.current.scale -
        viewportBounds.left -
        viewportBounds.width / 2;
      const pointerY =
        frameBounds.top +
        message.clientY * canvasTransformRef.current.scale -
        viewportBounds.top -
        viewportBounds.height / 2;

      scheduleCanvasTransform((current) => {
        const zoomFactor = Math.exp(-deltaY * 0.001);
        const nextScale = snapCanvasScaleTowardDefault(
          current.scale,
          clampCanvasScale(current.scale * zoomFactor),
        );
        if (nextScale === current.scale) return current;

        const contentX = (pointerX - current.x) / current.scale;
        const contentY = (pointerY - current.y) / current.scale;
        return {
          scale: nextScale,
          x: pointerX - contentX * nextScale,
          y: pointerY - contentY * nextScale,
        };
      });
    };

    window.addEventListener("message", handlePreviewWheel);
    return () => window.removeEventListener("message", handlePreviewWheel);
  }, [
    parseLivePreviewMessage,
    previewKey,
    scheduleCanvasScroll,
    scheduleCanvasTransform,
  ]);

  // Follows the pointer during a reorder drag. A native drag suppresses wheel
  // events, so without this only the sections already on screen could be
  // reached — the canvas has to come to the pointer instead.
  useEffect(() => {
    if (!previewKey) return;
    let pointerY: number | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
      pointerY = null;
    };

    const tick = () => {
      const viewport = canvasViewportRef.current;
      const frame = previewIframeRef.current;
      if (pointerY === null || !viewport || !frame) return stop();
      const viewportBounds = viewport.getBoundingClientRect();
      const frameBounds = frame.getBoundingClientRect();
      const step = dragAutoScrollStep({
        pointerY: frameBounds.top + pointerY * canvasTransformRef.current.scale,
        viewportTop: viewportBounds.top,
        viewportBottom: viewportBounds.bottom,
      });
      if (step !== 0) scheduleCanvasScroll(step);
    };

    const handleDragAutoScroll = (event: MessageEvent<unknown>) => {
      const message = parseLivePreviewMessage(event);
      if (message?.type !== "morph:storefront-preview-drag-autoscroll") return;
      if (message.phase === "end") return stop();
      pointerY = message.clientY;
      // A drop outside the canvas ends the drag without a further message, so
      // the loop is also bounded by the drag still reporting where it is.
      timer ??= setInterval(tick, 16);
    };

    window.addEventListener("message", handleDragAutoScroll);
    return () => {
      window.removeEventListener("message", handleDragAutoScroll);
      stop();
    };
  }, [parseLivePreviewMessage, previewKey, scheduleCanvasScroll]);

  useEffect(() => {
    if (!previewKey) return;

    const handlePreviewCanvasGesture = (event: MessageEvent<unknown>) => {
      const message = parseLivePreviewMessage(event);
      if (!message) return;

      if (message.type === "morph:storefront-preview-reset-canvas") {
        resetCanvas();
        return;
      }

      // The canvas is an iframe, so a shortcut pressed there never reaches the
      // editor's own listener. Selecting an element puts focus in it, which is
      // when someone is most likely to press undo.
      if (message.type === "morph:storefront-preview-history-shortcut") {
        if (message.direction === "undo") history.undo();
        else history.redo();
        return;
      }

      if (
        message.type !== "morph:storefront-preview-pointer" ||
        !("phase" in message) ||
        (message.phase !== "down" &&
          message.phase !== "move" &&
          message.phase !== "up" &&
          message.phase !== "cancel") ||
        !("pointerId" in message) ||
        typeof message.pointerId !== "number" ||
        !Number.isInteger(message.pointerId) ||
        !("screenX" in message) ||
        typeof message.screenX !== "number" ||
        !Number.isFinite(message.screenX) ||
        !("screenY" in message) ||
        typeof message.screenY !== "number" ||
        !Number.isFinite(message.screenY)
      ) {
        return;
      }
      reportAuthenticatedUserActivity();

      if (message.phase === "down") {
        beginCanvasPan(
          "preview",
          message.pointerId,
          message.screenX,
          message.screenY,
        );
      } else if (message.phase === "move") {
        moveCanvasPan(
          "preview",
          message.pointerId,
          message.screenX,
          message.screenY,
        );
      } else {
        endCanvasPan("preview", message.pointerId);
      }
    };

    window.addEventListener("message", handlePreviewCanvasGesture);
    return () =>
      window.removeEventListener("message", handlePreviewCanvasGesture);
  }, [
    beginCanvasPan,
    endCanvasPan,
    moveCanvasPan,
    parseLivePreviewMessage,
    previewKey,
    resetCanvas,
    history,
  ]);

  const handleCanvasPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isCommentMode && (activeCommentThreadId || draftCommentPin)) {
        setActiveCommentThreadId(null);
        setDraftCommentPin(null);
      }

      // Middle click (button 1) always pans; left click (button 0) pans when not in comment mode
      if (event.button === 1 || (event.button === 0 && !isCommentMode)) {
        if (event.button === 1) {
          event.preventDefault();
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        beginCanvasPan("canvas", event.pointerId, event.clientX, event.clientY);
        return;
      }
    },
    [
      beginCanvasPan,
      isCommentMode,
      activeCommentThreadId,
      draftCommentPin,
      setActiveCommentThreadId,
      setDraftCommentPin,
    ],
  );

  const handleCanvasPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      moveCanvasPan("canvas", event.pointerId, event.clientX, event.clientY);
    },
    [moveCanvasPan],
  );

  const finishCanvasPan = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      endCanvasPan("canvas", event.pointerId);
    },
    [endCanvasPan],
  );

  const handleCanvasKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const panStep = event.shiftKey ? 80 : 40;
      const actions: Partial<
        Record<string, (current: CanvasTransform) => CanvasTransform>
      > = {
        ArrowLeft: (current) => ({ ...current, x: current.x - panStep }),
        ArrowRight: (current) => ({ ...current, x: current.x + panStep }),
        ArrowUp: (current) => ({ ...current, y: current.y - panStep }),
        ArrowDown: (current) => ({ ...current, y: current.y + panStep }),
        "+": (current) => ({
          ...current,
          scale: clampCanvasScale(current.scale + CANVAS_SCALE_STEP),
        }),
        "=": (current) => ({
          ...current,
          scale: clampCanvasScale(current.scale + CANVAS_SCALE_STEP),
        }),
        "-": (current) => ({
          ...current,
          scale: clampCanvasScale(current.scale - CANVAS_SCALE_STEP),
        }),
        "0": () => initialCanvasTransform,
      };
      const action = actions[event.key];

      if (!action) return;
      event.preventDefault();
      scheduleCanvasTransform(action);
    },
    [scheduleCanvasTransform],
  );

  const updatePreviewWidth = useCallback((width: number) => {
    const nextWidth = clampPreviewWidth(Math.round(width));
    if (nextWidth === previewWidthRef.current) return;

    previewWidthRef.current = nextWidth;
    if (previewWidthRenderFrameRef.current !== 0) return;

    previewWidthRenderFrameRef.current = requestAnimationFrame(() => {
      previewWidthRenderFrameRef.current = 0;
      setPreviewWidth(previewWidthRef.current);
    });
  }, []);

  const applyPreviewWidth = useCallback(
    (width: number, skipGroupSync = false) => {
      const nextWidth = clampPreviewWidth(Math.round(width));
      updatePreviewWidth(nextWidth);
      onSearchChange({
        canvasWidth: nextWidth,
        viewport: resolvePreviewViewport(nextWidth),
      });
      if (!isCommentMode) {
        lastNormalWidthRef.current = nextWidth;
        if (typeof window !== "undefined" && normalWidthSessionKey) {
          try {
            sessionStorage.setItem(normalWidthSessionKey, String(nextWidth));
          } catch {}
        }
      }
      if (!skipGroupSync && isCommentMode && activeGroupId) {
        syncGroupWidthMutation.mutate({
          groupId: activeGroupId,
          viewportWidth: nextWidth,
        });
      }
    },
    [
      activeGroupId,
      isCommentMode,
      normalWidthSessionKey,
      onSearchChange,
      syncGroupWidthMutation,
      updatePreviewWidth,
    ],
  );

  // When entering Comment Mode (or when comment groups load while in Comment Mode),
  // automatically synchronize the preview width to match the active comment group
  const prevCommentModeRef = useRef(isCommentMode);
  useEffect(() => {
    const justEnteredCommentMode = !prevCommentModeRef.current && isCommentMode;
    prevCommentModeRef.current = isCommentMode;

    if (!isCommentMode || commentGroups.length === 0) return;

    if (justEnteredCommentMode) {
      const targetGroupId = activeGroupId ?? commentGroups[0].id;
      const targetGroup =
        commentGroups.find((g) => g.id === targetGroupId) ?? commentGroups[0];
      if (
        targetGroup &&
        targetGroup.viewportWidth > 0 &&
        targetGroup.viewportWidth !== previewWidthRef.current
      ) {
        applyPreviewWidth(targetGroup.viewportWidth, true);
        setIsWidthLocked(true);
      }
    }
  }, [isCommentMode, activeGroupId, commentGroups, applyPreviewWidth]);

  const handleExitCommentMode = useCallback(() => {
    setIsCommentMode(false);
    setDraftCommentPin(null);
    setActiveCommentThreadId(null);
    const restoredWidth =
      lastNormalWidthRef.current || previewDefaultWidths.desktop;
    applyPreviewWidth(restoredWidth, true);
    setIsWidthLocked(false);
  }, [applyPreviewWidth]);

  const handleResizePointerDown = useCallback(
    (edge: "left" | "right") => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      resizeOriginRef.current = {
        pointerId: event.pointerId,
        pointerX: event.clientX,
        width: previewWidthRef.current,
        edge,
        scale: canvasTransformRef.current.scale,
      };
    },
    [],
  );

  const handleResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const origin = resizeOriginRef.current;
      if (!origin || origin.pointerId !== event.pointerId) return;
      event.stopPropagation();
      const deltaX =
        origin.edge === "right"
          ? event.clientX - origin.pointerX
          : origin.pointerX - event.clientX;
      const nextWidth = clampPreviewWidth(
        Math.round(origin.width + (2 * deltaX) / origin.scale),
      );
      updatePreviewWidth(nextWidth);
    },
    [updatePreviewWidth],
  );

  const finishPreviewResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (resizeOriginRef.current?.pointerId !== event.pointerId) return;
      event.stopPropagation();
      resizeOriginRef.current = null;
      const finalWidth = previewWidthRef.current;
      onSearchChange({
        canvasWidth: finalWidth,
        viewport: resolvePreviewViewport(finalWidth),
      });
      if (!isCommentMode) {
        lastNormalWidthRef.current = finalWidth;
        if (typeof window !== "undefined" && normalWidthSessionKey) {
          try {
            sessionStorage.setItem(normalWidthSessionKey, String(finalWidth));
          } catch {}
        }
      }
      if (isCommentMode && activeGroupId) {
        syncGroupWidthMutation.mutate({
          groupId: activeGroupId,
          viewportWidth: finalWidth,
        });
      }
    },
    [
      activeGroupId,
      isCommentMode,
      normalWidthSessionKey,
      onSearchChange,
      syncGroupWidthMutation,
    ],
  );

  const handleResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const step = event.shiftKey ? PREVIEW_WIDTH_STEP * 4 : PREVIEW_WIDTH_STEP;
      const nextWidth = clampPreviewWidth(
        previewWidthRef.current + direction * step * 2,
      );
      applyPreviewWidth(nextWidth);
    },
    [applyPreviewWidth],
  );

  const handleViewportChange = useCallback(
    (viewport: StorefrontThemeEditorSearch["viewport"]) => {
      const nextWidth = previewDefaultWidths[viewport];
      updatePreviewWidth(nextWidth);
      onSearchChange({ viewport, canvasWidth: undefined });
      if (!isCommentMode) {
        lastNormalWidthRef.current = nextWidth;
        if (typeof window !== "undefined" && normalWidthSessionKey) {
          try {
            sessionStorage.setItem(normalWidthSessionKey, String(nextWidth));
          } catch {}
        }
      }
      if (isCommentMode && activeGroupId) {
        syncGroupWidthMutation.mutate({
          groupId: activeGroupId,
          viewportWidth: nextWidth,
        });
      }
    },
    [
      activeGroupId,
      isCommentMode,
      normalWidthSessionKey,
      onSearchChange,
      syncGroupWidthMutation,
      updatePreviewWidth,
    ],
  );

  const handleSelectGroup = useCallback(
    (groupId: string) => {
      setActiveGroupId(groupId);
      setActiveCommentThreadId(null);
      setDraftCommentPin(null);
      const targetGroup = commentGroups.find((g) => g.id === groupId);
      if (targetGroup && targetGroup.viewportWidth > 0) {
        applyPreviewWidth(targetGroup.viewportWidth, true);
        setIsWidthLocked(true);
      }
    },
    [commentGroups, applyPreviewWidth],
  );

  const handleSelectCommentThread = useCallback(
    (threadId: string | null) => {
      setActiveCommentThreadId(threadId);
      if (!threadId) return;
      const targetThread = commentThreads.find((t) => t.id === threadId);
      if (!targetThread) return;

      // 1. Group is the single source of truth for viewport width
      if (targetThread.groupId) {
        setActiveGroupId(targetThread.groupId);
        const parentGroup = commentGroups.find(
          (g) => g.id === targetThread.groupId,
        );
        if (
          parentGroup &&
          parentGroup.viewportWidth > 0 &&
          parentGroup.viewportWidth !== previewWidthRef.current
        ) {
          applyPreviewWidth(parentGroup.viewportWidth, true);
          setIsWidthLocked(true);
        }
      }

      // 2. Smoothly center the canvas vertically on the selected comment pin & popover
      centerCanvasOnThread(targetThread, previewFrameHeightRef.current);

      // 3. Select and highlight section if thread is anchored to a specific section
      if (targetThread.sectionId) {
        postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
          type: "morph:storefront-preview-set-section",
          sectionId: targetThread.sectionId,
        });
      }
    },
    [commentThreads, commentGroups, applyPreviewWidth, centerCanvasOnThread],
  );

  return (
    <div
      // Marks where the editor ends and anything mounted beside it begins —
      // dev tools mount as a sibling of the app, and an accessibility check
      // that cannot tell them apart reports faults nobody here can fix.
      data-morph-editor
      className="grid h-svh min-h-0 grid-rows-[3.5rem_minmax(0,1fr)] bg-background"
    >
      {/* Keep the canvas controls in a dedicated auto-sized center track with
          equal flexible gutters. The storefront name stays left and the save
          and publish actions stay right without shifting the center controls. */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b bg-component px-3 lg:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon" asChild>
            <Link
              to="/dashboard/$slug"
              params={{ slug: "online-store" }}
              aria-label="Back to Online Store"
            >
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {context.storefront.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {context.theme.name} theme
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 justify-self-center">
          <div className="flex h-9 items-center rounded-lg border bg-popover p-1 text-popover-foreground shadow-sm">
            <div
              role="group"
              aria-label="Canvas zoom"
              className="flex shrink-0 items-center"
            >
              <span className="pl-2 pr-1 text-xs font-medium text-muted-foreground">
                Zoom
              </span>
              <ScrubbableNumberInput
                value={Math.round(canvasTransform.scale * 100)}
                min={MIN_CANVAS_SCALE * 100}
                max={MAX_CANVAS_SCALE * 100}
                step={1}
                scrubPixelsPerStep={2}
                suffix="%"
                ariaLabel="Canvas zoom percentage"
                onValueChange={(value) =>
                  scheduleCanvasTransform((current) => ({
                    ...current,
                    scale: clampCanvasScale(value / 100),
                  }))
                }
                className="h-7 shrink-0"
                inputClassName="h-7 w-[4ch] rounded-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:border-0 focus-visible:ring-0"
              />
            </div>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <div
              role="group"
              aria-label="Preview device"
              // Collapses into the dropdown below a wide viewport. At 1024 the
              // expanded row plus the mode switch is wider than the middle
              // column can be, and the overflow lands on the buttons beside it.
              className="hidden items-center gap-0.5 xl:flex"
            >
              {viewportOptions.map(({ value, label, icon: Icon }) => (
                <Button
                  key={value}
                  type="button"
                  variant={
                    search.viewport === value ? "toolbarActive" : "ghost"
                  }
                  size="icon"
                  disabled={isWidthLocked}
                  className="size-7"
                  aria-label={`${label} preview, ${previewDefaultWidths[value]} pixels`}
                  aria-pressed={search.viewport === value}
                  title={
                    isWidthLocked
                      ? "Width is locked to current comment group (Click lock icon to unlock)"
                      : `${label} · ${previewDefaultWidths[value]} px`
                  }
                  onClick={() => handleViewportChange(value)}
                >
                  <Icon className="size-3.5" />
                </Button>
              ))}
              <Separator orientation="vertical" className="mx-0.5 h-4" />
              <Button
                type="button"
                variant={isWidthLocked ? "toolbarActive" : "ghost"}
                size="icon"
                className="size-7"
                aria-label={
                  isWidthLocked
                    ? "Width locked (click to unlock)"
                    : "Width unlocked (click to lock)"
                }
                aria-pressed={isWidthLocked}
                title={
                  isWidthLocked
                    ? "Width is locked (Click to unlock device & width controls)"
                    : "Width is unlocked (Click to lock width to current size)"
                }
                onClick={() => setIsWidthLocked((prev) => !prev)}
              >
                {isWidthLocked ? (
                  <Lock className="size-3.5 text-primary" />
                ) : (
                  <Unlock className="size-3.5 text-muted-foreground" />
                )}
              </Button>
            </div>
            <div className="flex items-center gap-0.5 xl:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isWidthLocked}
                    className="h-7 shrink-0 gap-1.5 px-2 shadow-none"
                    aria-label={`Preview device: ${search.viewport}`}
                    title={
                      isWidthLocked
                        ? "Width is locked to current comment group"
                        : undefined
                    }
                  >
                    <ActiveViewportIcon className="size-3.5" />
                    <ChevronDown className="size-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Preview device
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup
                    value={search.viewport}
                    onValueChange={(value) => {
                      const viewport = viewportOptions.find(
                        (option) => option.value === value,
                      );
                      if (viewport) handleViewportChange(viewport.value);
                    }}
                  >
                    {viewportOptions.map(({ value, label, icon: Icon }) => (
                      <DropdownMenuRadioItem key={value} value={value}>
                        <Icon />
                        <span>{label}</span>
                        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                          {previewDefaultWidths[value]} px
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                type="button"
                variant={isWidthLocked ? "toolbarActive" : "ghost"}
                size="icon"
                className="size-7 shrink-0"
                aria-label={isWidthLocked ? "Width locked" : "Width unlocked"}
                title={
                  isWidthLocked
                    ? "Click to unlock width"
                    : "Click to lock width"
                }
                onClick={() => setIsWidthLocked((prev) => !prev)}
              >
                {isWidthLocked ? (
                  <Lock className="size-3.5 text-primary" />
                ) : (
                  <Unlock className="size-3.5 text-muted-foreground" />
                )}
              </Button>
            </div>
          </div>

          {/* Design | Code Mode Segment Switcher */}
          <div className="flex h-9 items-center rounded-lg border bg-popover p-1 text-popover-foreground shadow-sm max-md:hidden">
            <Button
              type="button"
              variant={editorMode === "design" ? "toolbarActive" : "ghost"}
              size="sm"
              className="h-7 gap-1.5 px-3 text-xs font-medium"
              onClick={handleSwitchToDesign}
            >
              <Layout className="size-3.5" />
              <span>Design</span>
            </Button>
            <Button
              type="button"
              variant={editorMode === "code" ? "toolbarActive" : "ghost"}
              size="sm"
              className="h-7 gap-1.5 px-3 text-xs font-medium"
              onPointerEnter={handlePreloadCodeWorkspace}
              onFocus={handlePreloadCodeWorkspace}
              onClick={handleOpenSelectedCode}
            >
              <Code2 className="size-3.5" />
              <span>Code</span>
            </Button>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-1 justify-self-end">
          {(() => {
            const isThemeSaving = Object.values(themeFileSaveStatus).some(
              (s) => s === "saving",
            );
            const firstThemeError = Object.values(themeFileSaveErrors)[0];
            const hasError =
              draftSaveState === "error" || Boolean(firstThemeError);
            const isSaving =
              draftSaveState === "saving" ||
              isThemeSaving ||
              publishMutation.isPending;

            const statusLabel = publishMutation.isPending
              ? "Publishing…"
              : isSaving
                ? "Saving…"
                : hasError
                  ? firstThemeError
                    ? `Save failed: ${firstThemeError.slice(0, 30)}…`
                    : "Save failed"
                  : // One word each, and the same word stem, so the two states
                    // read as a pair the eye can tell apart at a glance. The
                    // longer phrasings sat beside four icon buttons and a
                    // Publish button and read as a sentence in a toolbar.
                    hasUnpublishedChanges
                    ? "Unpublished"
                    : "Published";

            return (
              <>
                <span
                  data-editor-save-status
                  className={cn(
                    // Below a wide viewport only the marker survives, because
                    // the toolbar overlaps on a 1024px laptop once the words
                    // are in it. One-word labels are about half the width the
                    // phrases were, so they now survive a step further down.
                    "hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex",
                    hasError && "text-destructive font-medium",
                  )}
                  title={firstThemeError ?? unpublishedReason}
                  data-unpublished-reason={unpublishedReason}
                  aria-label={statusLabel}
                >
                  {isSaving ? (
                    <LoaderCircle className="size-3.5 animate-spin text-primary" />
                  ) : hasError ? (
                    <CircleAlert className="size-3.5 text-destructive" />
                  ) : (
                    // A dot, not a tick. The settled states differ only by
                    // this marker and one word, and a tick beside
                    // "Unpublished" says the opposite of the word next to it —
                    // it reads as "done" for the one state that is not.
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        hasUnpublishedChanges
                          ? "bg-primary"
                          : "bg-muted-foreground/40",
                      )}
                    />
                  )}
                  <span className="hidden xl:inline">{statusLabel}</span>
                </span>
                {/* Splits the bar into what is true and what you can do. The
                    status was the only item here with no container of its own,
                    so against a row of icon buttons it read as loose text. */}
                <span
                  aria-hidden="true"
                  className="mx-2 hidden h-4 w-px shrink-0 bg-border sm:block"
                />
              </>
            );
          })()}
          <Button
            variant="ghost"
            size="icon"
            disabled={!historyState.canUndo}
            onClick={history.undo}
            aria-label="Undo"
            title={
              historyState.undoLabel ? `Undo ${historyState.undoLabel}` : "Undo"
            }
          >
            <Undo2 />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={!historyState.canRedo}
            onClick={history.redo}
            aria-label="Redo"
            title={
              historyState.redoLabel ? `Redo ${historyState.redoLabel}` : "Redo"
            }
          >
            <Redo2 />
          </Button>
          {/*
            A toggle between the interpreted preview and the compiled artifact.
            The label names what it shows and stays put; whether it is on is
            carried by the pressed state and the active styling, which is what
            a toggle is read as.
          */}
          {activeBuildPreview && (
            <Button
              type="button"
              variant={previewMode === "build" ? "toolbarActive" : "ghost"}
              size="xs"
              className="gap-1 px-2.5 text-xs font-medium max-sm:hidden"
              aria-pressed={previewMode === "build"}
              aria-label="Show the compiled build instead of the live preview"
              onClick={() =>
                setPreviewMode((prev) => (prev === "build" ? "live" : "build"))
              }
              title={
                previewMode === "build"
                  ? "Showing the compiled build. Switch back to Live Preview."
                  : "Show the compiled build instead of the live preview."
              }
            >
              <Layers className="size-3.5" />
              <span className="hidden 2xl:inline">Built</span>
            </Button>
          )}
          <Button
            ref={releaseHistoryTriggerRef}
            type="button"
            variant="outline"
            size="icon"
            className="max-sm:hidden"
            onClick={() => setIsReleaseHistoryOpen(true)}
            aria-label="Release history"
            title="Review published releases and switch production to one of them"
          >
            <History className="size-3.5" />
          </Button>

          {/*
            Reports only the build it started itself. Publishing builds when it
            needs to, and showing that run here spun two controls for one job
            and — worse — offered to cancel it, from a button whose owner is
            waiting on the result. During a publish build this stays idle and
            disabled, and Publish is the one thing reporting progress.

            One control for a single running thing: while a build is in flight
            the only useful action on it is to stop it, so the button becomes
            that action instead of going dead and growing a second button.
            Icon-only, so the icon carries the state and the accessible name
            carries the action — which is why both change together.

            Placed beside Publish because publishing builds when it needs to;
            this is the same step, run on its own to look at the result first.
          */}
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={themeFiles.length === 0 || isPublishBuilding}
            // Stable across both states, so a test can address the control
            // without depending on the title that changes with it.
            data-editor-build-action
            data-build-pending={isOwnBuildPending ? "true" : "false"}
            className="group max-sm:hidden"
            aria-label={
              isOwnBuildPending ? "Cancel the running build" : "Build the theme"
            }
            onClick={
              isOwnBuildPending
                ? () => void handleCancelBuild()
                : handleBuildPreview
            }
            title={
              themeFiles.length === 0
                ? "Initialize starter theme files in Code Workspace before building"
                : isPublishBuilding
                  ? "Publishing is building this theme. Cancel it from Publish."
                  : isOwnBuildPending
                    ? "Cancel this build. A build that already finished keeps its result."
                    : "Compile and bundle theme into immutable R2 preview build"
            }
          >
            {isOwnBuildPending ? (
              <>
                {/* Focus reveals the stop marker as well as hover: the icon is
                    the only thing saying what activating the button now does,
                    and a keyboard reaches it without ever hovering. */}
                <LoaderCircle className="size-3.5 animate-spin text-primary group-hover:hidden group-focus-visible:hidden" />
                {/* Filled square, the stop marker a media transport uses, so it
                    pairs with the play marker the idle state shows. */}
                <Square className="hidden size-3.5 fill-current group-hover:block group-focus-visible:block" />
              </>
            ) : (
              <Play className="size-3.5" />
            )}
          </Button>

          {/*
            Publishing is disabled while it runs, and it is disabled for half a
            dozen other reasons too. Without a state of its own the button just
            greys out, which reads as "not allowed" rather than "working" — so
            the run says so itself. `aria-busy` carries the same fact to a
            screen reader, and the accessible name follows the visible label so
            the two never disagree.
          */}
          <Popover open={isPublishNoteOpen} onOpenChange={setIsPublishNoteOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="form"
                size="xs"
                className="gap-1.5"
                aria-busy={publishMutation.isPending || isPublishBuilding}
                data-publish-pending={
                  publishMutation.isPending || isPublishBuilding
                    ? "true"
                    : "false"
                }
                disabled={
                  !hasUnpublishedChanges ||
                  draftSaveState !== "idle" ||
                  Object.values(themeFileSaveStatus).some(
                    (s) => s === "saving",
                  ) ||
                  Object.values(themeFileSaveErrors).length > 0 ||
                  monacoDirtyFiles.length > 0 ||
                  useThemeWorkspaceStore
                    .getState()
                    .hasUnsavedEdits(workspaceScope) ||
                  useThemeWorkspaceStore
                    .getState()
                    .hasActiveConflictsOrErrors(workspaceScope) ||
                  publishMutation.isPending ||
                  isBuildPending
                }
              >
                {publishMutation.isPending || isPublishBuilding ? (
                  <>
                    <LoaderCircle className="size-3.5 animate-spin" />
                    {/* Publishing builds first when nothing usable exists, so the
                        label names the step actually running rather than implying
                        the release is already being written. */}
                    {isPublishBuilding ? "Building…" : "Publishing…"}
                  </>
                ) : (
                  "Publish"
                )}
              </Button>
            </PopoverTrigger>
            {/*
              A release is otherwise identified by a hex fragment and a
              timestamp, which says nothing about what it contains — so picking
              one to roll back to means opening them one at a time. One line
              written here is what makes the history readable later.

              Optional on purpose: requiring it produces "update" and "fix",
              which is the same non-information with more friction in the way.
            */}
            <PopoverContent align="end" className="w-80 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="publish-note" className="text-xs">
                  Describe this release{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="publish-note"
                  value={publishNote}
                  maxLength={MAX_RELEASE_NOTE_LENGTH}
                  placeholder="Reworded the homepage hero"
                  onChange={(event) => setPublishNote(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void confirmPublish();
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  You can rename it later from Release history.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="destructive"
                  onClick={() => setIsPublishNoteOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="form"
                  size="xs"
                  data-publish-confirm
                  onClick={() => void confirmPublish()}
                >
                  Publish
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </header>

      {/*
        A build is the compiled artifact, not something the editor can act
        on: none of the section tree, inspector or canvas controls apply to
        it. Shown full-screen so it is read as the store itself rather than
        as one more panel inside the editor, and so the artifact is seen at
        the size a visitor gets instead of inside a scaled canvas.
      */}
      {previewMode === "build" && activeBuildPreview ? (
        <RouteFullscreenSurface
          onClose={returnToLivePreview}
          bodyClassName="flex min-h-0 flex-col p-0"
          headerLeading={
            <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3" />
                Immutable Build
              </span>
              <span className="font-mono text-[11px]">
                {activeBuildPreview.id.slice(0, 8)}
              </span>
              <span>·</span>
              <span className="truncate">
                {activeBuildPreview.compilerId} v
                {activeBuildPreview.compilerVersion}
              </span>
            </div>
          }
        >
          {buildDiagnostics && (
            <div className="border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
              <span className="font-semibold">Diagnostic: </span>
              {typeof buildDiagnostics === "object"
                ? buildDiagnostics.error ||
                  buildDiagnostics.message ||
                  JSON.stringify(buildDiagnostics)
                : String(buildDiagnostics)}
            </div>
          )}
          {activePreviewToken ? (
            <iframe
              key={`build-preview-${activeBuildPreview.id}`}
              src={`/preview-build/${encodeURIComponent(activeBuildPreview.id)}/${encodeURIComponent(activePreviewToken)}/`}
              title={`${context.theme.name} compiled build preview`}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              className="block size-full flex-1 border-0 bg-stone-50"
            />
          ) : (
            <div className="flex size-full flex-1 flex-col items-center justify-center bg-stone-50 p-8 text-center text-stone-700">
              <p className="text-sm font-medium">Preview Token Required</p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                Theme build succeeded, but preview capability token is missing.
                Please ensure THEME_PREVIEW_SECRET is configured.
              </p>
            </div>
          )}
        </RouteFullscreenSurface>
      ) : null}

      <EditorReleaseHistoryDialog
        open={isReleaseHistoryOpen}
        onOpenChange={(open) => {
          setIsReleaseHistoryOpen(open);
          // Focus is put back by hand rather than left to the dialog: the
          // editor re-renders constantly, and the node the dialog remembered
          // may be gone by the time it closes — which drops a keyboard user at
          // the top of the document with the whole toolbar to tab through
          // again.
          if (!open) {
            requestAnimationFrame(() =>
              releaseHistoryTriggerRef.current?.focus(),
            );
          }
        }}
        storefrontId={context.storefront.id}
        themeId={context.theme.id}
        activeReleaseId={context.storefront.activeReleaseId}
      />

      <EditorCodeModeSurface
        active={editorMode === "code"}
        preload={shouldPreloadCodeWorkspace}
      >
        <Suspense
          fallback={
            <div
              className="flex flex-1 items-center justify-center gap-2 bg-background text-sm text-muted-foreground"
              role="status"
            >
              <LoaderCircle className="size-4 animate-spin text-primary" />
              Loading Code Workspace…
            </div>
          }
        >
          <EditorCodeWorkspace
            ref={editorCodeWorkspaceRef}
            storefrontId={context.storefront.id}
            themeId={context.theme.id}
            files={effectiveThemeFiles}
            tree={themeTree}
            initialActiveFilePath={activeCodeFilePath}
            jumpLocation={jumpLocation}
            onResolveConflict={handleResolveConflict}
            onRefreshPreview={() =>
              setPreviewRevision((revision) => revision + 1)
            }
            onThemeFilesMoved={handleThemeFilesMoved}
            onDirtyFilesChange={setMonacoDirtyFiles}
            onSaveFile={handleUnifiedSaveFile}
            onBuildPreview={handleBuildPreview}
            externalDiagnostics={buildDiagnostics}
            dependencySourceRevisionId={dependencySourceRevisionId}
          />
        </Suspense>
      </EditorCodeModeSurface>

      <EditorModeSurface
        active={editorMode === "design"}
        className="flex-1 overflow-hidden bg-muted/40 max-md:flex-col"
        surfaceRef={designSurfaceRef}
        style={
          {
            [LEFT_PANEL_WIDTH_VARIABLE]: `${leftPanelWidth}px`,
            [RIGHT_PANEL_WIDTH_VARIABLE]: `${rightPanelWidth}px`,
          } as React.CSSProperties
        }
      >
        <EditorSectionsPanel
          style={LEFT_PANEL_STYLE}
          context={routeBackedContext}
          search={search}
          onSearchChange={handleSectionsSearchChange}
          onSectionOrderChange={syncPreviewSectionOrder}
          onSaveStateChange={setDraftSaveState}
          onReorderSections={
            activeThemeRoute ? handleReorderSections : undefined
          }
          onToggleSectionEnabled={handleSectionToggleEnabled}
          activeRoute={activeThemeRoute}
          routeStructurePending={routeStructurePending}
          editableNodes={
            previewStructure?.key === previewKey
              ? previewStructure.nodes
              : undefined
          }
          activeSelection={editableSelection}
          onSelectEditableNode={handleEditableNodeSelect}
          themeRoutes={themeRouteRegistry.routes.filter(
            (route) => route.kind === "route",
          )}
          onPrefetchThemeRoute={handlePrefetchThemeRoute}
          onOpenThemeRoute={handleOpenThemeRoute}
          sectionOptions={routeSectionOptions}
          onAddSection={activeThemeRoute ? handleAddSection : undefined}
          onDeleteSection={
            activeThemeRoute && activeRouteSections.length > 0
              ? handleDeleteSection
              : undefined
          }
          onDeleteEditableNode={handleDeleteEditableNode}
        />

        {/* Left Panel Resizer */}
        <div
          role="separator"
          aria-label="Resize sections panel"
          aria-orientation="vertical"
          aria-valuemin={MIN_LEFT_PANEL_WIDTH}
          aria-valuemax={MAX_LEFT_PANEL_WIDTH}
          aria-valuenow={leftPanelWidth}
          tabIndex={0}
          {...leftPanelResize.handlers}
          className="group relative z-30 flex w-2 -ml-1 cursor-col-resize touch-none select-none items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset max-md:hidden"
          title="Drag to resize sections panel. Arrow keys adjust, Home/End jump to the limits, double-click resets."
        >
          <div className="h-8 w-1 rounded-full bg-border group-hover:bg-primary group-active:bg-primary transition-colors" />
        </div>

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden max-md:hidden">
          <div
            ref={canvasViewportRef}
            className="relative min-h-0 flex-1 touch-none select-none overflow-hidden cursor-grab data-[panning=true]:cursor-grabbing"
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={finishCanvasPan}
            onPointerCancel={finishCanvasPan}
            onDoubleClick={resetCanvas}
            onKeyDown={handleCanvasKeyDown}
            role="region"
            tabIndex={0}
            aria-describedby="storefront-canvas-instructions"
            aria-label="Storefront preview canvas. Use the mouse wheel to scroll, Control plus wheel to zoom, and drag to pan."
            style={
              {
                "--morph-canvas-x": `${canvasTransform.x}px`,
                "--morph-canvas-y": `${canvasTransform.y}px`,
                "--morph-canvas-scale": String(canvasTransform.scale),
                "--morph-canvas-half-width": `${(previewWidth * canvasTransform.scale) / 2}px`,
                "--morph-canvas-scaled-height": `${previewFrameHeight * canvasTransform.scale}px`,
                contain: "strict",
              } as CSSProperties
            }
          >
            <span id="storefront-canvas-instructions" className="sr-only">
              Use the mouse wheel to scroll the storefront. Hold Control while
              using the mouse wheel, or use plus and minus keys, to zoom. Drag
              or use the arrow keys to pan. Press zero to reset the canvas.
            </span>
            <div
              className={cn(
                "absolute left-1/2 top-12 will-change-transform transition-opacity duration-200 z-30",
                isPreviewLoading && previewUrl
                  ? "pointer-events-none opacity-0"
                  : "opacity-100",
              )}
              style={{
                width: previewWidth,
                transform:
                  "translate3d(calc(-50% + var(--morph-canvas-x)), var(--morph-canvas-y), 0) scale(var(--morph-canvas-scale))",
                transformOrigin: "top center",
              }}
            >
              <div
                className={cn(
                  "relative overflow-hidden border bg-background shadow-xl",
                  search.viewport !== "desktop" && "rounded-lg",
                )}
                style={{
                  height: previewFrameHeight,
                }}
              >
                {previewUrl ? (
                  <iframe
                    ref={previewIframeRef}
                    key={previewKey}
                    src={previewUrl}
                    title={`${activeTemplate?.name ?? context.theme.name} storefront preview`}
                    sandbox={
                      livePreviewSecurity.enabled
                        ? livePreviewSecurity.sandbox
                        : undefined
                    }
                    referrerPolicy="same-origin"
                    scrolling="no"
                    className="block size-full border-0 bg-stone-50"
                    onLoad={() => {
                      syncPreviewViewportHeight();
                      syncPreviewSection();
                      syncPreviewSelectionMode();
                      syncPreviewSpacingOverlay();
                      requestPreviewSize();
                    }}
                  />
                ) : !livePreviewSecurity.enabled ? (
                  <div className="flex size-full items-center justify-center p-6 text-center text-sm text-destructive">
                    Live Preview is unavailable: {livePreviewSecurity.reason}.
                  </div>
                ) : (
                  <div className="flex size-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                    No template is available for preview.
                  </div>
                )}

                {/* Comment Click Overlay when in Comment Mode & Open tab (disabled in Resolved tab) */}
                {isCommentMode && commentFilter === "open" ? (
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label="Click to place comment pin"
                    className="absolute inset-0 z-20 cursor-crosshair select-none"
                    onPointerDown={(e) => {
                      if (e.button === 1) {
                        e.preventDefault();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        beginCanvasPan(
                          "canvas",
                          e.pointerId,
                          e.clientX,
                          e.clientY,
                        );
                        return;
                      }
                      e.stopPropagation();
                    }}
                    onPointerMove={(e) => {
                      moveCanvasPan(
                        "canvas",
                        e.pointerId,
                        e.clientX,
                        e.clientY,
                      );
                    }}
                    onPointerUp={(e) => {
                      if (e.button === 1) {
                        endCanvasPan("canvas", e.pointerId);
                        return;
                      }
                      e.stopPropagation();
                    }}
                    onPointerCancel={(e) => {
                      if (e.button === 1) {
                        endCanvasPan("canvas", e.pointerId);
                        return;
                      }
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      // If an existing thread or draft pin is open, clicking outside closes it first
                      if (activeCommentThreadId || draftCommentPin) {
                        setActiveCommentThreadId(null);
                        setDraftCommentPin(null);
                        return;
                      }

                      const rect = e.currentTarget.getBoundingClientRect();
                      if (rect.width <= 0 || rect.height <= 0) return;
                      const x = ((e.clientX - rect.left) / rect.width) * 100;
                      const y = ((e.clientY - rect.top) / rect.height) * 100;
                      setDraftCommentPin({
                        x: Math.max(2, Math.min(98, Math.round(x * 10) / 10)),
                        y: Math.max(2, Math.min(98, Math.round(y * 10) / 10)),
                      });
                    }}
                  />
                ) : null}
              </div>

              {/* Canvas Comments Pins & Floating Thread Popovers (unclipped layer) */}
              {activeTemplate && isCommentMode ? (
                <div
                  className="pointer-events-none absolute inset-0 z-30"
                  style={{ height: previewFrameHeight }}
                >
                  <EditorCanvasComments
                    storefrontId={context.storefront.id}
                    themeId={context.theme.id}
                    templateId={activeTemplate.id}
                    activeGroupId={activeGroupId}
                    onActiveGroupChange={handleSelectGroup}
                    filter={commentFilter}
                    threads={commentThreads}
                    isCommentMode={isCommentMode}
                    activeThreadId={activeCommentThreadId}
                    onActiveThreadChange={handleSelectCommentThread}
                    draftPin={draftCommentPin}
                    onDraftPinChange={setDraftCommentPin}
                    previewWidth={previewWidth}
                    currentUser={currentUser}
                    canvasScale={canvasTransform.scale}
                  />
                </div>
              ) : null}
            </div>

            {isPreviewLoading && previewUrl ? (
              <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
                <LoaderCircle className="size-7 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <PreviewSizeControl
                  width={previewWidth}
                  height={previewFrameHeight}
                  canvasTransform={canvasTransform}
                  onWidthPreview={updatePreviewWidth}
                  onWidthChange={applyPreviewWidth}
                  isWidthLocked={isWidthLocked}
                  onToggleLock={() => setIsWidthLocked((prev) => !prev)}
                />
                {!isWidthLocked ? (
                  <>
                    <div
                      role="separator"
                      aria-label="Resize storefront preview from its left edge"
                      aria-orientation="vertical"
                      aria-valuemin={MIN_PREVIEW_WIDTH}
                      aria-valuemax={MAX_PREVIEW_WIDTH}
                      aria-valuenow={previewWidth}
                      tabIndex={0}
                      className="group absolute z-20 flex w-5 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center outline-none"
                      style={{
                        left: "clamp(0.75rem, calc(50% + var(--morph-canvas-x) - var(--morph-canvas-half-width)), calc(100% - 0.75rem))",
                        top: "max(0px, calc(3rem + var(--morph-canvas-y)))",
                        bottom:
                          "max(0px, calc(100% - 3rem - var(--morph-canvas-y) - var(--morph-canvas-scaled-height)))",
                      }}
                      title="Drag the page edge to resize the preview symmetrically"
                      onPointerDown={handleResizePointerDown("left")}
                      onPointerMove={handleResizePointerMove}
                      onPointerUp={finishPreviewResize}
                      onPointerCancel={finishPreviewResize}
                      onKeyDown={handleResizeKeyDown}
                    >
                      <span className="h-full w-px bg-border/70 group-hover:bg-primary group-focus-visible:bg-primary" />
                      <span className="absolute top-1/2 h-16 w-1 -translate-y-1/2 rounded-full bg-border shadow-sm group-hover:bg-primary group-focus-visible:bg-primary" />
                    </div>
                    <div
                      role="separator"
                      aria-label="Resize storefront preview from its right edge"
                      aria-orientation="vertical"
                      aria-valuemin={MIN_PREVIEW_WIDTH}
                      aria-valuemax={MAX_PREVIEW_WIDTH}
                      aria-valuenow={previewWidth}
                      tabIndex={0}
                      className="group absolute z-20 flex w-5 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center outline-none"
                      style={{
                        left: "clamp(0.75rem, calc(50% + var(--morph-canvas-x) + var(--morph-canvas-half-width)), calc(100% - 0.75rem))",
                        top: "max(0px, calc(3rem + var(--morph-canvas-y)))",
                        bottom:
                          "max(0px, calc(100% - 3rem - var(--morph-canvas-y) - var(--morph-canvas-scaled-height)))",
                      }}
                      title="Drag the page edge to resize the preview symmetrically"
                      onPointerDown={handleResizePointerDown("right")}
                      onPointerMove={handleResizePointerMove}
                      onPointerUp={finishPreviewResize}
                      onPointerCancel={finishPreviewResize}
                      onKeyDown={handleResizeKeyDown}
                    >
                      <span className="h-full w-px bg-border/70 group-hover:bg-primary group-focus-visible:bg-primary" />
                      <span className="absolute top-1/2 h-16 w-1 -translate-y-1/2 rounded-full bg-border shadow-sm group-hover:bg-primary group-focus-visible:bg-primary" />
                    </div>
                  </>
                ) : null}
              </>
            )}

            {previewLoadFailure?.key === previewKey && previewUrl ? (
              <div
                role="alert"
                className="absolute left-1/2 top-16 z-50 flex max-w-md -translate-x-1/2 items-start gap-3 rounded-lg border border-amber-500/40 bg-background/95 p-3 text-sm shadow-lg backdrop-blur-sm"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <div className="min-w-0">
                  <p className="text-foreground">
                    {previewLoadFailure.message}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      setPreviewLoadFailure(null);
                      void themeFilesQuery.refetch();
                      setPreviewRevision((revision) => revision + 1);
                    }}
                  >
                    Retry Preview
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <EditorControls
            context={context}
            search={search}
            onSearchChange={onSearchChange}
            onRouteIntent={handleRouteIntent}
            onPrefetchRoute={handlePrefetchThemeRoute}
            themeRoutes={themeRouteRegistry.routes.filter(
              (route) => route.kind === "route",
            )}
            isSelectionMode={isSelectionMode}
            onSelectionModeChange={(enabled) => {
              autoEnabledSelectionForStylesRef.current = false;
              setIsSelectionMode(enabled);
              if (enabled && isCommentMode) {
                handleExitCommentMode();
              }
            }}
            spacingOverlayMode={spacingOverlayMode}
            onSpacingOverlayModeChange={setSpacingOverlayMode}
            isCommentMode={isCommentMode}
            onCommentModeChange={(enabled) => {
              autoEnabledSelectionForStylesRef.current = false;
              if (enabled) {
                setIsCommentMode(true);
                setIsSelectionMode(false);
                if (commentGroups.length > 0) {
                  const targetGroupId = activeGroupId ?? commentGroups[0].id;
                  const targetGroup =
                    commentGroups.find((g) => g.id === targetGroupId) ??
                    commentGroups[0];
                  if (targetGroup && targetGroup.viewportWidth > 0) {
                    applyPreviewWidth(targetGroup.viewportWidth, true);
                    setIsWidthLocked(true);
                  }
                }
              } else {
                handleExitCommentMode();
              }
            }}
            onRefresh={() => {
              setPreviewLoadFailure(null);
              setPreviewRevision((revision) => revision + 1);
            }}
          />
        </main>

        {/* Right Panel Resizer */}
        <div
          role="separator"
          aria-label="Resize assistant and styles panel"
          aria-orientation="vertical"
          aria-valuemin={MIN_RIGHT_PANEL_WIDTH}
          aria-valuemax={MAX_RIGHT_PANEL_WIDTH}
          aria-valuenow={rightPanelWidth}
          tabIndex={0}
          {...rightPanelResize.handlers}
          className="group relative z-30 flex w-2 -mr-1 cursor-col-resize touch-none select-none items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset max-md:hidden"
          title="Drag to resize assistant panel. Arrow keys adjust, Home/End jump to the limits, double-click resets."
        >
          <div className="h-8 w-1 rounded-full bg-border group-hover:bg-primary group-active:bg-primary transition-colors" />
        </div>

        <EditorAssistantPanel
          style={RIGHT_PANEL_STYLE}
          // Same nodes the sections tree uses, so the Content tab can fall back
          // to document order when a component declares no `contentFields`.
          editableNodes={
            previewStructure?.key === previewKey
              ? previewStructure.nodes
              : undefined
          }
          context={routeBackedContext}
          search={search}
          isCommentMode={isCommentMode}
          commentFilter={commentFilter}
          onCommentFilterChange={setCommentFilter}
          commentGroups={commentGroups}
          activeCommentGroupId={activeGroupId}
          onSelectCommentGroup={handleSelectGroup}
          onCreateCommentGroup={() => createGroupMutation.mutate()}
          commentThreads={commentThreads}
          activeCommentThreadId={activeCommentThreadId}
          onSelectCommentThread={handleSelectCommentThread}
          previewWidth={previewWidth}
          themeFiles={effectiveThemeFiles}
          selection={editableSelection}
          activeComputedStyleRevision={activeComputedStyleRevision}
          activeViewport={search.viewport}
          onUpdateThemeFileStyle={handleUpdateThemeFileStyle}
          onPreviewSelectionStyle={previewSelectionStyle}
          onPreviewSelectionField={previewSelectionField}
          onRepairThemeLinkBinding={handleRepairThemeLinkBinding}
          onSwitchThemeLinkElement={handleSwitchThemeLinkElement}
          onSectionPropsChange={handleSectionPropsChange}
          onJumpToCode={handleJumpToCode}
          onTabChange={setAssistantPanelTab}
        />

        <EditorSmallScreenNotice />
      </EditorModeSurface>

      <AlertDialog
        open={isUnsavedCodeDialogOpen}
        onOpenChange={(open) => {
          if (!isSavingCodeBeforeModeSwitch) {
            setIsUnsavedCodeDialogOpen(open);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Code changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes in {monacoDirtyFiles.length} Code Editor{" "}
              {monacoDirtyFiles.length === 1 ? "file" : "files"}. Save them
              before switching to Design?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSavingCodeBeforeModeSwitch}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isSavingCodeBeforeModeSwitch}
              onClick={handleContinueToDesign}
            >
              Continue without saving
            </AlertDialogAction>
            <Button
              type="button"
              variant="form"
              disabled={isSavingCodeBeforeModeSwitch}
              onClick={() => void handleSaveAndSwitchToDesign()}
            >
              {isSavingCodeBeforeModeSwitch ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : null}
              {isSavingCodeBeforeModeSwitch ? "Saving…" : "Save & switch"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PreviewSizeControl({
  width,
  height,
  canvasTransform,
  onWidthPreview,
  onWidthChange,
  isWidthLocked = false,
  onToggleLock,
}: {
  width: number;
  height: number;
  canvasTransform: CanvasTransform;
  onWidthPreview: (width: number) => void;
  onWidthChange: (width: number) => void;
  isWidthLocked?: boolean;
  onToggleLock?: () => void;
}) {
  const viewport = resolvePreviewViewport(width);
  const SizeIcon =
    viewport === "desktop"
      ? Monitor
      : viewport === "tablet"
        ? Tablet
        : Smartphone;

  return (
    <div
      className="absolute z-20 flex h-7 -translate-y-full items-center gap-2 rounded-md border bg-popover px-2 text-xs text-popover-foreground shadow-sm outline-none focus-within:ring-2 focus-within:ring-ring hover:bg-accent"
      style={{
        left: "max(0.5rem, calc(50% + var(--morph-canvas-x) - var(--morph-canvas-half-width)))",
        top: "calc(3rem + var(--morph-canvas-y) - 0.5rem)",
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <SizeIcon className="size-3.5 text-muted-foreground" />
      <ScrubbableNumberInput
        value={width}
        min={MIN_PREVIEW_WIDTH}
        max={MAX_PREVIEW_WIDTH}
        step={1}
        disabled={isWidthLocked}
        scrubPixelsPerStep={canvasTransform.scale}
        suffix={` × ${height}`}
        ariaLabel="Preview width in pixels"
        onValuePreview={(value) => onWidthPreview(clampPreviewWidth(value))}
        onValueChange={(value) => onWidthChange(clampPreviewWidth(value))}
        inputClassName="h-5 w-9 min-w-8 rounded-sm border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-1"
      />
      <span className="sr-only capitalize">{viewport} breakpoint</span>

      {onToggleLock ? (
        <button
          type="button"
          onClick={onToggleLock}
          className={cn(
            "ml-0.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors select-none",
            isWidthLocked
              ? "bg-primary/15 text-primary hover:bg-primary/25 font-semibold"
              : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
          )}
          title={
            isWidthLocked
              ? "Width is locked (Click to unlock)"
              : "Width is unlocked (Click to lock)"
          }
        >
          {isWidthLocked ? (
            <Lock className="size-2.5" />
          ) : (
            <Unlock className="size-2.5" />
          )}
          <span>{isWidthLocked ? "Locked" : "Unlocked"}</span>
        </button>
      ) : null}
    </div>
  );
}

function EditorSmallScreenNotice() {
  return (
    <section className="hidden min-h-0 items-center justify-center p-6 text-center max-md:flex">
      <div className="max-w-sm">
        <div className="mx-auto flex size-10 items-center justify-center rounded-lg border bg-component shadow-xs">
          <AppWindow className="size-4 text-muted-foreground" />
        </div>
        <h1 className="mt-4 text-base font-semibold">
          A larger screen is required
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          The visual editor currently supports desktop authoring. Increase the
          window width to access sections, the canvas, styles, and AI tools.
        </p>
      </div>
    </section>
  );
}

const editorCompactRadioItemClassName =
  "h-6 py-0 pr-1.5 pl-6 text-xs leading-none [&>span:first-child]:left-1.5";

function EditorControls({
  context,
  search,
  onSearchChange,
  onRouteIntent,
  onPrefetchRoute,
  themeRoutes,
  isSelectionMode,
  onSelectionModeChange,
  spacingOverlayMode,
  onSpacingOverlayModeChange,
  isCommentMode,
  onCommentModeChange,
  onRefresh,
}: {
  context: StorefrontThemeEditorDTO;
  search: StorefrontThemeEditorSearch;
  onSearchChange: (next: Partial<StorefrontThemeEditorSearch>) => void;
  onRouteIntent: (routePath?: string) => void;
  onPrefetchRoute: (route: ThemeRouteRecord) => void;
  themeRoutes: readonly ThemeRouteRecord[];
  isSelectionMode: boolean;
  onSelectionModeChange: (enabled: boolean) => void;
  spacingOverlayMode: PreviewSpacingOverlayMode;
  onSpacingOverlayModeChange: (mode: PreviewSpacingOverlayMode) => void;
  isCommentMode: boolean;
  onCommentModeChange: (enabled: boolean) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-40 flex justify-center px-3">
      <EditorToolbar
        aria-label="Storefront canvas controls"
        className="pointer-events-auto"
        // The toolbar lives inside the canvas pan surface. Stop its pointer
        // events from reaching the canvas handler, which otherwise captures
        // the pointer for panning and prevents the button click from firing.
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Button
          variant={isSelectionMode ? "toolbarActive" : "ghost"}
          size="icon"
          className="size-7 shrink-0"
          aria-label={
            isSelectionMode
              ? "Disable section selection"
              : "Enable section selection"
          }
          aria-pressed={isSelectionMode}
          title={
            isSelectionMode
              ? "Exit section selection mode"
              : "Select sections on the page"
          }
          onClick={() => onSelectionModeChange(!isSelectionMode)}
        >
          <MousePointer2 />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={spacingOverlayMode === "off" ? "ghost" : "toolbarActive"}
              size="icon"
              className="size-7 shrink-0"
              aria-label="Canvas spacing overlay"
              aria-pressed={spacingOverlayMode !== "off"}
              title="Show padding and margin on the canvas"
            >
              <Ruler />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={6}
            className="w-40 p-1 text-xs"
          >
            <DropdownMenuLabel className="px-1.5 py-1 text-[11px] leading-none text-muted-foreground">
              Spacing overlay
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="my-0.5" />
            <DropdownMenuRadioGroup
              value={spacingOverlayMode}
              onValueChange={(value) => {
                if (isPreviewSpacingOverlayMode(value)) {
                  onSpacingOverlayModeChange(value);
                }
              }}
            >
              <DropdownMenuRadioItem
                value="off"
                className={editorCompactRadioItemClassName}
              >
                Off
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="selected"
                className={editorCompactRadioItemClassName}
              >
                Selected element
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="all"
                className={editorCompactRadioItemClassName}
              >
                All editable elements
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant={isCommentMode ? "toolbarActive" : "ghost"}
          size="icon"
          className="size-7 shrink-0"
          aria-label={
            isCommentMode ? "Disable comment mode" : "Enable comment mode"
          }
          aria-pressed={isCommentMode}
          title={
            isCommentMode
              ? "Exit comment mode"
              : "Click to place comments on the canvas"
          }
          onClick={() => onCommentModeChange(!isCommentMode)}
        >
          <MessageCircle />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 shadow-none"
          disabled
          aria-label="Open preview in new tab"
          title="Open preview is not available yet"
        >
          <ExternalLink />
        </Button>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <EditorToolbarGroup aria-label="Preview surface">
          <EditorToolbarMode active>Store</EditorToolbarMode>
          <EditorToolbarMode
            disabled
            title="Admin preview is not available yet"
          >
            Admin
          </EditorToolbarMode>
        </EditorToolbarGroup>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <EditorPathNavigator
          context={context}
          search={search}
          onSearchChange={onSearchChange}
          onRouteIntent={onRouteIntent}
          onPrefetchRoute={onPrefetchRoute}
          onRefresh={onRefresh}
          themeRoutes={themeRoutes}
        />
      </EditorToolbar>
    </div>
  );
}
