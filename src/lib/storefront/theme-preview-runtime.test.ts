import { describe, expect, it } from "vitest";
import {
  defaultPreviewRuntimeForNewTheme,
  deploymentThemePreviewRuntime,
  FIRST_STARTER_VERSION_RECORDING_START_PREVIEW,
  recordedThemePreviewRuntime,
  resolveThemePreviewRuntime,
  themeFrameworkAllowsPreviewRuntime,
} from "./theme-preview-runtime";

describe("the Live Preview runtime a Theme is served with", () => {
  // recorded × MORPH_THEME_PREVIEW_RUNTIME. A record wins; no record is
  // exactly the deployment-wide rule every Theme had before (R-0, R1).
  it.each([
    ["start", "start", { runtime: "start", source: "theme" }],
    ["start", undefined, { runtime: "start", source: "theme" }],
    ["client", "start", { runtime: "client", source: "theme" }],
    ["client", undefined, { runtime: "client", source: "theme" }],
    [null, "start", { runtime: "start", source: "deployment" }],
    [null, undefined, { runtime: "client", source: "deployment" }],
  ] as const)(
    "recorded %s, deployment %s",
    (recorded, deploymentEnvValue, expected) => {
      expect(
        resolveThemePreviewRuntime({ recorded, deploymentEnvValue }),
      ).toEqual(expected);
    },
  );

  it("reads the deployment exactly as before: only `start` is Start", () => {
    for (const value of [undefined, "", "client", "START", " start", "1"]) {
      expect(deploymentThemePreviewRuntime(value)).toBe("client");
    }
    expect(deploymentThemePreviewRuntime("start")).toBe("start");
  });

  it("reads a stored value that names no runtime as none recorded", () => {
    expect(recordedThemePreviewRuntime("server")).toBeNull();
    expect(recordedThemePreviewRuntime("")).toBeNull();
    expect(
      resolveThemePreviewRuntime({
        recorded: "server",
        deploymentEnvValue: undefined,
      }),
    ).toEqual({ runtime: "client", source: "deployment" });
  });

  it("lets only TanStack Start record the full Start preview", () => {
    expect(themeFrameworkAllowsPreviewRuntime(null, "start")).toBe(true);
    expect(themeFrameworkAllowsPreviewRuntime("tanstack-start", "start")).toBe(
      true,
    );
    expect(themeFrameworkAllowsPreviewRuntime("astro", "start")).toBe(false);
    expect(themeFrameworkAllowsPreviewRuntime("unknown", "start")).toBe(false);
    expect(themeFrameworkAllowsPreviewRuntime("astro", "client")).toBe(true);
  });
});

describe("what a new Theme records", () => {
  it("records nothing from Starter 29, the current one", () => {
    expect(defaultPreviewRuntimeForNewTheme(29)).toBeNull();
  });

  it("records start from Starter 30 on", () => {
    expect(FIRST_STARTER_VERSION_RECORDING_START_PREVIEW).toBe(30);
    expect(defaultPreviewRuntimeForNewTheme(30)).toBe("start");
    expect(defaultPreviewRuntimeForNewTheme(31)).toBe("start");
  });
});
