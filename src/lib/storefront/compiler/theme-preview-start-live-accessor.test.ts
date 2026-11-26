// @vitest-environment node
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { nativeWrapperConfigSource } from "@/lib/storefront/theme-framework/tanstack-start-native-wrapper";

import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import { themePreviewStartClientSource } from "./theme-preview-start-runtime";
import {
  isBinaryWorkspaceFile,
  planThemeSandboxWorkspace,
  type ThemePreviewRuntime,
} from "./theme-sandbox-workspace";

/**
 * Where Starter 32's client loader may read the page's unsaved edits from
 * (`starter-v32-live-preview-overlay.test.ts`): a read-only accessor over the
 * in-page preview content (`livePreviewContentOverlay`), which the Start Live
 * Preview's client installs as `window.__morphLivePreviewContent`, only in a
 * framed document that carries the editor's channel; and a compile-time flag,
 * `__MORPH_START_LIVE_PREVIEW__`, true only in the full Start Live Preview
 * workspace and false in every build Morph runs, so elsewhere the loader's
 * branch is dead code.
 */

async function runClient(options: { framed: boolean; channel: boolean }) {
  const browser: Record<string, unknown> = {
    addEventListener: () => {},
    removeEventListener: () => {},
    __TSR_ROUTER__: { invalidate: async () => {} },
  };
  browser.parent = options.framed ? {} : browser;
  const overlay = vi.fn(() => ({ slots: {}, hiddenSlots: [] }));
  const source = themePreviewStartClientSource()
    .replace(/^import .*;\n/, "")
    .replace('import("/src/morph/preview-content.ts")', "contentPromise")
    .replace('import("/src/morph/preview-bridge.ts")', "loadBridge()");
  await (runInNewContext(`(async () => { ${source} })()`, {
    window: browser,
    document: { readyState: "complete" },
    performance: { now: () => 0 },
    setTimeout: (callback: () => void) => callback(),
    requestAnimationFrame: (callback: () => void) => callback(),
    documentPreviewRuntimeChannel: () => (options.channel ? {} : null),
    parseEditorToPreviewWindowEvent: () => null,
    contentPromise: Promise.resolve({
      updatePreviewContent: () => {},
      livePreviewContentOverlay: overlay,
    }),
    loadBridge: async () => {},
  }) as Promise<void>);
  return { browser, overlay };
}

describe("the Start Live Preview's live content accessor", () => {
  it("is installed in a framed document with the editor's channel, read-only, over the in-page content", async () => {
    const { browser, overlay } = await runClient({ framed: true, channel: true });
    const accessor = browser.__morphLivePreviewContent as {
      overlay: (pathname: string, base: unknown) => unknown;
    };
    expect(accessor).toBeDefined();
    expect(Object.isFrozen(accessor)).toBe(true);
    const base = { slots: {}, hiddenSlots: [] };
    accessor.overlay("/a", base);
    expect(overlay).toHaveBeenCalledWith("/a", base);
    // Neither replaced nor redefined by the page.
    expect(() => {
      "use strict";
      (browser as { __morphLivePreviewContent: unknown }).__morphLivePreviewContent = null;
    }).toThrow();
    expect(browser.__morphLivePreviewContent).toBe(accessor);
  });

  it.each([
    ["a document that is not framed", { framed: false, channel: true }],
    ["a framed document without the editor's channel", { framed: true, channel: false }],
  ])("is not installed in %s", async (_label, options) => {
    const { browser } = await runClient(options);
    expect("__morphLivePreviewContent" in browser).toBe(false);
  });
});

const workspace = (
  mode: "build" | "preview-server",
  previewRuntime?: ThemePreviewRuntime,
) => {
  const result = planThemeSandboxWorkspace({
    files: STARTER_THEME_FILES as never,
    entry: "src/routes/index.tsx",
    buildId: "live-accessor-test",
    approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
    mode,
    ...(previewRuntime ? { previewRuntime } : {}),
  });
  if (!result.ok) throw new Error(result.errorMessage);
  const config = result.workspaceFiles.find(
    (file) => !isBinaryWorkspaceFile(file) && file.path.endsWith("/vite.config.ts"),
  );
  return (config as { content: string }).content;
};

describe("the live preview flag", () => {
  it("is true only in the full Start Live Preview workspace", () => {
    expect(workspace("preview-server", "start")).toContain(
      'define: { __MORPH_START_LIVE_PREVIEW__: "true" }',
    );
    for (const config of [
      workspace("preview-server", "client"),
      workspace("preview-server"),
      workspace("build"),
      workspace("build", "start"),
    ]) {
      expect(config).toContain('define: { __MORPH_START_LIVE_PREVIEW__: "false" }');
    }
  });

  it("is false in a native build, whatever the project's own config says", () => {
    const wrapper = nativeWrapperConfigSource({
      themeConfigPath: "vite.config.ts",
      allowedPackages: [],
    });
    expect(wrapper).toContain('define: { __MORPH_START_LIVE_PREVIEW__: "false" }');
    // Morph's object is the second argument, so it wins over the project's.
    expect(wrapper.indexOf("mergeConfig(own ?? {}, {")).toBeGreaterThan(-1);
  });
});
