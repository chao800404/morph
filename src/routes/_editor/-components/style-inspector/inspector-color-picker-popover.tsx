import {
  cloneElement,
  type MouseEventHandler,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { InspectorGradientPicker } from "./inspector-gradient-picker";

const PICKER_WIDTH = 304;
const PICKER_GAP = 10;
const VIEWPORT_PADDING = 12;

type PickerPosition = {
  left: number;
  top: number;
};

export function resolvePickerPosition({
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
}): PickerPosition {
  const maximumTop = Math.max(
    VIEWPORT_PADDING,
    viewportHeight - pickerHeight - VIEWPORT_PADDING,
  );
  const preferredTop =
    moduleBottom === null ? triggerTop : moduleBottom - pickerHeight;

  return {
    left: Math.max(VIEWPORT_PADDING, inspectorLeft - PICKER_GAP - PICKER_WIDTH),
    top: Math.max(VIEWPORT_PADDING, Math.min(preferredTop, maximumTop)),
  };
}

type PickerTriggerProps = {
  onClick?: MouseEventHandler<HTMLButtonElement>;
  "aria-controls"?: string;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "dialog";
};

type InspectorColorPickerPopoverProps = {
  label: string;
  value: string;
  disabled?: boolean;
  allowGradient?: boolean;
  palette: readonly string[];
  trigger: ReactElement<PickerTriggerProps>;
  onPreview: (value: string) => void;
  onCommit: (value: string) => void;
  onClear?: () => void;
  onDraftChange: (value: string) => void;
};

export function InspectorColorPickerPopover({
  label,
  value,
  disabled = false,
  allowGradient = false,
  palette,
  trigger,
  onPreview,
  onCommit,
  onClear,
  onDraftChange,
}: InspectorColorPickerPopoverProps) {
  const reactId = useId();
  const pickerId = `inspector-color-picker-${reactId.replace(/:/g, "")}`;
  const triggerScopeRef = useRef<HTMLSpanElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PickerPosition | null>(null);
  const [positionReady, setPositionReady] = useState(false);

  const measurePosition = useCallback((): PickerPosition | null => {
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
    const inspectorLeft = inspectorRect?.left ?? triggerRect.left;
    const pickerHeight = pickerRef.current?.getBoundingClientRect().height ?? 0;

    return resolvePickerPosition({
      inspectorLeft,
      moduleBottom: moduleRect?.bottom ?? null,
      triggerTop: triggerRect.top,
      pickerHeight,
      viewportHeight: window.innerHeight,
    });
  }, []);

  const updatePosition = useCallback(() => {
    const nextPosition = measurePosition();
    if (!nextPosition) return;
    setPosition((currentPosition) =>
      currentPosition?.left === nextPosition.left &&
      currentPosition.top === nextPosition.top
        ? currentPosition
        : nextPosition,
    );
    setPositionReady(true);
  }, [measurePosition]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useLayoutEffect(() => {
    if (!open || !pickerRef.current || typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(() => updatePosition());
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
                data-inspector-color-picker-dismiss
                className="fixed inset-0 z-[99] bg-transparent"
                onPointerDown={() => setOpen(false)}
              />
              <div
                ref={pickerRef}
                id={pickerId}
                role="dialog"
                aria-label={`${label} color picker`}
                data-side="left"
                className={`fixed z-[100] max-h-[calc(100dvh-24px)] w-[304px] overflow-y-auto overscroll-contain rounded-xl border border-[#414145] bg-[#19191b] p-3 text-[#f4f2ee] shadow-[0_18px_48px_rgba(0,0,0,0.42)] ${positionReady ? "" : "invisible"}`}
                style={{ left: position.left, top: position.top }}
              >
                <InspectorGradientPicker
                  label={label}
                  value={value}
                  allowGradient={allowGradient}
                  palette={palette}
                  onPreview={onPreview}
                  onCommit={onCommit}
                  onDraftChange={onDraftChange}
                  onClear={onClear}
                />
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
