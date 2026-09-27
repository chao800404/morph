// @vitest-environment node
import { describe, expect, it } from "vitest";

import { checkThemePublicBytes } from "./theme-public-bytes";
import { THEME_PUBLIC_LIMITS } from "./theme-public-files";

/**
 * The byte check every write into public/ makes. It does not consult the SVG
 * gate — the path check does, first — so it is exercised here directly.
 */

const text = (value: string) => new TextEncoder().encode(value);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const CLEAN = text(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><path d="M0 0h4v4z"/></svg>',
);

describe("checkThemePublicBytes", () => {
  it("accepts an SVG validateSvg accepts, as it is", () => {
    expect(checkThemePublicBytes("public/a.svg", CLEAN)).toEqual({ ok: true });
  });

  it("refuses an SVG with validateSvg's reason for the author", () => {
    const script = checkThemePublicBytes(
      "public/a.svg",
      text(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>',
      ),
    );
    expect(script).toEqual({
      ok: false,
      message: expect.stringContaining("This element is not allowed"),
    });
    expect(
      checkThemePublicBytes(
        "public/a.svg",
        text(
          '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://x.test/a.png"/></svg>',
        ),
      ),
    ).toEqual({
      ok: false,
      message: expect.stringContaining("Only references within the same file"),
    });
    expect(checkThemePublicBytes("public/a.svg", PNG)).toMatchObject({
      ok: false,
    });
  });

  it("refuses an oversized SVG before parsing it", () => {
    const bytes = new Uint8Array(THEME_PUBLIC_LIMITS.maxSvgBytes + 1).fill(
      0x20,
    );
    bytes.set(CLEAN);
    expect(checkThemePublicBytes("public/a.svg", bytes)).toEqual({
      ok: false,
      message: "SVG files are limited to 2 MB.",
    });
    const atLimit = new Uint8Array(THEME_PUBLIC_LIMITS.maxSvgBytes).fill(0x20);
    atLimit.set(CLEAN);
    expect(checkThemePublicBytes("public/a.svg", atLimit)).toEqual({
      ok: true,
    });
  });

  it("holds every other format to its signature", () => {
    expect(checkThemePublicBytes("public/a.png", PNG)).toEqual({ ok: true });
    expect(checkThemePublicBytes("public/a.png", CLEAN)).toEqual({
      ok: false,
      message: "The file's content is not the format its name says.",
    });
  });
});
