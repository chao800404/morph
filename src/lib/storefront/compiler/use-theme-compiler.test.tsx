import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { themeCompilerManager } from "./theme-compiler-manager";
import type { ThemeCompilerFile, ThemeCompilerResult } from "./theme-compiler.types";
import { useThemeCompiler } from "./use-theme-compiler";

const file = (content: string): ThemeCompilerFile[] => [
  { path: "src/Test.tsx", content },
];

const result = (
  css: string,
  overrides: Partial<ThemeCompilerResult> = {},
): ThemeCompilerResult => ({
  success: true,
  inputHash: "hash",
  css,
  diagnostics: [],
  compiledAt: "2026-08-20T00:00:00.000Z",
  ...overrides,
});

describe("useThemeCompiler application ordering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.getElementById("morph-theme-compiled-css")?.remove();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("reports a revision only after its compiled CSS is injected", async () => {
    vi.spyOn(themeCompilerManager, "compile").mockResolvedValue(result(".p-new{}"));
    const onStylesApplied = vi.fn(() => {
      expect(document.getElementById("morph-theme-compiled-css")?.textContent)
        .toBe(".p-new{}");
    });

    renderHook(() =>
      useThemeCompiler(file('className="p-new"'), {
        debounceMs: 120,
        applicationKey: 7,
        onStylesApplied,
      }),
    );

    expect(onStylesApplied).not.toHaveBeenCalled();
    expect(document.getElementById("morph-theme-compiled-css")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    expect(onStylesApplied).toHaveBeenCalledWith({
      files: file('className="p-new"'),
      applicationKey: 7,
      didApplySource: true,
    });
  });

  it("cancels stale revisions and applies only the latest files", async () => {
    vi.spyOn(themeCompilerManager, "compile").mockResolvedValue(result(".latest{}"));
    const onStylesApplied = vi.fn();
    const { rerender } = renderHook(
      ({ files, revision }) =>
        useThemeCompiler(files, {
          debounceMs: 120,
          applicationKey: revision,
          onStylesApplied,
        }),
      {
        initialProps: {
          files: file('className="old"'),
          revision: 1,
        },
      },
    );

    rerender({
      files: file('className="latest"'),
      revision: 2,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    expect(themeCompilerManager.compile).toHaveBeenCalledTimes(1);
    expect(themeCompilerManager.compile).toHaveBeenCalledWith(
      expect.objectContaining({ files: file('className="latest"') }),
    );
    expect(onStylesApplied).toHaveBeenCalledTimes(1);
    expect(onStylesApplied).toHaveBeenCalledWith({
      files: file('className="latest"'),
      applicationKey: 2,
      didApplySource: true,
    });
  });

  it("acknowledges a fallback without applying failed source files", async () => {
    vi.spyOn(themeCompilerManager, "compile").mockRejectedValue(
      new Error("compile failed"),
    );
    vi.spyOn(themeCompilerManager, "getLastKnownGood").mockReturnValue(
      result(".last-known-good{}"),
    );
    const onStylesApplied = vi.fn();

    renderHook(() =>
      useThemeCompiler(file('className="invalid"'), {
        debounceMs: 120,
        applicationKey: 9,
        onStylesApplied,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    expect(document.getElementById("morph-theme-compiled-css")?.textContent)
      .toBe(".last-known-good{}");
    expect(onStylesApplied).toHaveBeenCalledWith({
      files: file('className="invalid"'),
      applicationKey: 9,
      didApplySource: false,
    });
  });
});
