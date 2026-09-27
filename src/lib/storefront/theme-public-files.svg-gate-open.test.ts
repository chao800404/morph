// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  checkThemePublicFiles,
  checkThemePublicPath,
  describeThemePublicProblem,
  THEME_PUBLIC_ACCEPT,
  THEME_PUBLIC_LIMITS,
} from "./theme-public-files";

/**
 * The contract with the SVG gate open. Nothing at runtime can open it
 * (`theme-public-svg-gate.ts`); this file replaces the module, so what it
 * checks is what lifting the gate would turn on.
 */
vi.mock("./theme-public-svg-gate", () => ({
  themePublicSvgGate: () => "open",
}));

describe("public/ with the SVG gate open", () => {
  it("serves an SVG path as image/svg+xml, and still not a compressed one", () => {
    expect(checkThemePublicPath("public/icons/logo.svg")).toEqual({
      ok: true,
      urlPath: "/icons/logo.svg",
      mimeType: "image/svg+xml",
    });
    expect(checkThemePublicPath("public/logo.SVG")).toMatchObject({ ok: true });
    expect(checkThemePublicPath("public/logo.svgz")).toEqual({
      ok: false,
      reason: "unsupported-format",
    });
    // Every other rule still applies to it.
    expect(checkThemePublicPath("public/assets/logo.svg")).toEqual({
      ok: false,
      reason: "reserved-prefix",
    });
  });

  it("offers .svg in the picker and names it among the formats", () => {
    expect(THEME_PUBLIC_ACCEPT.split(",")).toContain(".svg");
    expect(describeThemePublicProblem("unsupported-format")).toContain("SVG");
  });

  it("holds an SVG to its own size limit, below the general one", () => {
    const over = THEME_PUBLIC_LIMITS.maxSvgBytes + 1;
    expect(over).toBeLessThan(THEME_PUBLIC_LIMITS.maxFileBytes);
    expect(
      checkThemePublicFiles([
        { path: "public/logo.svg", size: over },
        { path: "public/hero.png", size: over },
      ]),
    ).toEqual({
      ok: false,
      problems: [{ path: "public/logo.svg", reason: "svg-too-large" }],
    });
  });
});
