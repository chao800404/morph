import { cn } from "@/lib/utils";
import {
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
} from "react";
import { Input } from "./input";

type ScrubbableNumberInputProps = {
  value: number;
  min: number;
  max: number;
  /** Pointer scrub and keyboard-arrow increment. Typed values are not snapped. */
  step?: number;
  /** Native number-input validity step. Keep "any" for free typed precision. */
  inputStep?: number | "any";
  scrubPixelsPerStep?: number;
  suffix?: string;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  inputClassName?: string;
  onValuePreview?: (value: number) => void;
  onValueChange: (value: number) => void;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const precisionForStep = (step: number) => {
  const decimal = String(step).split(".")[1];
  return decimal?.length ?? 0;
};

export function ScrubbableNumberInput({
  value,
  min,
  max,
  step = 1,
  inputStep = "any",
  scrubPixelsPerStep = 4,
  suffix,
  disabled = false,
  ariaLabel,
  className,
  inputClassName,
  onValuePreview,
  onValueChange,
}: ScrubbableNumberInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const draftValueRef = useRef(String(value));
  const isEditingRef = useRef(false);
  const skipNextBlurCommitRef = useRef(false);
  const scrubOriginRef = useRef<{
    pointerId: number;
    lastPointerX: number;
    accumulatedPixels: number;
    value: number;
    nextValue: number;
    moved: boolean;
  } | null>(null);

  const releasePointerLock = () => {
    if (document.pointerLockElement === inputRef.current) {
      document.exitPointerLock?.();
    }
  };

  useEffect(
    () => () => {
      releasePointerLock();
    },
    [],
  );

  useEffect(() => {
    if (isEditingRef.current) return;
    draftValueRef.current = String(value);
    if (inputRef.current) inputRef.current.value = String(value);
  }, [value]);

  const setDraftValue = (nextValue: string) => {
    draftValueRef.current = nextValue;
    if (inputRef.current) inputRef.current.value = nextValue;
  };

  const commitDraft = () => {
    const parsed = Number(draftValueRef.current);
    if (!Number.isFinite(parsed)) {
      setDraftValue(String(value));
      return;
    }

    const nextValue = clamp(parsed, min, max);
    setDraftValue(String(nextValue));
    onValuePreview?.(nextValue);
    onValueChange(nextValue);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setDraftValue(String(value));
      onValuePreview?.(value);
      skipNextBlurCommitRef.current = true;
      isEditingRef.current = false;
      inputRef.current?.blur();
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const parsed = Number(draftValueRef.current);
    const origin = Number.isFinite(parsed) ? parsed : value;
    const direction = event.key === "ArrowUp" ? 1 : -1;
    const precision = precisionForStep(step);
    const nextValue = clamp(
      Number((origin + direction * step).toFixed(precision)),
      min,
      max,
    );
    isEditingRef.current = true;
    setDraftValue(String(nextValue));
    onValuePreview?.(nextValue);
  };

  const handlePointerDown = (event: PointerEvent<HTMLInputElement>) => {
    if (disabled || event.button !== 0) return;
    isEditingRef.current = true;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubOriginRef.current = {
      pointerId: event.pointerId,
      lastPointerX: event.clientX,
      accumulatedPixels: 0,
      value,
      nextValue: value,
      moved: false,
    };

    try {
      const pointerLockRequest = event.currentTarget.requestPointerLock?.();
      if (pointerLockRequest) {
        void pointerLockRequest
          .then(() => {
            if (!scrubOriginRef.current) releasePointerLock();
          })
          .catch(() => {
            // Pointer capture remains the fallback when lock is unavailable.
          });
      }
    } catch {
      // Older browsers may throw synchronously; pointer capture still works.
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLInputElement>) => {
    const origin = scrubOriginRef.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    event.stopPropagation();

    const movementX =
      document.pointerLockElement === event.currentTarget
        ? event.movementX
        : event.clientX - origin.lastPointerX;
    origin.lastPointerX = event.clientX;
    origin.accumulatedPixels += movementX;
    const deltaSteps = Math.round(
      origin.accumulatedPixels / scrubPixelsPerStep,
    );
    if (!origin.moved && deltaSteps === 0) return;

    const precision = precisionForStep(step);
    const nextValue = clamp(
      Number((origin.value + deltaSteps * step).toFixed(precision)),
      min,
      max,
    );
    origin.moved = true;
    origin.nextValue = nextValue;
    setDraftValue(String(nextValue));
    (onValuePreview ?? onValueChange)(nextValue);
  };

  const handlePointerUp = (event: PointerEvent<HTMLInputElement>) => {
    const origin = scrubOriginRef.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    event.stopPropagation();
    scrubOriginRef.current = null;
    releasePointerLock();

    if (origin.moved) {
      onValuePreview?.(origin.nextValue);
      onValueChange(origin.nextValue);
      isEditingRef.current = false;
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const handlePointerCancel = (event: PointerEvent<HTMLInputElement>) => {
    const origin = scrubOriginRef.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    event.stopPropagation();
    scrubOriginRef.current = null;
    releasePointerLock();
    setDraftValue(String(origin.value));
    (onValuePreview ?? onValueChange)(origin.value);
    isEditingRef.current = false;
  };

  return (
    <form
      noValidate
      className={cn("flex items-center tabular-nums", className)}
      onSubmit={handleSubmit}
    >
      <Input
        ref={inputRef}
        variant="bare"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={inputStep}
        disabled={disabled}
        defaultValue={value}
        onFocus={() => {
          isEditingRef.current = true;
        }}
        onChange={(event) => {
          isEditingRef.current = true;
          draftValueRef.current = event.target.value;
          const parsed = Number(event.target.value);
          if (event.target.value.trim() !== "" && Number.isFinite(parsed)) {
            onValuePreview?.(clamp(parsed, min, max));
          }
        }}
        onBlur={() => {
          if (skipNextBlurCommitRef.current) {
            skipNextBlurCommitRef.current = false;
            return;
          }
          commitDraft();
          isEditingRef.current = false;
        }}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        aria-label={ariaLabel}
        title={
          disabled ? undefined : "Drag horizontally to adjust, or click to type"
        }
        className={cn(
          "appearance-none text-center tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:hidden [&::-webkit-outer-spin-button]:hidden",
          disabled
            ? "cursor-not-allowed text-foreground opacity-100"
            : "cursor-ew-resize touch-none",
          inputClassName,
        )}
      />
      {suffix ? <span aria-hidden="true">{suffix}</span> : null}
    </form>
  );
}
