import type { SelectedAsset } from "@/components/asset/asset-tile";
import { AssetLibraryPicker } from "@/components/asset/asset-library-picker";
import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { MouseEventHandler, ReactElement } from "react";

const MEDIA_PICKER_WIDTH = 360;
const MEDIA_PICKER_GAP = 10;
const VIEWPORT_PADDING = 12;

export type MediaPickerPosition = {
  left: number;
  top: number;
};

export function resolveMediaPickerPosition({
  inspectorLeft,
  moduleBottom,
  triggerTop,
  pickerHeight,
  viewportHeight,
}: {
  inspectorLeft: number;
  moduleBottom: number | null;
  triggerTop: number;
  pickerHeight: number;
  viewportHeight: number;
}): MediaPickerPosition {
  const maximumTop = Math.max(
    VIEWPORT_PADDING,
    viewportHeight - pickerHeight - VIEWPORT_PADDING,
  );
  const preferredTop =
    moduleBottom === null ? triggerTop : moduleBottom - pickerHeight;

  return {
    left: Math.max(
      VIEWPORT_PADDING,
      inspectorLeft - MEDIA_PICKER_GAP - MEDIA_PICKER_WIDTH,
    ),
    top: Math.max(VIEWPORT_PADDING, Math.min(preferredTop, maximumTop)),
  };
}

type MediaPickerTriggerProps = {
  onClick?: MouseEventHandler<HTMLButtonElement>;
  "aria-controls"?: string;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "dialog";
};

export function EditorMediaPickerPopover({
  label,
  assetType,
  selectedIds,
  disabled = false,
  trigger,
  onSelect,
}: {
  label: string;
  assetType: "image" | "video";
  selectedIds: string[];
  disabled?: boolean;
  trigger: ReactElement<MediaPickerTriggerProps>;
  onSelect: (asset: SelectedAsset) => void;
}) {
  const reactId = useId();
  const pickerId = `editor-media-picker-${reactId.replace(/:/g, "")}`;
  const triggerScopeRef = useRef<HTMLSpanElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MediaPickerPosition | null>(null);
  const [positionReady, setPositionReady] = useState(false);

  const measurePosition = useCallback((): MediaPickerPosition | null => {
    const triggerElement = triggerScopeRef.current?.querySelector("button");
    if (!triggerElement) return null;

    const triggerRect = triggerElement.getBoundingClientRect();
    const inspectorPanel = triggerElement.closest(
      "[data-editor-inspector-panel]",
    );
    const inspectorRect = inspectorPanel?.getBoundingClientRect();
    const moduleRect = triggerElement
      .closest("[data-inspector-module]")
      ?.getBoundingClientRect();

    return resolveMediaPickerPosition({
      inspectorLeft: inspectorRect?.left ?? triggerRect.left,
      moduleBottom: moduleRect?.bottom ?? null,
      triggerTop: triggerRect.top,
      pickerHeight: pickerRef.current?.getBoundingClientRect().height ?? 0,
      viewportHeight: window.innerHeight,
    });
  }, []);

  const updatePosition = useCallback(() => {
    const nextPosition = measurePosition();
    if (!nextPosition) return;
    setPosition((current) =>
      current?.left === nextPosition.left && current.top === nextPosition.top
        ? current
        : nextPosition,
    );
    setPositionReady(true);
  }, [measurePosition]);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  useLayoutEffect(() => {
    if (!open || !pickerRef.current || typeof ResizeObserver === "undefined") {
      return;
    }
    const resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(pickerRef.current);
    return () => resizeObserver.disconnect();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const handleViewportChange = () => updatePosition();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        pickerRef.current?.contains(target) ||
        triggerScopeRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerScopeRef.current?.querySelector("button")?.focus();
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, updatePosition]);

  const triggerWithPopoverBehavior = cloneElement(trigger, {
    "aria-controls": open ? pickerId : undefined,
    "aria-expanded": open,
    "aria-haspopup": "dialog",
    onClick: (event) => {
      trigger.props.onClick?.(event);
      if (event.defaultPrevented || disabled) return;
      if (open) {
        setOpen(false);
        return;
      }
      const nextPosition = measurePosition();
      if (!nextPosition) return;
      setPositionReady(false);
      setPosition(nextPosition);
      setOpen(true);
    },
  });

  return (
    <>
      <span ref={triggerScopeRef} className="contents">
        {triggerWithPopoverBehavior}
      </span>
      {open && position && typeof document !== "undefined"
        ? createPortal(
            <>
              <div
                aria-hidden="true"
                data-editor-media-picker-dismiss
                className="fixed inset-0 z-[99] bg-transparent"
                onPointerDown={() => setOpen(false)}
              />
              <div
                ref={pickerRef}
                id={pickerId}
                role="dialog"
                aria-label={`${label} asset library`}
                data-side="left"
                className={`fixed z-[100] max-h-[calc(100dvh-24px)] w-[360px] overflow-y-auto overscroll-contain rounded-xl border border-[#414145] bg-[#19191b] p-3 text-[#f4f2ee] shadow-[0_18px_48px_rgba(0,0,0,0.42)] ${positionReady ? "" : "invisible"}`}
                style={{ left: position.left, top: position.top }}
              >
                <div className="mb-2 text-xs font-medium">{label} assets</div>
                <AssetLibraryPicker
                  assetType={assetType}
                  disabled={disabled}
                  paginationLayout="stacked"
                  selectedIds={selectedIds}
                  onToggle={(asset) => {
                    onSelect(asset);
                    setOpen(false);
                  }}
                />
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
