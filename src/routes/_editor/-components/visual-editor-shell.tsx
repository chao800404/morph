import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  AppWindow,
  CircleCheck,
  Code2,
  ExternalLink,
  LoaderCircle,
  Minus,
  Monitor,
  MousePointer2,
  Plus,
  Redo2,
  RefreshCw,
  Smartphone,
  Tablet,
  Undo2,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { EditorAssistantPanel } from "./editor-assistant-panel";
import { EditorSectionsPanel } from "./editor-sections-panel";
import { resolveEditorTemplate } from "./editor-template";

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

const MIN_CANVAS_SCALE = 0.5;
const MAX_CANVAS_SCALE = 2;
const CANVAS_SCALE_STEP = 0.1;
const MIN_PREVIEW_WIDTH = 320;
const MAX_PREVIEW_WIDTH = 1920;
const PREVIEW_WIDTH_STEP = 16;

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

function clampPreviewWidth(width: number) {
  return Math.min(MAX_PREVIEW_WIDTH, Math.max(MIN_PREVIEW_WIDTH, width));
}

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
  const [previewWidth, setPreviewWidth] = useState(
    () => search.canvasWidth ?? previewDefaultWidths[search.viewport],
  );
  const activeTemplate = resolveEditorTemplate(context, search);
  const previewUrl = activeTemplate
    ? `/store/${encodeURIComponent(context.storefront.id)}/themes/${encodeURIComponent(context.theme.id)}/preview?templateId=${encodeURIComponent(activeTemplate.id)}&viewportHeight=${previewDefaultHeights[search.viewport]}`
    : null;
  const previewKey = previewUrl ? `${previewUrl}-${previewRevision}` : null;
  const isPreviewLoading =
    previewKey !== null && loadedPreviewKey !== previewKey;
  const previewFrameHeight =
    previewContentSize?.key === previewKey
      ? previewContentSize.height
      : previewDefaultHeights[search.viewport];
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const previewWidthRef = useRef(previewWidth);
  const canvasTransformRef = useRef(canvasTransform);
  const canvasRenderFrameRef = useRef(0);
  const previewWidthRenderFrameRef = useRef(0);
  const panOriginRef = useRef<{
    pointerId: number;
    pointerX: number;
    pointerY: number;
    canvasX: number;
    canvasY: number;
  } | null>(null);
  const resizeOriginRef = useRef<{
    pointerId: number;
    pointerX: number;
    width: number;
  } | null>(null);

  const scheduleCanvasTransform = useCallback(
    (
      action: CanvasTransform | ((current: CanvasTransform) => CanvasTransform),
    ) => {
      const current = canvasTransformRef.current;
      const next = typeof action === "function" ? action(current) : action;
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

  const resetCanvas = useCallback(() => {
    scheduleCanvasTransform(initialCanvasTransform);
  }, [scheduleCanvasTransform]);

  const changeCanvasScale = useCallback(
    (amount: number) => {
      scheduleCanvasTransform((current) => ({
        ...current,
        scale: clampCanvasScale(current.scale + amount),
      }));
    },
    [scheduleCanvasTransform],
  );

  const handleCanvasWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      event.preventDefault();

      const bounds = event.currentTarget.getBoundingClientRect();
      const pointerX = event.clientX - bounds.left - bounds.width / 2;
      const pointerY = event.clientY - bounds.top - bounds.height / 2;

      scheduleCanvasTransform((current) => {
        const zoomFactor = Math.exp(-event.deltaY * 0.001);
        const nextScale = clampCanvasScale(current.scale * zoomFactor);

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

  const handleCanvasPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      panOriginRef.current = {
        pointerId: event.pointerId,
        pointerX: event.clientX,
        pointerY: event.clientY,
        canvasX: canvasTransformRef.current.x,
        canvasY: canvasTransformRef.current.y,
      };
      setIsPanning(true);
    },
    [],
  );

  const handleCanvasPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const origin = panOriginRef.current;
      if (!origin || origin.pointerId !== event.pointerId) {
        return;
      }

      scheduleCanvasTransform((current) => ({
        ...current,
        x: origin.canvasX + event.clientX - origin.pointerX,
        y: origin.canvasY + event.clientY - origin.pointerY,
      }));
    },
    [scheduleCanvasTransform],
  );

  const finishCanvasPan = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (panOriginRef.current?.pointerId !== event.pointerId) {
        return;
      }

      panOriginRef.current = null;
      setIsPanning(false);
    },
    [],
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

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      resizeOriginRef.current = {
        pointerId: event.pointerId,
        pointerX: event.clientX,
        width: previewWidthRef.current,
      };
    },
    [],
  );

  const handleResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const origin = resizeOriginRef.current;
      if (!origin || origin.pointerId !== event.pointerId) return;
      event.stopPropagation();
      updatePreviewWidth(
        origin.width +
          (event.clientX - origin.pointerX) / canvasTransformRef.current.scale,
      );
    },
    [updatePreviewWidth],
  );

  const finishPreviewResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (resizeOriginRef.current?.pointerId !== event.pointerId) return;
      event.stopPropagation();
      resizeOriginRef.current = null;
      onSearchChange({ canvasWidth: previewWidthRef.current });
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
        previewWidthRef.current + direction * step,
      );
      updatePreviewWidth(nextWidth);
      onSearchChange({ canvasWidth: nextWidth });
    },
    [onSearchChange, updatePreviewWidth],
  );

  return (
    <div className="grid h-svh min-h-0 grid-rows-[3.5rem_minmax(0,1fr)] bg-background">
      <header className="flex items-center justify-between border-b bg-component px-3 lg:px-4">
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
        <div className="flex items-center gap-1">
          <span className="mr-2 hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <CircleCheck className="size-3.5" /> Draft unchanged
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
          <Button size="xs" disabled>
            Publish
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[auto_minmax(0,1fr)_auto] bg-muted/40 max-md:grid-cols-1">
        <EditorSectionsPanel
          context={context}
          search={search}
          onSearchChange={onSearchChange}
        />

        <main className="relative flex min-h-0 min-w-0 flex-col overflow-hidden max-md:hidden">
          <div
            className={cn(
              "relative min-h-0 flex-1 touch-none select-none overflow-hidden cursor-grab",
              isPanning && "cursor-grabbing",
            )}
            onWheel={handleCanvasWheel}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={finishCanvasPan}
            onPointerCancel={finishCanvasPan}
            onDoubleClick={resetCanvas}
            onKeyDown={handleCanvasKeyDown}
            role="region"
            tabIndex={0}
            aria-describedby="storefront-canvas-instructions"
            aria-label="Storefront preview canvas. Use the mouse wheel to zoom and drag to pan."
          >
            <span id="storefront-canvas-instructions" className="sr-only">
              Use the mouse wheel or plus and minus keys to zoom. Drag or use
              the arrow keys to pan. Press zero to reset the canvas.
            </span>
            <div
              className={cn("absolute left-1/2 top-12 will-change-transform")}
              style={{
                width: previewWidth,
                transform: `translate3d(calc(-50% + ${canvasTransform.x}px), ${canvasTransform.y}px, 0) scale(${canvasTransform.scale})`,
                transformOrigin: "top center",
              }}
            >
              <div className="absolute bottom-full left-0 mb-2 flex items-center gap-2 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm">
                <Monitor className="size-3.5 text-muted-foreground" />
                <span className="tabular-nums">
                  {previewWidth} × {previewFrameHeight}
                </span>
              </div>
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
                    onLoad={() =>
                      previewIframeRef.current?.contentWindow?.postMessage(
                        { type: "morph:storefront-preview-request-size" },
                        window.location.origin,
                      )
                    }
                  />
                ) : (
                  <div className="flex size-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                    No template is available for preview.
                  </div>
                )}
                {isPreviewLoading && previewUrl ? (
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/90 text-sm text-muted-foreground">
                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                    Loading storefront preview…
                  </div>
                ) : null}
                <div aria-hidden="true" className="absolute inset-0 z-20" />
              </div>
            </div>
            <div
              role="separator"
              aria-label="Resize storefront preview width"
              aria-orientation="vertical"
              aria-valuemin={MIN_PREVIEW_WIDTH}
              aria-valuemax={MAX_PREVIEW_WIDTH}
              aria-valuenow={previewWidth}
              tabIndex={0}
              className="group absolute top-1/2 z-30 flex h-40 w-6 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center outline-none"
              style={{
                left: `clamp(0.75rem, calc(50% + ${canvasTransform.x}px + ${(previewWidth * canvasTransform.scale) / 2}px), calc(100% - 0.75rem))`,
              }}
              onPointerDown={handleResizePointerDown}
              onPointerMove={handleResizePointerMove}
              onPointerUp={finishPreviewResize}
              onPointerCancel={finishPreviewResize}
              onKeyDown={handleResizeKeyDown}
            >
              <span className="h-20 w-1 rounded-full bg-border shadow-sm group-hover:bg-primary group-focus-visible:bg-primary" />
            </div>
          </div>

          <EditorControls
            search={search}
            onSearchChange={(next) => {
              resetCanvas();
              onSearchChange({ ...next, canvasWidth: undefined });
            }}
            onRefresh={() => {
              setPreviewRevision((revision) => revision + 1);
            }}
            canvasScale={canvasTransform.scale}
            onZoomOut={() => changeCanvasScale(-CANVAS_SCALE_STEP)}
            onZoomIn={() => changeCanvasScale(CANVAS_SCALE_STEP)}
            onResetCanvas={resetCanvas}
          />
        </main>

        <EditorAssistantPanel
          context={context}
          search={search}
          onSearchChange={onSearchChange}
        />

        <EditorSmallScreenNotice />
      </div>
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
  search,
  onSearchChange,
  onRefresh,
  canvasScale,
  onZoomOut,
  onZoomIn,
  onResetCanvas,
}: {
  search: StorefrontThemeEditorSearch;
  onSearchChange: (next: Partial<StorefrontThemeEditorSearch>) => void;
  onRefresh: () => void;
  canvasScale: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onResetCanvas: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center px-3">
      <div className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 bg-accent"
          aria-label="Select elements"
        >
          <MousePointer2 />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          disabled
          aria-label="Open preview in new tab"
        >
          <ExternalLink />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          aria-label="Refresh preview"
          onClick={onRefresh}
        >
          <RefreshCw />
        </Button>
        <Separator orientation="vertical" className="mx-1 h-5" />
        {viewportOptions.map(({ value, label, icon: Icon }) => (
          <Button
            key={value}
            variant="ghost"
            size="icon"
            className={cn(
              "shrink-0 shadow-none",
              search.viewport === value && "bg-accent",
            )}
            aria-label={label}
            aria-pressed={search.viewport === value}
            onClick={() => onSearchChange({ viewport: value })}
          >
            <Icon />
          </Button>
        ))}
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          aria-label="Zoom out"
          disabled={canvasScale <= MIN_CANVAS_SCALE}
          onClick={onZoomOut}
        >
          <Minus />
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="min-w-14 shrink-0 tabular-nums"
          aria-label="Reset canvas zoom and position"
          onClick={onResetCanvas}
        >
          {Math.round(canvasScale * 100)}%
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          aria-label="Zoom in"
          disabled={canvasScale >= MAX_CANVAS_SCALE}
          onClick={onZoomIn}
        >
          <Plus />
        </Button>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <div className="flex shrink-0 rounded-md bg-muted p-0.5">
          <span className="rounded-sm bg-background px-3 py-1 text-xs font-medium shadow-xs">
            Store
          </span>
          <button
            type="button"
            disabled
            className="px-3 py-1 text-xs text-muted-foreground disabled:cursor-not-allowed"
          >
            Admin
          </button>
        </div>
        <div className="hidden max-w-48 items-center gap-1.5 truncate px-2 text-xs text-muted-foreground xl:flex">
          <Code2 className="size-3.5 shrink-0" />
          <span className="truncate">/{search.template}</span>
        </div>
      </div>
    </div>
  );
}
