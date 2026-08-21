import { CircleOff } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import ColorPicker, {
  type Styles as GradientPickerStyles,
} from "react-best-gradient-color-picker";

import {
  InspectorColorModelInputs,
  parseInspectorRgba,
  type InspectorRgbaChannels,
} from "./inspector-color-model-inputs";
import {
  getInspectorEditablePaintColor,
  updateInspectorEditablePaintColor,
} from "./inspector-gradient-color-utils";
import {
  isGradientPaint,
  isInspectorPaint,
  normalizeInspectorPaint,
} from "./inspector-paint-utils";
import "./inspector-gradient-picker.css";

const FALLBACK_COLOR = "rgba(250,250,249,1)";
const DEFAULT_GRADIENT =
  "linear-gradient(90deg, rgba(28,25,23,1) 0%, rgba(216,208,195,1) 100%)";
const PICKER_CONFIG = {
  barSize: 16,
  crossSize: 16,
  defaultColor: FALLBACK_COLOR,
  defaultGradient: DEFAULT_GRADIENT,
};
const FALLBACK_CHANNELS: InspectorRgbaChannels = {
  r: 250,
  g: 250,
  b: 249,
  a: 100,
};

const MORPH_PICKER_STYLES: GradientPickerStyles = {
  body: { background: "transparent", color: "#f4f2ee" },
  rbgcpCanvasWrapper: { borderRadius: 7, height: 168 },
  rbgcpControlBtnWrapper: { background: "#242426", borderRadius: 6 },
  rbgcpControlBtn: { color: "#a7a5aa", fontSize: 12, fontWeight: 500 },
  rbgcpControlBtnSelected: {
    background: "#3a3a3e",
    color: "#f5f3ef",
    boxShadow: "inset 0 0 0 1px #4b4b51",
  },
  rbgcpControlIcon: { stroke: "#a7a5aa" },
  rbgcpControlIcon2: { fill: "#a7a5aa" },
  rbgcpInput: {
    height: 30,
    borderRadius: 6,
    border: "1px solid #3b3b40",
    background: "#222225",
    color: "#f4f2ee",
    fontSize: 12,
    fontWeight: 500,
  },
  rbgcpInputLabel: { color: "#8f8d94", fontSize: 10, fontWeight: 500 },
  rbgcpControlInput: { color: "#f4f2ee", fontSize: 12 },
  rbgcpHandle: { border: "2px solid #f4f2ee", width: 16, height: 16 },
  rbgcpGradientHandle: {
    border: "2px solid #f4f2ee",
    width: 16,
    height: 16,
  },
  rbgcpCheckered: { borderRadius: 6 },
  rbgcpOpacityOverlay: { borderRadius: 6 },
};

type InspectorGradientPickerProps = {
  label: string;
  value: string;
  allowGradient: boolean;
  palette: readonly string[];
  onPreview: (value: string) => void;
  onCommit: (value: string) => void;
  onDraftChange: (value: string) => void;
  onClear?: () => void;
};

type InspectorPaintMode = "solid" | "gradient";

function resolveClickedPaintMode(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  if (target.closest('[id^="rbgcp-solid-btn"]')) return "solid";
  if (target.closest('[id^="rbgcp-gradient-btn"]')) return "gradient";
  return null;
}

