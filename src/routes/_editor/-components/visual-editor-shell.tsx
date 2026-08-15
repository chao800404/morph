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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  AppWindow,
  CircleCheck,
  CircleAlert,
  ChevronDown,
  ExternalLink,
  LoaderCircle,
  Monitor,
  MousePointer2,
  Redo2,
  Smartphone,
  Tablet,
  Undo2,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  publishStorefrontThemeTemplate,
  updateStorefrontThemeSectionProps,
} from "@/server/storefront/storefront-themes.serverFn";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";
import { EditorAssistantPanel } from "./editor-assistant-panel";
import { EditorPathNavigator } from "./editor-path-navigator";
import { EditorSectionsPanel } from "./editor-sections-panel";
import { resolveEditorTemplate } from "./editor-template";
import {
  EditorToolbar,
  EditorToolbarGroup,
  EditorToolbarMode,
} from "./editor-toolbar";

type EditorShellProps = {
  context: StorefrontThemeEditorDTO;
  search: StorefrontThemeEditorSearch;
  onSearchChange: (next: Partial<StorefrontThemeEditorSearch>) => void;
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

type CanvasTransform = {
  x: number;
  y: number;
  scale: number;
};

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
  const [previewContentSize, setPreviewContentSize] = useState<{
    key: string;
    height: number;
  } | null>(null);
  const [canvasTransform, setCanvasTransform] = useState<CanvasTransform>(
    initialCanvasTransform,
  );
  const [isPanning, setIsPanning] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [draftSaveState, setDraftSaveState] = useState<
    "idle" | "saving" | "error"
  >("idle");
  const [previewWidth, setPreviewWidth] = useState(
    () => search.canvasWidth ?? previewDefaultWidths[search.viewport],
  );
  const activeTemplate = resolveEditorTemplate(context, search);
  const queryClient = useQueryClient();
  const hasUnpublishedChanges = Boolean(
    activeTemplate?.draftRevisionId &&
    activeTemplate.draftRevisionId !== activeTemplate.publishedRevisionId,
  );
  const publishMutation = useMutation({
    mutationFn: () => {
      if (!activeTemplate) throw new Error("No active template");
      return publishStorefrontThemeTemplate({
        data: {
          storefrontId: context.storefront.id,
          themeId: context.theme.id,
          templateId: activeTemplate.id,
        },
      });
    },
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: storefrontThemeQueries.detail(
          context.storefront.id,
          context.theme.id,
        ).queryKey,
      });
      toast.success(result.message);
    },
    onError: () => toast.error("Failed to publish theme"),
  });
  const updatePropsMutation = useMutation({
    mutationFn: (variables: {
      sectionId: string;
      props: Record<string, unknown>;
    }) => {
      if (!activeTemplate) throw new Error("No active template");
      return updateStorefrontThemeSectionProps({
        data: {
          storefrontId: context.storefront.id,
          themeId: context.theme.id,
          templateId: activeTemplate.id,
          sectionId: variables.sectionId,
          props: variables.props,
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

  const handleSectionPropsChange = useCallback(
    (sectionId: string, nextProps: Record<string, unknown>) => {
      updatePropsMutation.mutate({ sectionId, props: nextProps });
    },
    [updatePropsMutation],
  );

  const handleSectionToggleEnabled = useCallback(
    (sectionId: string, enabled: boolean) => {
      updatePropsMutation.mutate({ sectionId, props: { enabled } });
    },
    [updatePropsMutation],
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
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const previewWidthRef = useRef(previewWidth);
  const previewFrameHeightRef = useRef(previewFrameHeight);
  const canvasTransformRef = useRef(canvasTransform);
  const canvasRenderFrameRef = useRef(0);
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

  const scheduleCanvasTransform = useCallback(
    (
      action: CanvasTransform | ((current: CanvasTransform) => CanvasTransform),
    ) => {
      const current = canvasTransformRef.current;
      const requested = typeof action === "function" ? action(current) : action;
      const viewportHeight =
        canvasViewportRef.current?.getBoundingClientRect().height ?? 0;
      const next =
        viewportHeight > 0
          ? clampCanvasTransform(
              requested,
              viewportHeight,
              previewFrameHeightRef.current,
            )
          : requested;
      if (
        next.x === current.x &&
        next.y === current.y &&
        next.scale === current.scale
      ) {
        return;
      }

      canvasTransformRef.current = next;
      if (canvasRenderFrameRef.current !== 0) return;

      canvasRenderFrameRef.current = requestAnimationFrame(() => {
        canvasRenderFrameRef.current = 0;
        setCanvasTransform(canvasTransformRef.current);
      });
    },
    [],
  );

  useEffect(() => {
    previewFrameHeightRef.current = previewFrameHeight;
    scheduleCanvasTransform((current) => current);
  }, [previewFrameHeight, scheduleCanvasTransform]);

  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      scheduleCanvasTransform((current) => current);
    });
    observer.observe(viewport);

    return () => observer.disconnect();
  }, [scheduleCanvasTransform]);

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
    },
    [],
  );

  useEffect(() => {
    if (!previewKey) return;

    const handlePreviewMessage = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== previewIframeRef.current?.contentWindow ||
        typeof event.data !== "object" ||
        event.data === null ||
        !("type" in event.data) ||
        event.data.type !== "morph:storefront-preview-size" ||
        !("height" in event.data) ||
        typeof event.data.height !== "number" ||
        !Number.isFinite(event.data.height)
      ) {
        return;
      }

      const height = Math.min(
        30_000,
        Math.max(320, Math.ceil(event.data.height)),
      );
      setPreviewContentSize((current) =>
        current?.key === previewKey && Math.abs(current.height - height) < 1
          ? current
          : { key: previewKey, height },
      );
      setLoadedPreviewKey(previewKey);
    };

    window.addEventListener("message", handlePreviewMessage);
    previewIframeRef.current?.contentWindow?.postMessage(
      { type: "morph:storefront-preview-request-size" },
      window.location.origin,
    );
    return () => window.removeEventListener("message", handlePreviewMessage);
  }, [previewKey]);

  useEffect(() => {
    if (!previewKey) return;

    const handlePreviewSelection = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (
        event.origin !== window.location.origin ||
        event.source !== previewIframeRef.current?.contentWindow ||
        typeof message !== "object" ||
        message === null ||
        !("type" in message) ||
        message.type !== "morph:storefront-preview-select-section" ||
        !("sectionId" in message) ||
        typeof message.sectionId !== "string" ||
        message.sectionId.length > 100
      ) {
        return;
      }
      const sectionId = message.sectionId;
      if (!isSelectionMode) return;
      if (
        !activeTemplate?.document.sections.some(
          (section) => section.id === sectionId,
        )
      ) {
        return;
      }

      onSearchChange({ section: sectionId });
    };

    window.addEventListener("message", handlePreviewSelection);
    return () => window.removeEventListener("message", handlePreviewSelection);
  }, [activeTemplate, isSelectionMode, onSearchChange, previewKey]);

  const syncPreviewSection = useCallback(() => {
    previewIframeRef.current?.contentWindow?.postMessage(
      {
        type: "morph:storefront-preview-set-section",
        sectionId: search.section ?? null,
      },
      window.location.origin,
    );
  }, [search.section]);

  const syncPreviewSectionOrder = useCallback((sectionIds: string[]) => {
    previewIframeRef.current?.contentWindow?.postMessage(
      {
        type: "morph:storefront-preview-set-section-order",
        sectionIds,
      },
      window.location.origin,
    );
  }, []);

  useEffect(() => {
    if (!previewKey) return;
    syncPreviewSection();
  }, [previewKey, syncPreviewSection]);

  const syncPreviewSelectionMode = useCallback(() => {
    previewIframeRef.current?.contentWindow?.postMessage(
      {
        type: "morph:storefront-preview-set-selection-mode",
        enabled: isSelectionMode,
      },
      window.location.origin,
    );
  }, [isSelectionMode]);

  useEffect(() => {
    if (!previewKey) return;
    syncPreviewSelectionMode();
  }, [previewKey, syncPreviewSelectionMode]);

  const syncPreviewViewportHeight = useCallback(() => {
    previewIframeRef.current?.contentWindow?.postMessage(
      {
        type: "morph:storefront-preview-set-viewport-height",
        height: previewDefaultHeights[search.viewport],
      },
      window.location.origin,
    );
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
      setIsPanning(true);
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
      setIsPanning(false);
    },
    [],
  );

  const handleCanvasWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();

      const viewport = canvasViewportRef.current;
      if (!viewport) return;

      const bounds = viewport.getBoundingClientRect();
      const deltaY = normalizeWheelDelta(
        event.deltaY,
        event.deltaMode,
        bounds.height,
      );

      if (!event.ctrlKey) {
        scheduleCanvasTransform((current) => ({
          ...current,
          y: current.y - deltaY,
        }));
        return;
      }

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
    [scheduleCanvasTransform],
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
      const viewportBounds = viewport.getBoundingClientRect();
      const frameBounds = frame.getBoundingClientRect();
      const deltaY = normalizeWheelDelta(
        message.deltaY,
        message.deltaMode,
        viewportBounds.height,
      );

      if (!message.ctrlKey) {
        scheduleCanvasTransform((current) => ({
          ...current,
          y: current.y - deltaY,
        }));
        return;
      }

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
  }, [previewKey, scheduleCanvasTransform]);

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
      if (event.button !== 0) {
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      beginCanvasPan("canvas", event.pointerId, event.clientX, event.clientY);
    },
    [beginCanvasPan],
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
    (width: number) => {
      const nextWidth = clampPreviewWidth(Math.round(width));
      updatePreviewWidth(nextWidth);
      onSearchChange({
        canvasWidth: nextWidth,
        viewport: resolvePreviewViewport(nextWidth),
      });
    },
    [onSearchChange, updatePreviewWidth],
  );

  const handleResizePointerDown = useCallback(
    (edge: "left" | "right") =>
      (event: ReactPointerEvent<HTMLDivElement>) => {
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
      onSearchChange({
        canvasWidth: previewWidthRef.current,
        viewport: resolvePreviewViewport(previewWidthRef.current),
      });
    },
    [onSearchChange],
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
      resetCanvas();
      onSearchChange({ viewport, canvasWidth: undefined });
    },
    [onSearchChange, resetCanvas],
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
                variant={search.viewport === value ? "toolbarActive" : "ghost"}
                size="icon"
                className="size-7"
                aria-label={`${label} preview, ${previewDefaultWidths[value]} pixels`}
                aria-pressed={search.viewport === value}
                title={`${label} · ${previewDefaultWidths[value]} px`}
                onClick={() => handleViewportChange(value)}
              >
                <Icon className="size-3.5" />
              </Button>
            ))}
          </div>
          <div className="lg:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 gap-1.5 px-2 shadow-none"
                  aria-label={`Preview device: ${search.viewport}`}
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
          </div>
        </div>
        <div className="flex items-center gap-1 justify-self-end">
          <span
            className={cn(
              "mr-2 hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex",
              draftSaveState === "error" && "text-destructive",
            )}
          >
            {draftSaveState === "saving" || publishMutation.isPending ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : draftSaveState === "error" ? (
              <CircleAlert className="size-3.5" />
            ) : (
              <CircleCheck className="size-3.5" />
            )}
            {publishMutation.isPending
              ? "Publishing…"
              : draftSaveState === "saving"
                ? "Saving…"
                : draftSaveState === "error"
                  ? "Save failed"
                  : hasUnpublishedChanges
                    ? "Unpublished changes"
                    : "No changes"}
          </span>
          <Button variant="ghost" size="icon" disabled aria-label="Undo">
            <Undo2 />
          </Button>
          <Button variant="ghost" size="icon" disabled aria-label="Redo">
            <Redo2 />
          </Button>
          <Button
            variant="outline"
            size="xs"
            disabled
            className="max-sm:hidden"
          >
            Preview
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={
              !hasUnpublishedChanges ||
              draftSaveState !== "idle" ||
              publishMutation.isPending
            }
            onClick={() => publishMutation.mutate()}
          >
            Publish
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-muted/40 max-md:flex-col">
        <EditorSectionsPanel
          style={{ width: `${leftPanelWidth}px` }}
          context={context}
          search={search}
          onSearchChange={onSearchChange}
          onSectionOrderChange={syncPreviewSectionOrder}
          onSaveStateChange={setDraftSaveState}
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
            className={cn(
              "relative min-h-0 flex-1 touch-none select-none overflow-hidden cursor-grab",
              isPanning && "cursor-grabbing",
            )}
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
          >
            <span id="storefront-canvas-instructions" className="sr-only">
              Use the mouse wheel to scroll the storefront. Hold Control while
              using the mouse wheel, or use plus and minus keys, to zoom. Drag
              or use the arrow keys to pan. Press zero to reset the canvas.
            </span>
            <div
              className={cn(
                "absolute left-1/2 top-12 will-change-transform transition-opacity duration-200",
                isPreviewLoading && previewUrl
                  ? "pointer-events-none opacity-0"
                  : "opacity-100",
              )}
              style={{
                width: previewWidth,
                transform: `translate3d(calc(-50% + ${canvasTransform.x}px), ${canvasTransform.y}px, 0) scale(${canvasTransform.scale})`,
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
                    sandbox="allow-same-origin allow-scripts"
                    referrerPolicy="same-origin"
                    scrolling="no"
                    className="block size-full border-0 bg-stone-50"
                    onLoad={() => {
                      syncPreviewViewportHeight();
                      syncPreviewSection();
                      syncPreviewSelectionMode();
                      previewIframeRef.current?.contentWindow?.postMessage(
                        { type: "morph:storefront-preview-request-size" },
                        window.location.origin,
                      );
                    }}
                  />
                ) : (
                  <div className="flex size-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                    No template is available for preview.
                  </div>
                )}
              </div>
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
                />
                <div
                  role="separator"
                  aria-label="Resize storefront preview from its left edge"
                  aria-orientation="vertical"
                  aria-valuemin={MIN_PREVIEW_WIDTH}
                  aria-valuemax={MAX_PREVIEW_WIDTH}
                  aria-valuenow={previewWidth}
                  tabIndex={0}
                  className="group absolute z-30 flex w-5 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center outline-none"
                  style={{
                    left: `clamp(0.75rem, calc(50% + ${canvasTransform.x}px - ${(previewWidth * canvasTransform.scale) / 2}px), calc(100% - 0.75rem))`,
                    top: `max(0px, calc(3rem ${canvasTransform.y >= 0 ? "+" : "-"} ${Math.abs(canvasTransform.y)}px))`,
                    bottom: `max(0px, calc(100% - 3rem - ${canvasTransform.y + previewFrameHeight * canvasTransform.scale}px))`,
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
                  className="group absolute z-30 flex w-5 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center outline-none"
                  style={{
                    left: `clamp(0.75rem, calc(50% + ${canvasTransform.x}px + ${(previewWidth * canvasTransform.scale) / 2}px), calc(100% - 0.75rem))`,
                    top: `max(0px, calc(3rem ${canvasTransform.y >= 0 ? "+" : "-"} ${Math.abs(canvasTransform.y)}px))`,
                    bottom: `max(0px, calc(100% - 3rem - ${canvasTransform.y + previewFrameHeight * canvasTransform.scale}px))`,
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
            )}
          </div>

          <EditorControls
            context={context}
            search={search}
            onSearchChange={onSearchChange}
            isSelectionMode={isSelectionMode}
            onSelectionModeChange={setIsSelectionMode}
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
          onSectionPropsChange={handleSectionPropsChange}
          onSectionToggleEnabled={handleSectionToggleEnabled}
        />

        <EditorSmallScreenNotice />
      </div>
    </div>
  );
}

