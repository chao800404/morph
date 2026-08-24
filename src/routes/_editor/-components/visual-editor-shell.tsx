import { Button } from "@/components/ui/button";
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
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  AppWindow,
  CheckCircle2,
  CircleCheck,
  CircleAlert,
  ChevronDown,
  Code2,
  ExternalLink,
  Layers,
  Layout,
  LoaderCircle,
  Lock,
  MessageCircle,
  Monitor,
  MousePointer2,
  Play,
  Redo2,
  Smartphone,
  Tablet,
  Undo2,
  Unlock,
} from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import type {
  StorefrontCommentGroupDTO,
  StorefrontCommentThreadDTO,
} from "@/lib/storefront/dto/storefront-comment.dto";
import type {
  StorefrontThemeFileDTO,
  StorefrontThemeFileTreeNode,
} from "@/lib/storefront/dto/storefront-theme-file.dto";
import type {
  StorefrontThemeBuildDTO,
  StorefrontThemeBuildPreviewDTO,
} from "@/lib/storefront/dto/storefront-theme-build.dto";

import {
  publishStorefrontThemeTemplate,
  reorderStorefrontThemeSections,
  updateStorefrontThemeSectionProps,
} from "@/server/storefront/storefront-themes.serverFn";
import {
  createStorefrontCommentGroup,
  updateStorefrontCommentGroup,
} from "@/server/storefront/storefront-comments.serverFn";
import {
  createStorefrontThemeRevision,
  getStorefrontThemeFile,
  initStorefrontStarterTheme,
  saveStorefrontThemeFile,
} from "@/server/storefront/storefront-theme-files.serverFn";
import {
  createPreviewBuild,
  getPreviewBuildToken,
  getThemeBuild,
} from "@/server/storefront/storefront-theme-builds.serverFn";

import {
  patchElementClassNameResult,
  swapSiblingMorphNodes,
} from "@/lib/storefront/ast/theme-ast-transformer";
import {
  findLegacyThemeInstanceStyleSheet,
  patchThemeInstanceStyleClasses,
  readLegacyThemeInstanceStyleClasses,
  removeLegacyThemeInstanceStyle,
  removeLegacyThemeInstanceStyleImport,
  type ThemeInstanceStyleTarget,
} from "@/lib/storefront/editor/theme-instance-style-source";
import { swapArrayItemsAtFieldPaths } from "@/lib/storefront/editor/reorder-array-items";
import {
  toWorkspaceKey,
  useThemeWorkspaceStore,
} from "@/lib/storefront/store/theme-workspace-store";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";
import { storefrontCommentQueries } from "../-queries/storefront-comment.queries";
import { storefrontThemeFileQueries } from "../-queries/storefront-theme-files.queries";
import {
  EditorAssistantPanel,
  type EditorAssistantPanelTab,
} from "./editor-assistant-panel";
import { resolveStylesSelectionTransition } from "./editor-styles-selection-mode";
import {
  isLatestStyleRevision,
  shouldRevealPreviewForStyleAck,
} from "./style-revision";
import { type EditorSelectionDescriptor } from "@/lib/storefront/editor/selection-taxonomy";
import {
  parsePreviewSectionProps,
  parsePreviewToEditorMessage,
  postEditorToPreviewMessage,
  type PreviewSelectionRestoreTarget,
  type PreviewSectionProps,
} from "@/lib/storefront/editor/preview-protocol";
import { EditorCanvasComments } from "./editor-canvas-comments";
import { EditorCodeWorkspace } from "./editor-code-workspace";
import { resolveCodeSelectionTarget } from "./editor-code-selection";
import { EditorPathNavigator } from "./editor-path-navigator";
import { EditorSectionsPanel } from "./editor-sections-panel";
import { resolveEditorTemplate } from "./editor-template";
import {
  EditorToolbar,
  EditorToolbarGroup,
  EditorToolbarMode,
} from "./editor-toolbar";

export function EditorModeSurface({
  active,
  className,
  children,
}: {
  active: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-hidden={!active}
      className={cn(
        "col-start-1 row-start-2 min-h-0 min-w-0 flex",
        active ? "visible" : "invisible pointer-events-none",
        className,
      )}
      data-editor-mode-surface="true"
    >
      {children}
    </div>
  );
}