export function InspectorGradientPicker({
  label,
  value,
  allowGradient,
  palette,
  onPreview,
  onCommit,
  onDraftChange,
  onClear,
}: InspectorGradientPickerProps) {
  const reactId = useId();
  const pickerId = reactId.replace(/:/g, "");
  const initialValue = isInspectorPaint(value, allowGradient)
    ? normalizeInspectorPaint(value)
    : FALLBACK_COLOR;
  const [draftValue, setDraftValue] = useState(initialValue);
  const [editableChannels, setEditableChannels] =
    useState<InspectorRgbaChannels>(
      () =>
        parseInspectorRgba(getInspectorEditablePaintColor(initialValue)) ??
        FALLBACK_CHANNELS,
    );
  const draftRef = useRef(initialValue);
  const solidDraftRef = useRef(
    isGradientPaint(initialValue) ? FALLBACK_COLOR : initialValue,
  );
  const gradientDraftRef = useRef(
    isGradientPaint(initialValue) ? initialValue : DEFAULT_GRADIENT,
  );
  const committedRef = useRef(value);
  const pendingPreviewRef = useRef<string | null>(null);
  const previewFrameRef = useRef<number | null>(null);

  const rememberPaintDraft = (nextValue: string) => {
    if (isGradientPaint(nextValue)) gradientDraftRef.current = nextValue;
    else solidDraftRef.current = nextValue;
  };

  const cancelPendingPreview = () => {
    if (previewFrameRef.current !== null) {
      window.cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
    pendingPreviewRef.current = null;
  };

  const applyPreviewPaint = (nextValue: string) => {
    const normalized = normalizeInspectorPaint(nextValue);
    if (!isInspectorPaint(normalized, allowGradient)) return;
    draftRef.current = normalized;
    rememberPaintDraft(normalized);
    setDraftValue(normalized);
    setEditableChannels(
      (currentChannels) =>
        parseInspectorRgba(getInspectorEditablePaintColor(normalized)) ??
        currentChannels,
    );
    onDraftChange(normalized);
    onPreview(normalized);
  };

  const flushPendingPreview = () => {
    if (previewFrameRef.current !== null) {
      window.cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
    const pendingPreview = pendingPreviewRef.current;
    pendingPreviewRef.current = null;
    if (pendingPreview !== null) applyPreviewPaint(pendingPreview);
  };

  const queuePreviewPaint = (nextValue: string) => {
    const normalized = normalizeInspectorPaint(nextValue);
    if (!isInspectorPaint(normalized, allowGradient)) return;
    draftRef.current = normalized;
    rememberPaintDraft(normalized);
    pendingPreviewRef.current = normalized;
    if (previewFrameRef.current !== null) return;
    previewFrameRef.current = window.requestAnimationFrame(() => {
      previewFrameRef.current = null;
      const pendingPreview = pendingPreviewRef.current;
      pendingPreviewRef.current = null;
      if (pendingPreview !== null) applyPreviewPaint(pendingPreview);
    });
  };

  useEffect(
    () => () => {
      if (previewFrameRef.current !== null) {
        window.cancelAnimationFrame(previewFrameRef.current);
      }
    },
    [],
  );

  const commitDraft = () => {
    const nextValue = draftRef.current;
    if (nextValue === committedRef.current) return;
    committedRef.current = nextValue;
    onCommit(nextValue);
  };

  const scheduleCommit = () =>
    queueMicrotask(() => {
      flushPendingPreview();
      commitDraft();
    });

  const updateEditableColor = (nextColor: string) => {
    applyPreviewPaint(
      updateInspectorEditablePaintColor(draftRef.current, nextColor),
    );
  };

  const switchPaintMode = (mode: InspectorPaintMode) => {
    cancelPendingPreview();
    applyPreviewPaint(
      mode === "gradient" ? gradientDraftRef.current : solidDraftRef.current,
    );
  };

  return (
    <div
      className="morph-gradient-picker"
      onPointerUpCapture={scheduleCommit}
      onClickCapture={(event) => {
        const mode = resolveClickedPaintMode(event.target);
        if (!mode) {
          scheduleCommit();
          return;
        }

        // The third-party tabs emit their own remembered/default paint. Stop
        // that handler and make Morph's two paint drafts the only mode source.
        event.stopPropagation();
        switchPaintMode(mode);
        scheduleCommit();
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          scheduleCommit();
      }}
      onKeyDownCapture={(event) => {
        if (event.key === "Enter") scheduleCommit();
      }}
    >
      <ColorPicker
        idSuffix={pickerId}
        value={draftValue}
        onChange={queuePreviewPaint}
        width={280}
        height={168}
        disableDarkMode
        hideColorTypeBtns={!allowGradient}
        hideGradientControls={!allowGradient}
        hideEyeDrop
        hideAdvancedSliders
        hideColorGuide
        hideInputType
        hideInputs
        hidePresets
        showHexAlpha
        className="text-xs"
        style={MORPH_PICKER_STYLES}
        locales={{ CONTROLS: { SOLID: "Solid", GRADIENT: "Gradient" } }}
        config={PICKER_CONFIG}
      />
      <InspectorColorModelInputs
        label={label}
        value={editableChannels}
        onPreview={updateEditableColor}
      />
      <div
        className="mt-3 grid grid-cols-9 gap-1.5"
        aria-label={`${label} theme colors`}
      >
        {onClear ? (
          <button
            type="button"
            aria-label={`Remove ${label} color`}
            aria-pressed={!value}
            onClick={() => {
              flushPendingPreview();
              draftRef.current = "";
              committedRef.current = "";
              onDraftChange("");
              onClear();
            }}
            className="flex aspect-square items-center justify-center rounded-md border border-[#3b3b40] bg-[#222225] text-[#aaa8ae] hover:border-[#5a5a60] hover:text-[#f4f2ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b8def] aria-pressed:border-[#7d7d85] aria-pressed:ring-1 aria-pressed:ring-[#7d7d85]"
          >
            <CircleOff className="size-3.5" />
          </button>
        ) : null}
        {palette.map((paletteValue) => {
          const normalizedValue = normalizeInspectorPaint(paletteValue);
          const selected = draftValue === normalizedValue;
          return (
            <button
              key={paletteValue}
              type="button"
              aria-label={`Use theme color ${paletteValue} for ${label}`}
              aria-pressed={selected}
              onClick={() => applyPreviewPaint(paletteValue)}
              className="aspect-square rounded-md border border-[#3b3b40] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b8def] aria-pressed:border-[#d7d4ce] aria-pressed:ring-1 aria-pressed:ring-[#d7d4ce]"
              style={{ background: paletteValue }}
            />
          );
        })}
      </div>
    </div>
  );
}