function PreviewSizeControl({
  width,
  height,
  canvasTransform,
  onWidthPreview,
  onWidthChange,
}: {
  width: number;
  height: number;
  canvasTransform: CanvasTransform;
  onWidthPreview: (width: number) => void;
  onWidthChange: (width: number) => void;
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
      className="absolute z-30 flex h-7 -translate-y-full items-center gap-2 rounded-md border bg-popover px-2 text-xs text-popover-foreground shadow-sm outline-none focus-within:ring-2 focus-within:ring-ring hover:bg-accent"
      style={{
        left: `max(0.5rem, calc(50% + ${canvasTransform.x}px - ${(width * canvasTransform.scale) / 2}px))`,
        top: `calc(3rem + ${canvasTransform.y}px - 0.5rem)`,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <SizeIcon className="size-3.5 text-muted-foreground" />
      <ScrubbableNumberInput
        value={width}
        min={MIN_PREVIEW_WIDTH}
        max={MAX_PREVIEW_WIDTH}
        step={1}
        scrubPixelsPerStep={canvasTransform.scale}
        suffix={` × ${height}`}
        ariaLabel="Preview width in pixels"
        onValuePreview={(value) => onWidthPreview(clampPreviewWidth(value))}
        onValueChange={(value) => onWidthChange(clampPreviewWidth(value))}
        inputClassName="h-5 w-[4ch] rounded-sm border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-1"
      />
      <span className="sr-only capitalize">{viewport} breakpoint</span>
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
  onRefresh,
}: {
  context: StorefrontThemeEditorDTO;
  search: StorefrontThemeEditorSearch;
  onSearchChange: (next: Partial<StorefrontThemeEditorSearch>) => void;
  isSelectionMode: boolean;
  onSelectionModeChange: (enabled: boolean) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center px-3">
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
