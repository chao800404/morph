// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkThemePublicBytes } from "./theme-public-bytes";
import {
  THEME_PUBLIC_LIMITS,
  THEME_SOURCE_IMAGE_LIMITS,
  checkThemeBinaryPath,
  checkThemePublicFiles,
  checkThemeSourceAssetPath,
  isThemeBinaryPath,
} from "./theme-public-files";
import { readImageDimensions } from "./theme-image-dimensions";
import { declaredPng, solidPng } from "./theme-image.test-support";

// docs/astro-theme-plan.md 5.2.5: binary files under src/ — the public/
// contract's storage and quota, a narrower format list, no SVG, and bounded
// image dimensions.

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

describe("an image's declared dimensions, from its header", () => {
  it("reads PNG", () => {
    expect(readImageDimensions("png", solidPng(33, 21))).toEqual({
      width: 33,
      height: 21,
    });
  });

  it("reads GIF's logical screen", () => {
    const gif = bytes(...ascii("GIF89a"), 0x40, 0x01, 0xf0, 0x00, 0, 0, 0);
    expect(readImageDimensions("gif", gif)).toEqual({ width: 320, height: 240 });
  });

  it("reads JPEG's frame, past the segments before it", () => {
    const jpeg = bytes(
      0xff, 0xd8, // SOI
      0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, // APP0, length 4
      0xff, 0xc0, 0x00, 0x11, 0x08, // SOF0, length 17, precision
      0x01, 0xe0, // height 480
      0x02, 0x80, // width 640
      0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    );
    expect(readImageDimensions("jpg", jpeg)).toEqual({ width: 640, height: 480 });
  });

  it("reads all three WebP encodings", () => {
    const riff = (chunk: string, body: number[]) =>
      bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii(chunk), 0, 0, 0, 0, ...body, ...new Array(16).fill(0));
    // Lossy: frame tag (3), start code, 14-bit width and height.
    const lossy = riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 0x00, 0x04, 0x00, 0x03]);
    expect(readImageDimensions("webp", lossy)).toEqual({ width: 1024, height: 768 });
    // Lossless: signature, then width-1 and height-1 in 14 bits each.
    const w = 99;
    const h = 49;
    const bits = w | (h << 14);
    const lossless = riff("VP8L", [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff]);
    expect(readImageDimensions("webp", lossless)).toEqual({ width: 100, height: 50 });
    // Extended: flags (4), then width-1 and height-1 in 24 bits each.
    const extended = riff("VP8X", [0, 0, 0, 0, 0x1f, 0x03, 0x00, 0x0f, 0x02, 0x00]);
    expect(readImageDimensions("webp", extended)).toEqual({ width: 800, height: 528 });
  });

  it("reads AVIF's largest image item", () => {
    const ispe = (width: number, height: number) => {
      const b = Buffer.alloc(20);
      b.writeUInt32BE(20, 0);
      b.write("ispe", 4, "ascii");
      b.writeUInt32BE(width, 12);
      b.writeUInt32BE(height, 16);
      return [...b];
    };
    const avif = bytes(
      0, 0, 0, 0x18, ...ascii("ftypavif"), ...new Array(12).fill(0),
      ...ispe(64, 64),
      ...ispe(4000, 3000),
      ...new Array(32).fill(0),
    );
    expect(readImageDimensions("avif", avif)).toEqual({ width: 4000, height: 3000 });
  });

  it("answers null rather than guessing", () => {
    expect(readImageDimensions("png", bytes(0x89, 0x50))).toBeNull();
    expect(readImageDimensions("jpg", bytes(0xff, 0xd8, 0x00, 0x00))).toBeNull();
    expect(readImageDimensions("png", declaredPng(0, 10))).toBeNull();
    expect(readImageDimensions("woff2", bytes(...ascii("wOF2")))).toBeNull();
  });
});

