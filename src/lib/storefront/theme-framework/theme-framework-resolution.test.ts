// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  THEME_FRAMEWORKS,
  THEME_FRAMEWORK_IDS,
  ThemeFrameworkUnavailableError,
  UNRECORDED_THEME_FRAMEWORK,
  resolveThemeFramework,
  themeFramework,
} from ".";
import { tanstackStartFramework } from "./tanstack-start.framework";

const here = path.dirname(new URL(import.meta.url).pathname);

// docs/astro-theme-plan.md, A1: an adapter is chosen by the framework a build
// or a preview records, and a framework without one is refused, never served
// by another.
describe("choosing a framework adapter by what is recorded", () => {
  it("reads a record that names no framework as TanStack Start", () => {
    expect(UNRECORDED_THEME_FRAMEWORK).toBe("tanstack-start");
    for (const recorded of [null, undefined]) {
      const resolved = resolveThemeFramework(recorded);
      expect(resolved.ok && resolved.framework).toBe(tanstackStartFramework);
    }
    expect(themeFramework(null)).toBe(tanstackStartFramework);
  });

  it("serves a recorded TanStack Start through its adapter", () => {
    const resolved = resolveThemeFramework("tanstack-start");
    expect(resolved.ok && resolved.framework).toBe(tanstackStartFramework);
  });

  it("knows astro as an id and has no adapter for it", () => {
    expect(THEME_FRAMEWORK_IDS).toContain("astro");
    expect(THEME_FRAMEWORKS.map((framework) => framework.id)).not.toContain(
      "astro",
    );
  });

  it("refuses astro with a typed diagnostic, never with Start", () => {
    const resolved = resolveThemeFramework("astro");
    expect(resolved).toEqual({
      ok: false,
      code: "THEME_FRAMEWORK_UNAVAILABLE",
      framework: "astro",
      message: expect.stringMatching(/^THEME_FRAMEWORK_UNAVAILABLE: /),
    });

    let refusal: unknown;
    try {
      themeFramework("astro");
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(ThemeFrameworkUnavailableError);
    expect(refusal).toMatchObject({
      code: "THEME_FRAMEWORK_UNAVAILABLE",
      framework: "astro",
    });
  });

  it("refuses a value that is no framework id, including an empty one", () => {
    for (const recorded of ["react-router", "", "Tanstack-Start"]) {
      const resolved = resolveThemeFramework(recorded);
      expect(resolved.ok).toBe(false);
      expect(!resolved.ok && resolved.code).toBe("THEME_FRAMEWORK_UNKNOWN");
    }
  });

  it("has an id for every adapter", () => {
    for (const framework of THEME_FRAMEWORKS) {
      expect(THEME_FRAMEWORK_IDS).toContain(framework.id);
    }
  });
});

describe("the shared Cloudflare native build", () => {
  // Shared by every framework that builds natively (Start today; Astro and
  // React Router after it), so it names none of them and none of their files.
  it("holds nothing of any one framework", () => {
    const source = readFileSync(
      path.join(here, "cloudflare-native-build.ts"),
      "utf8",
    ).replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, "");
    expect(source).not.toMatch(
      /tanstack|react-start|astro|remix|react-router|vite\.config|\.tsx\b/i,
    );
  });
});
