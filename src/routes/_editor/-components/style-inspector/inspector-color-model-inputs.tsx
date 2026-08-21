import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

export type InspectorRgbaChannels = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export type InspectorHslaChannels = {
  h: number;
  s: number;
  l: number;
  a: number;
};

type ColorModel = "rgb" | "hex" | "hsl";

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

function expandHex(value: string) {
  return value
    .split("")
    .map((character) => `${character}${character}`)
    .join("");
}

export function parseInspectorRgba(
  value: string,
): InspectorRgbaChannels | null {
  const normalized = value.trim();
  const hexMatch = normalized.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6,8})$/i);
  if (hexMatch) {
    const expanded =
      hexMatch[1].length <= 4 ? expandHex(hexMatch[1]) : hexMatch[1];
    const withAlpha = expanded.length === 6 ? `${expanded}ff` : expanded;
    return {
      r: Number.parseInt(withAlpha.slice(0, 2), 16),
      g: Number.parseInt(withAlpha.slice(2, 4), 16),
      b: Number.parseInt(withAlpha.slice(4, 6), 16),
      a: Math.round((Number.parseInt(withAlpha.slice(6, 8), 16) / 255) * 100),
    };
  }

  const rgbMatch = normalized.match(/^rgba?\((.+)\)$/i);
  if (!rgbMatch) return null;
  const parts = rgbMatch[1].split(",").map((part) => part.trim());
  if (parts.length < 3 || parts.length > 4) return null;

  const channels = parts.slice(0, 3).map((part) => {
    const numericValue = Number.parseFloat(part);
    if (!Number.isFinite(numericValue)) return Number.NaN;
    return part.endsWith("%") ? (numericValue / 100) * 255 : numericValue;
  });
  const alphaPart = parts[3] ?? "1";
  const numericAlpha = Number.parseFloat(alphaPart);
  if (channels.some(Number.isNaN) || !Number.isFinite(numericAlpha))
    return null;

  return {
    r: Math.round(clamp(channels[0], 0, 255)),
    g: Math.round(clamp(channels[1], 0, 255)),
    b: Math.round(clamp(channels[2], 0, 255)),
    a: Math.round(
      clamp(
        alphaPart.endsWith("%") ? numericAlpha : numericAlpha * 100,
        0,
        100,
      ),
    ),
  };
}

export function formatInspectorRgba(channels: InspectorRgbaChannels) {
  return `rgba(${channels.r},${channels.g},${channels.b},${channels.a / 100})`;
}

export function formatInspectorHexa(channels: InspectorRgbaChannels) {
  const channelToHex = (channel: number) =>
    Math.round(channel).toString(16).padStart(2, "0");
  return `#${channelToHex(channels.r)}${channelToHex(channels.g)}${channelToHex(channels.b)}${channelToHex((channels.a / 100) * 255)}`.toUpperCase();
}

export function convertInspectorRgbaToHsla(
  channels: InspectorRgbaChannels,
): InspectorHslaChannels {
  const red = clamp(channels.r, 0, 255) / 255;
  const green = clamp(channels.g, 0, 255) / 255;
  const blue = clamp(channels.b, 0, 255) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  let hue = 0;

  if (delta !== 0) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }

  if (hue < 0) hue += 360;
  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

  return {
    h: Math.round(hue),
    s: Math.round(saturation * 100),
    l: Math.round(lightness * 100),
    a: Math.round(clamp(channels.a, 0, 100)),
  };
}