describe("a binary file's path under src/", () => {
  it("accepts the narrow list of images and fonts, anywhere in src/", () => {
    for (const [path, mimeType] of [
      ["src/assets/hero.png", "image/png"],
      ["src/content/blog/post/cover.JPG", "image/jpeg"],
      ["src/assets/a.webp", "image/webp"],
      ["src/assets/a.avif", "image/avif"],
      ["src/assets/a.gif", "image/gif"],
      ["src/fonts/inter.woff2", "font/woff2"],
    ] as const) {
      expect(checkThemeSourceAssetPath(path), path).toEqual({ ok: true, mimeType });
    }
  });

  it("refuses SVG there, whatever public/ allows", () => {
    expect(checkThemeSourceAssetPath("src/assets/logo.svg")).toEqual({
      ok: false,
      reason: "source-svg-not-allowed",
    });
    expect(checkThemeSourceAssetPath("src/assets/logo.svgz")).toMatchObject({
      reason: "source-svg-not-allowed",
    });
  });

  it("refuses every other format, video and audio among them", () => {
    for (const path of ["src/a.ico", "src/a.mp4", "src/a.mp3", "src/a.bin", "src/a.json", "src/a"]) {
      expect(checkThemeSourceAssetPath(path), path).toMatchObject({
        ok: false,
        reason: "unsupported-source-format",
      });
    }
  });

  it("keeps the path rules: no traversal, hidden segments, node_modules or other directories", () => {
    expect(checkThemeSourceAssetPath("src/../.morph/x.png")).toMatchObject({ reason: "unsafe-path" });
    expect(checkThemeSourceAssetPath("src/node_modules/x.png")).toMatchObject({ reason: "unsafe-path" });
    expect(checkThemeSourceAssetPath("src/.cache/x.png")).toMatchObject({ reason: "hidden-file" });
    expect(checkThemeSourceAssetPath("src//x.png")).toMatchObject({ reason: "unsafe-path" });
    for (const path of [".wrangler/x.png", ".morph/x.png", "x.png", "assets/x.png"]) {
      expect(isThemeBinaryPath(path), path).toBe(false);
      expect(checkThemeBinaryPath(path)).toMatchObject({ reason: "not-binary-location" });
    }
  });
});

describe("the binary quota, public/ and src/ together", () => {
  it("counts both directories against one file limit and one total", () => {
    const half = Array.from({ length: THEME_PUBLIC_LIMITS.maxFiles / 2 }, (_, i) => ({
      path: `public/p${i}.png`,
      size: 1,
    }));
    const otherHalf = half.map((file) => ({ ...file, path: file.path.replace("public/p", "src/s") }));
    expect(checkThemePublicFiles([...half, ...otherHalf]).ok).toBe(true);
    expect(
      checkThemePublicFiles([...half, ...otherHalf, { path: "src/one-more.png", size: 1 }]),
    ).toMatchObject({ ok: false, problems: [expect.objectContaining({ reason: "too-many-files" })] });

    const total = THEME_PUBLIC_LIMITS.maxTotalBytes;
    expect(
      checkThemePublicFiles([
        { path: "public/a.png", size: total / 2 },
        { path: "src/b.png", size: total / 2 + 1 },
      ]),
    ).toMatchObject({ ok: false });
  });

  it("checks no route against a src/ file", () => {
    expect(checkThemePublicFiles([{ path: "src/about.png", size: 1 }], ["/about.png"]).ok).toBe(true);
    expect(checkThemePublicFiles([{ path: "public/about.png", size: 1 }], ["/about.png"]).ok).toBe(false);
  });
});

describe("a src/ image's bytes", () => {
  const { maxDimension, maxPixels } = THEME_SOURCE_IMAGE_LIMITS;

  it("are admitted within the dimension and pixel limits", () => {
    expect(checkThemePublicBytes("src/a.png", solidPng(8, 8))).toEqual({ ok: true });
    expect(checkThemePublicBytes("src/a.png", declaredPng(maxDimension, 2000))).toEqual({ ok: true });
  });

  it("are refused beyond them, by what the header declares", () => {
    expect(checkThemePublicBytes("src/a.png", declaredPng(maxDimension + 1, 10))).toMatchObject({
      ok: false,
      message: expect.stringContaining(`${maxDimension} pixels a side`),
    });
    const side = Math.ceil(Math.sqrt(maxPixels + 1));
    expect(checkThemePublicBytes("src/a.png", declaredPng(side, side))).toMatchObject({
      ok: false,
      message: expect.stringContaining("megapixels"),
    });
  });

  it("are refused when the dimensions cannot be read, or the format is not the name's", () => {
    const signatureOnly = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    expect(checkThemePublicBytes("src/a.png", signatureOnly)).toMatchObject({
      ok: false,
      message: expect.stringContaining("dimensions could not be read"),
    });
    expect(checkThemePublicBytes("src/a.jpg", solidPng(4, 4))).toMatchObject({
      ok: false,
      message: expect.stringContaining("not the format"),
    });
  });

  it("leaves public/ images to the public/ rules, as before", () => {
    expect(checkThemePublicBytes("public/a.png", declaredPng(maxDimension + 1, 10))).toEqual({ ok: true });
  });

  it("checks a font by its signature only", () => {
    expect(checkThemePublicBytes("src/fonts/a.woff2", bytes(...ascii("wOF2"), 0, 0))).toEqual({ ok: true });
  });
});