export function createSelectionRestoreMessages(
  selectionMode: boolean,
  restoreTarget: PreviewSelectionRestoreTarget | null,
) {
  const messages: Array<
    | { type: "morph:storefront-preview-set-selection-mode"; enabled: boolean; restoreTarget?: PreviewSelectionRestoreTarget }
    | { type: "morph:storefront-preview-request-selection-style" }
  > = [
    {
      type: "morph:storefront-preview-set-selection-mode",
      enabled: selectionMode,
      restoreTarget: selectionMode ? restoreTarget ?? undefined : undefined,
    },
  ];
  if (selectionMode && restoreTarget) {
    messages.push({
      type: "morph:storefront-preview-request-selection-style",
    });
  }
  return messages;
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
  const [leftPanelWidth, setLeftPanelWidth] = useState(
    () => context.panelWidths?.left ?? DEFAULT_LEFT_PANEL_WIDTH,
  );

  const [rightPanelWidth, setRightPanelWidth] = useState(
    () => context.panelWidths?.right ?? DEFAULT_RIGHT_PANEL_WIDTH,
  );

  const leftResizeStateRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);

  const rightResizeStateRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);

  const handleLeftPanelResizePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    leftResizeStateRef.current = {
      startX: event.clientX,
      startWidth: leftPanelWidth,
    };
  };

  const handleLeftPanelResizePointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!leftResizeStateRef.current) return;
    const delta = event.clientX - leftResizeStateRef.current.startX;
    const nextWidth = Math.min(
      MAX_LEFT_PANEL_WIDTH,
      Math.max(
        MIN_LEFT_PANEL_WIDTH,
        Math.round(leftResizeStateRef.current.startWidth + delta),
      ),
    );
    setLeftPanelWidth(nextWidth);
  };

  const finishLeftPanelResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!leftResizeStateRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    leftResizeStateRef.current = null;
    try {
      document.cookie = `morph:editor-left-panel-width=${leftPanelWidth}; path=/; max-age=31536000; SameSite=Lax`;
      localStorage.setItem(
        "morph:editor-left-panel-width",
        String(leftPanelWidth),
      );
    } catch {}
  };

  const handleRightPanelResizePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    rightResizeStateRef.current = {
      startX: event.clientX,
      startWidth: rightPanelWidth,
    };
  };

  const handleRightPanelResizePointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!rightResizeStateRef.current) return;
    const delta = rightResizeStateRef.current.startX - event.clientX;
    const nextWidth = Math.min(
      MAX_RIGHT_PANEL_WIDTH,
      Math.max(
        MIN_RIGHT_PANEL_WIDTH,
        Math.round(rightResizeStateRef.current.startWidth + delta),
      ),
    );
    setRightPanelWidth(nextWidth);
  };

  const finishRightPanelResize = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!rightResizeStateRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    rightResizeStateRef.current = null;
    try {
      document.cookie = `morph:editor-right-panel-width=${rightPanelWidth}; path=/; max-age=31536000; SameSite=Lax`;
      localStorage.setItem(
        "morph:editor-right-panel-width",
        String(rightPanelWidth),
      );
    } catch {}
  };

  const [previewRevision, setPreviewRevision] = useState(0);
  const [loadedPreviewKey, setLoadedPreviewKey] = useState<string | null>(null);
  const [previewFrameReady, setPreviewFrameReady] = useState<{
    key: string;
    sequence: number;
  } | null>(null);
  const [previewContentSize, setPreviewContentSize] = useState<{
    key: string;
    height: number;
  } | null>(null);
  const [canvasTransform, setCanvasTransform] = useState<CanvasTransform>(
    initialCanvasTransform,
  );
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [assistantPanelTab, setAssistantPanelTab] =
    useState<EditorAssistantPanelTab>("chat");
  const previousAssistantPanelTabRef = useRef<EditorAssistantPanelTab>("chat");
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

      for (const [key, timer] of Array.from(
        pendingPropsTimersRef.current.entries(),
      )) {
        if (key.startsWith(prefix)) {
          clearTimeout(timer);
          pendingPropsTimersRef.current.delete(key);
          const pending = pendingPropsMapRef.current.get(key);
          pendingPropsMapRef.current.delete(key);
          if (pending) {
            flushPromises.push(
              enqueueTemplateMutation(tid, (gen) =>
                updatePropsMutation.mutateAsync({
                  sectionId: pending.sectionId,
                  props: pending.props,
                  expectedDraftGeneration: gen,
                }),
              ),
            );
          }
        }
      }

      await Promise.all(flushPromises);
      await templateMutationQueueRef.current.get(tid);
    },
    [activeTemplate?.id, enqueueTemplateMutation, updatePropsMutation],
  );

  const previewUrl = activeTemplate
    ? `/store/${encodeURIComponent(context.storefront.id)}/themes/${encodeURIComponent(context.theme.id)}/preview?templateId=${encodeURIComponent(activeTemplate.id)}&viewportHeight=${DEFAULT_PREVIEW_VIEWPORT_HEIGHT}`
    : null;
  const previewKey = previewUrl ? `${previewUrl}-${previewRevision}` : null;
  const isPreviewLoading =
    previewKey !== null && loadedPreviewKey !== previewKey;
  const previewFrameHeight =
    previewContentSize?.key === previewKey
      ? previewContentSize.height
      : previewDefaultHeights[search.viewport];
  const ActiveViewportIcon =
    viewportOptions.find((option) => option.value === search.viewport)?.icon ??
    Monitor;

  const [editorMode, setEditorMode] = useState<"design" | "code">("design");
  const [previewMode, setPreviewMode] = useState<"live" | "build">("live");
  const [activeBuildPreview, setActiveBuildPreview] =
    useState<StorefrontThemeBuildDTO | null>(null);
  const [activeBuildSourceGeneration, setActiveBuildSourceGeneration] =
    useState<number | null>(null);
  const [activePreviewToken, setActivePreviewToken] = useState<string | null>(
    null,
  );
  const [isBuildPending, setIsBuildPending] = useState(false);
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

  const [activeSelection, setActiveSelection] =
    useState<EditorSelectionDescriptor | null>(null);
  const lastPreviewSelectionRef =
    useRef<PreviewSelectionRestoreTarget | null>(null);
  const previousTemplateIdRef = useRef(search.templateId);
  const previewSelectionSectionSyncRef = useRef<string | null>(null);
  const [activeComputedStyleRevision, setActiveComputedStyleRevision] =
    useState(0);
  const latestStyleRevisionRef = useRef(0);
  const latestAppliedStyleRevisionRef = useRef(0);
  const [monacoDirtyFiles, setMonacoDirtyFiles] = useState<string[]>([]);

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
  const workspaceKey = toWorkspaceKey(context.storefront.id, context.theme.id);
  const isWorkspaceReadyForPreview =
    themeFilesQuery.isSuccess &&
    themeFiles.length > 0 &&
    activeWorkspaceKey === workspaceKey &&
    themeFiles.every((file) => workspaceFiles[file.path] !== undefined);

  const pendingSaveTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const saveQueueRef = useRef<Map<string, Promise<unknown>>>(new Map());
  const fileRevisionRef = useRef<Map<string, number>>(new Map());
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const arrayItemReorderHandlerRef = useRef<
    (
      sectionId: string,
      draggedFieldPath: string,
      targetFieldPath: string,
    ) => void
  >(() => {});
  const previewSelectionStyle = useCallback(
    (styles: Record<string, string>, targetElement: string) => {
      postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
        type: "morph:storefront-preview-update-selection-style",
        styles,
        targetElement,
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
    },
    [],
  );
  const postPreviewThemeFiles = useCallback(
    (files: Array<{ path: string; content: string }>) => {
      const styleRevision = latestStyleRevisionRef.current + 1;
      latestStyleRevisionRef.current = styleRevision;
      postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
        type: "morph:storefront-preview-update-theme-files",
        files,
        styleRevision,
      });
      return styleRevision;
    },
    [],
  );
  const initialPreviewSyncRef = useRef<{
    key: string;
    readySequence: number;
    styleRevision: number;
  } | null>(null);

  useEffect(() => {
    if (
      !previewKey ||
      previewFrameReady?.key !== previewKey ||
      !isWorkspaceReadyForPreview ||
      effectiveThemeFiles.length === 0 ||
      (initialPreviewSyncRef.current?.key === previewKey &&
        initialPreviewSyncRef.current.readySequence ===
          previewFrameReady.sequence)
    ) {
      return;
    }

    const styleRevision = postPreviewThemeFiles(
      effectiveThemeFiles.map((file) => ({
        path: file.path,
        content: file.content,
      })),
    );
    initialPreviewSyncRef.current = {
      key: previewKey,
      readySequence: previewFrameReady.sequence,
      styleRevision,
    };
  }, [
    effectiveThemeFiles,
    isWorkspaceReadyForPreview,
    postPreviewThemeFiles,
    previewFrameReady,
    previewKey,
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
    if (!latestPublishedRevision?.snapshot) return null;
    const map = new Map<string, string>();
    for (const item of latestPublishedRevision.snapshot) {
      map.set(item.path, item.content);
    }
    return map;
  }, [latestPublishedRevision]);

  const hasThemeSourceChanges = useMemo(() => {
    // True server-backed published state diffing
    if (publishedSnapshotMap) {
      if (effectiveThemeFiles.length !== publishedSnapshotMap.size) return true;
      for (const f of effectiveThemeFiles) {
        const publishedContent = publishedSnapshotMap.get(f.path);
        if (publishedContent === undefined) return true; // new file
        if (f.content !== publishedContent) return true; // modified file
      }
      return false;
    }
    // Fallback if theme has never been published yet
    return effectiveThemeFiles.some((f) => (f.version ?? 1) > 1);
  }, [effectiveThemeFiles, publishedSnapshotMap]);

  const hasTemplateChanges = Boolean(
    activeTemplate?.draftRevisionId &&
    activeTemplate.draftRevisionId !== activeTemplate.publishedRevisionId,
  );
  const hasUnpublishedChanges = hasTemplateChanges || hasThemeSourceChanges;

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
                  expectedFileId: current.serverExists
                    ? (current.serverFileId ?? undefined)
                    : undefined,
                  expectedVersion: current.serverExists
                    ? (current.serverVersion ?? undefined)
                    : undefined,
                  expectMissing: !current.serverExists,
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

  const handleUnifiedSaveFile = useCallback(
    async (filePath: string, content: string) => {
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
        const message =
          result.reason === "not-siblings"
            ? "Only unique elements under the same source parent can be reordered."
            : result.reason === "parse-error"
              ? `Cannot reorder because ${filePath} contains a syntax error.`
              : "This rendered element cannot be mapped to one unique source sibling.";
        toast.warning(message);
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
      queryClient,
      resolveWorkspaceConflict,
      themeFiles,
      workspaceScope,
    ],
  );

  const handlePublish = useCallback(async () => {
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

    if (
      activeBuildPreview &&
      activeBuildSourceGeneration !== currentGeneration
    ) {
      toast.error(
        "Cannot publish: source changed after the last build. Build Preview again before publishing.",
      );
      return;
    }

    if (!activeBuildPreview && !context.theme.activeRelease) {
      toast.error(
        "Cannot publish: create a successful Build Preview before the first release.",
      );
      return;
    }

    await publishMutation.mutateAsync({
      sourceRevisionId: activeBuildPreview?.sourceRevisionId,
      themeBuildId: activeBuildPreview?.id,
      expectedDraftRevisionId: publishDraftRevisionId,
      expectedDraftGeneration: publishDraftGeneration,
      expectedReleaseGeneration: context.theme.releaseGeneration ?? 1,
    });
  }, [
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
  ]);

  const handleBuildPreview = useCallback(async () => {
    if (isBuildPending) return;

    if (themeFiles.length === 0) {
      toast.error(
        "Cannot build preview: initialize starter theme files in Code Workspace first.",
      );
      return;
    }

    if (
      monacoDirtyFiles.length > 0 ||
      useThemeWorkspaceStore.getState().hasUnsavedEdits(workspaceScope)
    ) {
      toast.error(
        `Cannot build preview: save Code Editor changes first (${monacoDirtyFiles.join(", ")}).`,
      );
      return;
    }

    if (
      useThemeWorkspaceStore
        .getState()
        .hasActiveConflictsOrErrors(workspaceScope)
    ) {
      toast.error(
        "Cannot build preview: resolve source conflicts/save errors first.",
      );
      return;
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
        return;
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
        return;
      }

      let build: StorefrontThemeBuildDTO = buildResult.data;

      // Poll getThemeBuild if build was queued or building

      let attempts = 0;
      while (
        (build.status === "queued" || build.status === "building") &&
        attempts < 30
      ) {
        attempts++;
        await new Promise((r) => setTimeout(r, 1000));
        const pollResult = await getThemeBuild({
          data: {
            storefrontId: context.storefront.id,
            themeId: context.theme.id,
            buildId: build.id,
          },
        });
        if (pollResult.success && pollResult.data) {
          build = pollResult.data;
          if (build.status === "succeeded" || build.status === "failed") {
            break;
          }
        }
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
          return;
        }

        setActiveBuildPreview(build);
        setActivePreviewToken(token);
        setActiveBuildSourceGeneration(currentGeneration);
        setPreviewMode("build");
        toast.success(
          `Build ${build.id.slice(0, 8)} succeeded! Showing immutable preview.`,
        );
      } else {
        toast.error(build.errorMessage || `Build status: ${build.status}`);
        setBuildDiagnostics(build.diagnosticsJson);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to create preview build");
      setBuildDiagnostics({ error: err?.message || String(err) });
    } finally {
      setIsBuildPending(false);
    }
  }, [
    context.storefront.id,
    context.theme.id,
    isBuildPending,
    monacoDirtyFiles,
    themeFiles,
    workspaceScope,
  ]);

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
        const styleRevision = postPreviewThemeFiles(previewFiles);

        // Debounce save to database (300ms)
        const opKey = getScopedOpKey(targetFilePath);
        const existingTimer = pendingSaveTimersRef.current.get(opKey);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }

        const nextRevision = (fileRevisionRef.current.get(opKey) ?? 0) + 1;
        fileRevisionRef.current.set(opKey, nextRevision);

        const newTimer = setTimeout(() => {
          pendingSaveTimersRef.current.delete(opKey);
          saveThemeFileSequentially(
            targetFilePath,
            updatedContent,
            nextRevision,
          ).catch((err) => {
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
  const previewWidthRenderFrameRef = useRef(0);
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

  const scheduleCanvasScroll = useCallback(
    (deltaY: number) => {
      scheduleCanvasTransform((current) => ({
        ...current,
        y: current.y - deltaY,
      }));
    },
    [scheduleCanvasTransform],
  );

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
      setActiveSelection(null);
    }
    previousTemplateIdRef.current = search.templateId;
  }, [search.templateId]);

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
      const message =
        event.origin === window.location.origin &&
        event.source === previewIframeRef.current?.contentWindow
          ? parsePreviewToEditorMessage(event.data)
          : null;
      if (message?.type !== "morph:storefront-preview-size") return;

      const height = Math.min(30_000, Math.max(320, Math.ceil(message.height)));
      setPreviewContentSize((current) =>
        current?.key === previewKey && Math.abs(current.height - height) < 1
          ? current
          : { key: previewKey, height },
      );
    };

    window.addEventListener("message", handlePreviewMessage);
    postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
      type: "morph:storefront-preview-request-size",
    });
    return () => window.removeEventListener("message", handlePreviewMessage);
  }, [previewKey]);

  useEffect(() => {
    if (!previewKey) return;

    const handlePreviewSelection = (event: MessageEvent<unknown>) => {
      const message =
        event.origin === window.location.origin &&
        event.source === previewIframeRef.current?.contentWindow
          ? parsePreviewToEditorMessage(event.data)
          : null;
      if (!message) return;

      if (
        message.type === "morph:storefront-preview-commit-array-item-reorder"
      ) {
        arrayItemReorderHandlerRef.current(
          message.sectionId,
          message.draggedFieldPath,
          message.targetFieldPath,
        );
        return;
      }

      if (message.type === "morph:storefront-preview-commit-sibling-reorder") {
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
          return;
        }
        latestAppliedStyleRevisionRef.current = message.styleRevision;
        postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
          type: "morph:storefront-preview-request-selection-style",
          styleRevision: message.styleRevision,
        });
        return;
      }
      if (message.type !== "morph:storefront-preview-select-section") return;

      const responseStyleRevision = message.styleRevision;
      if (
        !isLatestStyleRevision(
          responseStyleRevision,
          latestStyleRevisionRef.current,
        )
      )
        return;
      const sectionId = message.sectionId;
      const nodeId = message.nodeId ?? null;
      const sourceFilePath = message.sourceFilePath;
      const elementKey = message.elementKey;
      const fieldKey = message.fieldKey ?? message.field;
      const fieldPath = message.fieldPath ?? fieldKey;
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
      lastPreviewSelectionRef.current = {
        sectionId,
        nodeId: nodeId ?? undefined,
        fieldPath: message.fieldPath ?? undefined,
        elementKey: elementKey ?? undefined,
        fieldKey: fieldKey ?? undefined,
        isSection: selectionIsSection,
      };
      const componentType =
        activeTemplate?.document.sections.find(
          (section) => section.id === sectionId,
        )?.type ?? "custom";

      setActiveSelection({
        kind: selectionKind,
        componentType,
        tagName,
        role,
        inputType,
        nodeId,
        sourceFilePath,
        elementKey,
        fieldKey,
        fieldPath,
        className,
        isSection: selectionIsSection,
        computed: computedStyle,
        parentComputed: parentComputedStyle,
        sectionComputed: sectionComputedStyle,
        inspectorOverride,
      });
      setActiveComputedStyleRevision(responseStyleRevision);

      if (sectionId !== search.section) {
        previewSelectionSectionSyncRef.current = sectionId;
        onSearchChange({ section: sectionId });
      }
    };

    window.addEventListener("message", handlePreviewSelection);
    return () => window.removeEventListener("message", handlePreviewSelection);
  }, [
    activeTemplate,
    activeSelection,
    handleSwapThemeFileSiblings,
    handleUpdateThemeFileStyle,
    isSelectionMode,
    onSearchChange,
    previewKey,
    search.section,
    search.viewport,
  ]);

  const syncPreviewSection = useCallback(() => {
    postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
      type: "morph:storefront-preview-set-section",
      sectionId: search.section ?? null,
    });
  }, [search.section]);

  const handleSectionsSearchChange = useCallback(
    (next: Partial<StorefrontThemeEditorSearch>) => {
      if (next.section !== undefined) {
        previewSelectionSectionSyncRef.current = null;
        setActiveSelection(null);
        lastPreviewSelectionRef.current = null;
        postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
          type: "morph:storefront-preview-set-section",
          sectionId: next.section ?? null,
        });
      }
      onSearchChange(next);
    },
    [onSearchChange],
  );

  const syncPreviewSectionOrder = useCallback((sectionIds: string[]) => {
    postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
      type: "morph:storefront-preview-set-section-order",
      sectionIds,
    });
  }, []);

  const syncPreviewSectionProps = useCallback(
    (sectionId: string, props?: PreviewSectionProps, enabled?: boolean) => {
      postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
        type: "morph:storefront-preview-update-section-props",
        sectionId,
        props,
        enabled,
      });
    },
    [],
  );

  const handleSectionPropsChange = useCallback(
    (sectionId: string, nextProps: Record<string, unknown>) => {
      // 1. Instant 0ms visual sync to iframe canvas
      const previewProps = parsePreviewSectionProps(nextProps);
      if (previewProps) syncPreviewSectionProps(sectionId, previewProps);

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
      pendingPropsMapRef.current.set(key, { sectionId, props: mergedProps });

      const timer = setTimeout(async () => {
        pendingPropsTimersRef.current.delete(key);
        const pending = pendingPropsMapRef.current.get(key);
        pendingPropsMapRef.current.delete(key);
        if (!pending) return;

        await enqueueTemplateMutation(templateId, (gen) =>
          updatePropsMutation.mutateAsync({
            sectionId: pending.sectionId,
            props: pending.props,
            expectedDraftGeneration: gen,
          }),
        );
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

  const handleSwapSectionArrayItems = useCallback(
    async (
      sectionId: string,
      draggedFieldPath: string,
      targetFieldPath: string,
    ) => {
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
        }
      } catch {
        restoreSelectionAndProps();
      }
    },
    [
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

  const handleSectionToggleEnabled = useCallback(
    async (sectionId: string, enabled: boolean) => {
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

      await enqueueTemplateMutation(templateId, (gen) =>
        updatePropsMutation.mutateAsync({
          sectionId,
          props: mergedProps,
          expectedDraftGeneration: gen,
        }),
      );
    },
    [
      activeTemplate,
      enqueueTemplateMutation,
      syncPreviewSectionProps,
      updatePropsMutation,
    ],
  );

  const handleReorderSections = useCallback(
    async (sectionIds: string[]) => {
      if (!activeTemplate) return;
      const templateId = activeTemplate.id;
      // 1. Flush any pending props before reordering
      await flushTemplatePendingProps(templateId);

      // 2. Queue reorder mutation with atomic generation CAS
      return enqueueTemplateMutation(templateId, async (gen) => {
        return reorderStorefrontThemeSections({
          data: {
            storefrontId: context.storefront.id,
            themeId: context.theme.id,
            templateId,
            sectionIds,
            expectedDraftGeneration: gen,
          },
        });
      });
    },
    [
      activeTemplate,
      context.storefront.id,
      context.theme.id,
      enqueueTemplateMutation,
      flushTemplatePendingProps,
    ],
  );

  useEffect(() => {
    if (!previewKey) return;
    if (previewSelectionSectionSyncRef.current === search.section) {
      previewSelectionSectionSyncRef.current = null;
      return;
    }
    syncPreviewSection();
  }, [previewKey, search.section, syncPreviewSection]);

  const syncPreviewSelectionMode = useCallback(() => {
    postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
      type: "morph:storefront-preview-set-selection-mode",
      enabled: isSelectionMode,
    });
  }, [isSelectionMode]);

  const handleSwitchToDesign = useCallback(() => {
    setEditorMode("design");
    if (isCommentMode) return;

    for (const message of createSelectionRestoreMessages(
      isSelectionMode,
      lastPreviewSelectionRef.current,
    )) {
      postEditorToPreviewMessage(previewIframeRef.current?.contentWindow, {
        ...message,
      });
    }
  }, [isCommentMode, isSelectionMode]);

  useEffect(() => {
    if (!previewKey) return;
    syncPreviewSelectionMode();
  }, [previewKey, syncPreviewSelectionMode]);

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
      const message = event.data;
      if (
        event.origin !== window.location.origin ||
        event.source !== previewIframeRef.current?.contentWindow ||
        typeof message !== "object" ||
        message === null ||
        !("type" in message) ||
        message.type !== "morph:storefront-preview-wheel" ||
        !("deltaY" in message) ||
        typeof message.deltaY !== "number" ||
        !Number.isFinite(message.deltaY) ||
        !("deltaMode" in message) ||
        typeof message.deltaMode !== "number" ||
        !("ctrlKey" in message) ||
        typeof message.ctrlKey !== "boolean" ||
        !("clientX" in message) ||
        typeof message.clientX !== "number" ||
        !("clientY" in message) ||
        typeof message.clientY !== "number"
      ) {
        return;
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
  }, [previewKey, scheduleCanvasScroll, scheduleCanvasTransform]);

  useEffect(() => {
    if (!previewKey) return;

    const handlePreviewCanvasGesture = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (
        event.origin !== window.location.origin ||
        event.source !== previewIframeRef.current?.contentWindow ||
        typeof message !== "object" ||
        message === null ||
        !("type" in message)
      ) {
        return;
      }

      if (message.type === "morph:storefront-preview-reset-canvas") {
        resetCanvas();
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
  }, [beginCanvasPan, endCanvasPan, moveCanvasPan, previewKey, resetCanvas]);

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
    <div className="grid h-svh min-h-0 grid-rows-[3.5rem_minmax(0,1fr)] bg-background">
      <header className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b bg-component px-3 lg:px-4">
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
        <div className="flex items-center gap-2">
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
              className="hidden items-center gap-0.5 lg:flex"
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
            <div className="flex items-center gap-0.5 lg:hidden">
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
              onClick={handleOpenSelectedCode}
            >
              <Code2 className="size-3.5" />
              <span>Code</span>
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-1 justify-self-end">
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

            return (
              <span
                className={cn(
                  "mr-2 hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex",
                  hasError && "text-destructive font-medium",
                )}
                title={firstThemeError}
              >
                {isSaving ? (
                  <LoaderCircle className="size-3.5 animate-spin text-primary" />
                ) : hasError ? (
                  <CircleAlert className="size-3.5 text-destructive" />
                ) : (
                  <CircleCheck className="size-3.5" />
                )}
                {publishMutation.isPending
                  ? "Publishing…"
                  : isSaving
                    ? "Saving…"
                    : hasError
                      ? firstThemeError
                        ? `Save failed: ${firstThemeError.slice(0, 30)}…`
                        : "Save failed"
                      : hasUnpublishedChanges
                        ? "Unpublished changes"
                        : "All changes saved"}
              </span>
            );
          })()}
          <Button variant="ghost" size="icon" disabled aria-label="Undo">
            <Undo2 />
          </Button>
          <Button variant="ghost" size="icon" disabled aria-label="Redo">
            <Redo2 />
          </Button>
          {activeBuildPreview && (
            <Button
              type="button"
              variant={previewMode === "build" ? "toolbarActive" : "ghost"}
              size="xs"
              className="gap-1 px-2.5 text-xs font-medium max-sm:hidden"
              onClick={() =>
                setPreviewMode((prev) => (prev === "build" ? "live" : "build"))
              }
              title={
                previewMode === "build"
                  ? "Switch to Live Preview"
                  : "View compiled Build Preview"
              }
            >
              <Layers className="size-3.5" />
              <span>
                {previewMode === "build" ? "Build Preview" : "View Build"}
              </span>
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={isBuildPending || themeFiles.length === 0}
            className="gap-1.5 max-sm:hidden"
            onClick={handleBuildPreview}
            title={
              themeFiles.length === 0
                ? "Initialize starter theme files in Code Workspace before building"
                : "Compile and bundle theme into immutable R2 preview build"
            }
          >
            {isBuildPending ? (
              <LoaderCircle className="size-3.5 animate-spin text-primary" />
            ) : (
              <Play className="size-3.5" />
            )}
            <span>{isBuildPending ? "Building…" : "Build Preview"}</span>
          </Button>

          <Button
            type="button"
            size="xs"
            disabled={
              !hasUnpublishedChanges ||
              draftSaveState !== "idle" ||
              Object.values(themeFileSaveStatus).some((s) => s === "saving") ||
              Object.values(themeFileSaveErrors).length > 0 ||
              monacoDirtyFiles.length > 0 ||
              useThemeWorkspaceStore
                .getState()
                .hasUnsavedEdits(workspaceScope) ||
              useThemeWorkspaceStore
                .getState()
                .hasActiveConflictsOrErrors(workspaceScope) ||
              publishMutation.isPending
            }
            onClick={handlePublish}
          >
            Publish
          </Button>
        </div>
      </header>

      <EditorModeSurface
        active={editorMode === "code"}
        className="flex-1 overflow-hidden"
      >
        <EditorCodeWorkspace
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
          onDirtyFilesChange={setMonacoDirtyFiles}
          onSaveFile={handleUnifiedSaveFile}
        />
      </EditorModeSurface>

      <EditorModeSurface
        active={editorMode === "design"}
        className="flex-1 overflow-hidden bg-muted/40 max-md:flex-col"
      >
        <EditorSectionsPanel
          style={{ width: `${leftPanelWidth}px` }}
          context={context}
          search={search}
          onSearchChange={handleSectionsSearchChange}
          onSectionOrderChange={syncPreviewSectionOrder}
          onSaveStateChange={setDraftSaveState}
          onReorderSections={handleReorderSections}
          onToggleSectionEnabled={handleSectionToggleEnabled}
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
          onPointerDown={handleLeftPanelResizePointerDown}
          onPointerMove={handleLeftPanelResizePointerMove}
          onPointerUp={finishLeftPanelResize}
          onPointerCancel={finishLeftPanelResize}
          onDoubleClick={() => {
            setLeftPanelWidth(DEFAULT_LEFT_PANEL_WIDTH);
            try {
              document.cookie = `morph:editor-left-panel-width=${DEFAULT_LEFT_PANEL_WIDTH}; path=/; max-age=31536000; SameSite=Lax`;
              localStorage.setItem(
                "morph:editor-left-panel-width",
                String(DEFAULT_LEFT_PANEL_WIDTH),
              );
            } catch {}
          }}
          className="group relative z-30 flex w-2 -ml-1 cursor-col-resize touch-none select-none items-center justify-center outline-none transition-colors hover:bg-primary/10 active:bg-primary/20 max-md:hidden"
          title="Drag to resize sections panel (Double-click to reset)"
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
                {previewMode === "build" && activeBuildPreview ? (
                  <div className="flex size-full flex-col">
                    <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="size-3" />
                          Immutable Build
                        </span>
                        <span className="font-mono text-[11px]">
                          {activeBuildPreview.id.slice(0, 8)}
                        </span>
                        <span>·</span>
                        <span>
                          {activeBuildPreview.compilerId} v
                          {activeBuildPreview.compilerVersion}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="h-6 text-[11px]"
                        onClick={() => setPreviewMode("live")}
                      >
                        Back to Live
                      </Button>
                    </div>
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
                      <div className="flex size-full flex-1 flex-col items-center justify-center p-8 text-center bg-stone-50 text-stone-700">
                        <p className="font-medium text-sm">
                          Preview Token Required
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                          Theme build succeeded, but preview capability token is
                          missing. Please ensure THEME_PREVIEW_SECRET is
                          configured.
                        </p>
                      </div>
                    )}
                  </div>
                ) : previewUrl ? (
                  <iframe
                    ref={previewIframeRef}
                    key={previewKey}
                    src={previewUrl}
                    title={`${activeTemplate?.name ?? context.theme.name} storefront preview`}
                    sandbox="allow-same-origin allow-scripts"
                    referrerPolicy="same-origin"
                    scrolling="no"
                    className="block size-full border-0 bg-stone-50"
                    onLoad={() => {
                      syncPreviewViewportHeight();
                      syncPreviewSection();
                      syncPreviewSelectionMode();
                      postEditorToPreviewMessage(
                        previewIframeRef.current?.contentWindow,
                        { type: "morph:storefront-preview-request-size" },
                      );
                    }}
                  />
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
          </div>

          <EditorControls
            context={context}
            search={search}
            onSearchChange={onSearchChange}
            isSelectionMode={isSelectionMode}
            onSelectionModeChange={(enabled) => {
              autoEnabledSelectionForStylesRef.current = false;
              setIsSelectionMode(enabled);
              if (enabled && isCommentMode) {
                handleExitCommentMode();
              }
            }}
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
          onPointerDown={handleRightPanelResizePointerDown}
          onPointerMove={handleRightPanelResizePointerMove}
          onPointerUp={finishRightPanelResize}
          onPointerCancel={finishRightPanelResize}
          onDoubleClick={() => {
            setRightPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH);
            try {
              document.cookie = `morph:editor-right-panel-width=${DEFAULT_RIGHT_PANEL_WIDTH}; path=/; max-age=31536000; SameSite=Lax`;
              localStorage.setItem(
                "morph:editor-right-panel-width",
                String(DEFAULT_RIGHT_PANEL_WIDTH),
              );
            } catch {}
          }}
          className="group relative z-30 flex w-2 -mr-1 cursor-col-resize touch-none select-none items-center justify-center outline-none transition-colors hover:bg-primary/10 active:bg-primary/20 max-md:hidden"
          title="Drag to resize assistant panel (Double-click to reset)"
        >
          <div className="h-8 w-1 rounded-full bg-border group-hover:bg-primary group-active:bg-primary transition-colors" />
        </div>

        <EditorAssistantPanel
          style={{ width: `${rightPanelWidth}px` }}
          context={context}
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
          selection={activeSelection}
          activeComputedStyleRevision={activeComputedStyleRevision}
          activeViewport={search.viewport}
          onUpdateThemeFileStyle={handleUpdateThemeFileStyle}
          onPreviewSelectionStyle={previewSelectionStyle}
          onPreviewSelectionField={previewSelectionField}
          onSectionPropsChange={handleSectionPropsChange}
          onJumpToCode={handleJumpToCode}
          onTabChange={setAssistantPanelTab}
        />

        <EditorSmallScreenNotice />
      </EditorModeSurface>
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

function EditorControls({
  context,
  search,
  onSearchChange,
  isSelectionMode,
  onSelectionModeChange,
  isCommentMode,
  onCommentModeChange,
  onRefresh,
}: {
  context: StorefrontThemeEditorDTO;
  search: StorefrontThemeEditorSearch;
  onSearchChange: (next: Partial<StorefrontThemeEditorSearch>) => void;
  isSelectionMode: boolean;
  onSelectionModeChange: (enabled: boolean) => void;
  isCommentMode: boolean;
  onCommentModeChange: (enabled: boolean) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-40 flex justify-center px-3">
      <EditorToolbar
        aria-label="Storefront canvas controls"
        className="pointer-events-auto"
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
          onRefresh={onRefresh}
        />
      </EditorToolbar>
    </div>
  );
}
