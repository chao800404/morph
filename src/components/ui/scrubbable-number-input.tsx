import { cn } from "@/lib/utils";
import {
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Input } from "./input";

type ScrubbableNumberInputProps = {
  value: number;
  min: number;
  max: number;
  step?: number;
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
  scrubPixelsPerStep = 4,
  suffix,
  disabled = false,
  ariaLabel,
  className,
  inputClassName,
  onValuePreview,
  onValueChange,
}: ScrubbableNumberInputProps) {
  const [draftValue, setDraftValue] = useState(() => String(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const scrubOriginRef = useRef<{
    pointerId: number;
    pointerX: number;
    value: number;
    nextValue: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => setDraftValue(String(value)), [value]);

  const commitDraft = () => {
    const parsed = Number(draftValue);
    if (!Number.isFinite(parsed)) {
      setDraftValue(String(value));
      return;
    }

    const nextValue = clamp(parsed, min, max);
    setDraftValue(String(nextValue));
    onValueChange(nextValue);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    commitDraft();
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setDraftValue(String(value));
    inputRef.current?.blur();
  };

  const handlePointerDown = (event: PointerEvent<HTMLInputElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubOriginRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      value,
      nextValue: value,
      moved: false,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLInputElement>) => {
    const origin = scrubOriginRef.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    event.stopPropagation();

    const deltaSteps = Math.round(
      (event.clientX - origin.pointerX) / scrubPixelsPerStep,
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

    if (origin.moved) {
      onValueChange(origin.nextValue);
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
    setDraftValue(String(origin.value));
    (onValuePreview ?? onValueChange)(origin.value);
  };

  return (
    <form
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
        step={step}
        disabled={disabled}
        value={draftValue}
        onChange={(event) => setDraftValue(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        aria-label={ariaLabel}
        title={disabled ? undefined : "Drag horizontally to adjust, or click to type"}
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