export function convertInspectorHslaToRgba(
  channels: InspectorHslaChannels,
): InspectorRgbaChannels {
  const hue = ((channels.h % 360) + 360) % 360;
  const saturation = clamp(channels.s, 0, 100) / 100;
  const lightness = clamp(channels.l, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (hue < 60) [red, green] = [chroma, secondary];
  else if (hue < 120) [red, green] = [secondary, chroma];
  else if (hue < 180) [green, blue] = [chroma, secondary];
  else if (hue < 240) [green, blue] = [secondary, chroma];
  else if (hue < 300) [red, blue] = [secondary, chroma];
  else [red, blue] = [chroma, secondary];

  return {
    r: Math.round((red + offset) * 255),
    g: Math.round((green + offset) * 255),
    b: Math.round((blue + offset) * 255),
    a: Math.round(clamp(channels.a, 0, 100)),
  };
}

type InspectorColorModelInputsProps = {
  label: string;
  value: InspectorRgbaChannels;
  onPreview: (value: string) => void;
};

export function InspectorColorModelInputs({
  label,
  value,
  onPreview,
}: InspectorColorModelInputsProps) {
  const [model, setModel] = useState<ColorModel>("rgb");
  const [channels, setChannels] = useState(value);
  const [hslChannels, setHslChannels] = useState(() =>
    convertInspectorRgbaToHsla(value),
  );
  const [hexValue, setHexValue] = useState(() => formatInspectorHexa(value));

  useEffect(() => {
    setChannels(value);
    setHslChannels(convertInspectorRgbaToHsla(value));
    setHexValue(formatInspectorHexa(value));
  }, [value]);

  const updateChannel = (channel: keyof InspectorRgbaChannels, raw: string) => {
    const numericValue = Number.parseFloat(raw);
    if (!Number.isFinite(numericValue)) return;
    const nextChannels = {
      ...channels,
      [channel]: Math.round(
        clamp(numericValue, 0, channel === "a" ? 100 : 255),
      ),
    };
    setChannels(nextChannels);
    setHslChannels(convertInspectorRgbaToHsla(nextChannels));
    setHexValue(formatInspectorHexa(nextChannels));
    onPreview(formatInspectorRgba(nextChannels));
  };

  const updateHslChannel = (
    channel: keyof InspectorHslaChannels,
    raw: string,
  ) => {
    const numericValue = Number.parseFloat(raw);
    if (!Number.isFinite(numericValue)) return;
    const maximum = channel === "h" ? 360 : 100;
    const nextHslChannels = {
      ...hslChannels,
      [channel]: Math.round(clamp(numericValue, 0, maximum)),
    };
    const nextChannels = convertInspectorHslaToRgba(nextHslChannels);
    setHslChannels(nextHslChannels);
    setChannels(nextChannels);
    setHexValue(formatInspectorHexa(nextChannels));
    onPreview(formatInspectorRgba(nextChannels));
  };

  return (
    <div className="mt-3 flex h-8 min-w-0 items-stretch gap-1.5">
      <label className="relative w-[68px] shrink-0">
        <span className="sr-only">{label} color model</span>
        <select
          aria-label={`${label} color model`}
          value={model}
          onChange={(event) =>
            setModel(event.currentTarget.value as ColorModel)
          }
          className="h-full w-full appearance-none rounded-md border border-[#3b3b40] bg-[#242426] pl-2 pr-6 text-xs font-medium text-[#f4f2ee] outline-none focus:border-[#5b8def] focus:ring-2 focus:ring-[#5b8def]/40"
        >
          <option value="rgb">RGB</option>
          <option value="hex">HEX</option>
          <option value="hsl">HSL</option>
        </select>
        <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-[#aaa8ae]" />
      </label>

      {model === "rgb" ? (
        <div className="grid min-w-0 flex-1 grid-cols-[repeat(3,minmax(0,1fr))_1.35fr] overflow-hidden rounded-md border border-[#3b3b40] bg-[#222225]">
          {(["r", "g", "b", "a"] as const).map((channel) => (
            <label
              key={channel}
              className="relative min-w-0 border-l border-[#3b3b40] first:border-l-0"
            >
              <span className="sr-only">{`${label} ${channel.toUpperCase()}`}</span>
              <input
                type="number"
                min={0}
                max={channel === "a" ? 100 : 255}
                value={channels[channel]}
                aria-label={`${label} ${channel.toUpperCase()}`}
                onChange={(event) =>
                  updateChannel(channel, event.currentTarget.value)
                }
                className={`h-full w-full min-w-0 bg-transparent px-1 text-center text-xs font-medium tabular-nums text-[#f4f2ee] outline-none focus:bg-[#303034] ${channel === "a" ? "pr-4" : ""}`}
              />
              {channel === "a" ? (
                <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-[#8f8d94]">
                  %
                </span>
              ) : null}
            </label>
          ))}
        </div>
      ) : model === "hsl" ? (
        <div className="grid min-w-0 flex-1 grid-cols-[1.15fr_repeat(3,minmax(0,1fr))] overflow-hidden rounded-md border border-[#3b3b40] bg-[#222225]">
          {(["h", "s", "l", "a"] as const).map((channel) => (
            <label
              key={channel}
              className="relative min-w-0 border-l border-[#3b3b40] first:border-l-0"
            >
              <span className="sr-only">{`${label} ${channel.toUpperCase()}`}</span>
              <input
                type="number"
                min={0}
                max={channel === "h" ? 360 : 100}
                value={hslChannels[channel]}
                aria-label={`${label} ${channel.toUpperCase()}`}
                onChange={(event) =>
                  updateHslChannel(channel, event.currentTarget.value)
                }
                className={`h-full w-full min-w-0 bg-transparent px-1 text-center text-xs font-medium tabular-nums text-[#f4f2ee] outline-none focus:bg-[#303034] ${channel !== "h" ? "pr-3" : ""}`}
              />
              {channel !== "h" ? (
                <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-[#8f8d94]">
                  %
                </span>
              ) : null}
            </label>
          ))}
        </div>
      ) : (
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{label} HEXA</span>
          <input
            type="text"
            value={hexValue}
            aria-label={`${label} HEXA`}
            onChange={(event) => {
              const nextHexValue = event.currentTarget.value.toUpperCase();
              setHexValue(nextHexValue);
              const nextChannels = parseInspectorRgba(nextHexValue);
              if (!nextChannels) return;
              setChannels(nextChannels);
              setHslChannels(convertInspectorRgbaToHsla(nextChannels));
              onPreview(formatInspectorRgba(nextChannels));
            }}
            className="h-full w-full rounded-md border border-[#3b3b40] bg-[#222225] px-2 text-center font-mono text-xs font-medium uppercase tabular-nums text-[#f4f2ee] outline-none focus:border-[#5b8def] focus:ring-2 focus:ring-[#5b8def]/40"
          />
        </label>
      )}
    </div>
  );
}
