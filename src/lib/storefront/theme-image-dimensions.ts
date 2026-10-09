/**
 * An image's width and height, read from its header — never by decoding it.
 *
 * A file's size says nothing about what it costs to process: a 5 MB PNG can
 * declare 50 000 × 50 000 pixels, and a build that resizes it (Astro's
 * `imageService: "compile"`, through sharp) would decode all of them. So an
 * image the build may process is admitted by its declared dimensions too
 * (`THEME_SOURCE_IMAGE_LIMITS`), and one whose dimensions cannot be read is
 * not admitted at all.
 *
 * Covers the raster formats a Theme may keep under `src/`: PNG, JPEG, GIF,
 * WebP and AVIF. GIF is judged by its logical screen, which bounds what its
 * frames draw.
 */
export type ImageDimensions = Readonly<{ width: number; height: number }>;

const u16be = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;
const u16le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u24le = (b: Uint8Array, at: number) =>
  b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
const u32be = (b: Uint8Array, at: number) =>
  ((b[at]! << 24) >>> 0) + ((b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!);
const tag = (b: Uint8Array, at: number) =>
  String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);

function png(b: Uint8Array): ImageDimensions | null {
  // Signature (8), IHDR length (4), "IHDR" (4), width (4), height (4).
  if (b.length < 24 || tag(b, 12) !== "IHDR") return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function gif(b: Uint8Array): ImageDimensions | null {
  if (b.length < 10) return null;
  return { width: u16le(b, 6), height: u16le(b, 8) };
}

// Start-of-frame markers carry the dimensions; C4 (DHT), C8 (JPG) and CC
// (DAC) share the range but are not frames.
const SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpeg(b: Uint8Array): ImageDimensions | null {
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1]!;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // Markers without a length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (SOF.has(marker)) {
      return { height: u16be(b, at + 5), width: u16be(b, at + 7) };
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = u16be(b, at + 2);
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

function webp(b: Uint8Array): ImageDimensions | null {
  if (b.length < 30) return null;
  const chunk = tag(b, 12);
  if (chunk === "VP8 ") {
    // Lossy: a key frame's start code, then 14-bit width and height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === "VP8X") {
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}

function avif(b: Uint8Array): ImageDimensions | null {
  // Every image item's "ispe" property (version/flags, width, height); the
  // largest is the one that bounds the work. Properties sit in the leading
  // "meta" box, so only the first part of the file is searched.
  let found: ImageDimensions | null = null;
  const end = Math.min(b.length - 16, 64 * 1024);
  for (let at = 4; at < end; at++) {
    if (b[at] !== 0x69 || tag(b, at) !== "ispe") continue;
    const width = u32be(b, at + 8);
    const height = u32be(b, at + 12);
    if (!found || width * height > found.width * found.height) {
      found = { width, height };
    }
  }
  return found;
}

const READERS: Readonly<Record<string, (b: Uint8Array) => ImageDimensions | null>> = {
  png,
  jpg: jpeg,
  jpeg,
  gif,
  webp,
  avif,
};

/** Whether the extension names a raster image this module can measure. */
export function isMeasurableImageExtension(extension: string): boolean {
  return extension in READERS;
}

/** Declared dimensions for the format the extension names; null if unreadable. */
export function readImageDimensions(
  extension: string,
  bytes: Uint8Array,
): ImageDimensions | null {
  const read = READERS[extension.toLowerCase()];
  const dimensions = read ? read(bytes) : null;
  return dimensions && dimensions.width > 0 && dimensions.height > 0
    ? dimensions
    : null;
}
