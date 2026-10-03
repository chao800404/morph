// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import {
  START_PREVIEW_ADDRESS_PROBE_PATH,
  START_PREVIEW_ID_HEADER,
} from "../service/preview-address-probe";

import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";

import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import {
  isBinaryWorkspaceFile,
  planThemeSandboxWorkspace,
  unplannedWorkspaceFiles,
  type ThemePreviewRuntime,
} from "./theme-sandbox-workspace";
import {
  previewOutboundRefusal,
  THEME_PREVIEW_START_CLIENT_PATH,
  THEME_PREVIEW_START_CONTENT_ORIGIN,
  THEME_PREVIEW_START_WORKER_PATH,
  themePreviewStartClientSource,
  themePreviewStartWorkerSource,
} from "./theme-preview-start-runtime";
import { refuseThemeWorkspacePath } from "./theme-workspace-path";

const plan = (
  previewRuntime?: ThemePreviewRuntime,
  mode: "build" | "preview-server" = "preview-server",
) => {
  const result = planThemeSandboxWorkspace({
    files: STARTER_THEME_FILES as never,
    entry: "src/routes/index.tsx",
    buildId: "start-preview-test",
    approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
    mode,
    ...(previewRuntime ? { previewRuntime } : {}),
  });
  if (!result.ok) throw new Error(result.errorMessage);
  const files = new Map(
    result.workspaceFiles.flatMap((file) =>
      isBinaryWorkspaceFile(file) ? [] : [[file.path, file.content] as const],
    ),
  );
  return { result, files };
};

describe("a Start Live Preview workspace (prototype)", () => {
  it("keeps validated edits arriving before hydration, then refreshes the existing router", async () => {
    const listeners = new Set<(event: unknown) => void>();
    const timers: (() => void)[] = [];
    const snapshot: Record<string, unknown> = {};
    const updatePreviewContent = vi.fn((id: string, props: unknown) => {
      snapshot[id] = props;
    });
    const invalidate = vi.fn(async () => {});
    const browser: Record<string, unknown> = {
      addEventListener: (_type: string, listener: (event: unknown) => void) =>
        listeners.add(listener),
      removeEventListener: (
        _type: string,
        listener: (event: unknown) => void,
      ) => listeners.delete(listener),
    };
    const loadBridge = vi.fn(async () => {});
    const source = themePreviewStartClientSource()
      .replace(/^import .*;\n/, "")
      .replace('import("/src/morph/preview-content.ts")', "contentPromise")
      .replace('import("/src/morph/preview-bridge.ts")', "loadBridge()");
    const execution = runInNewContext(`(async () => { ${source} })()`, {
      window: browser,
      document: { readyState: "complete" },
      performance: { now: () => 0 },
      setTimeout: (callback: () => void) => timers.push(callback),
      requestAnimationFrame: (callback: () => void) => callback(),
      documentPreviewRuntimeChannel: () => ({}),
      parseEditorToPreviewWindowEvent: (event: {
        trusted?: boolean;
        data: unknown;
      }) => (event.trusted ? event.data : null),
      contentPromise: Promise.resolve({ updatePreviewContent }),
      loadBridge,
    }) as Promise<void>;
    const message = {
      type: "morph:storefront-preview-update-section-props",
      sectionId: "hero",
      props: { eyebrow: "latest" },
    };
    for (const listener of listeners) {
      listener({ trusted: false, data: message });
      listener({ trusted: true, data: message });
    }
    await Promise.resolve();
    expect(updatePreviewContent).toHaveBeenCalledTimes(1);
    expect(snapshot.hero).toEqual({ eyebrow: "latest" });
    expect(loadBridge).not.toHaveBeenCalled();
    browser.__TSR_ROUTER__ = { invalidate };
    timers.shift()!();
    await execution;
    expect(loadBridge).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ sync: true });
    expect(listeners.size).toBe(0);
  });
  it("answers health without invoking Start or a Theme loader", async () => {
    let calls = 0;
    const sandbox = {
      Request,
      Response,
      URL,
      Headers,
      fetch: globalThis.fetch,
      startEntry: {
        fetch: async () => {
          calls++;
          return new Response("theme");
        },
      },
      entry: undefined as unknown as {
        fetch: (request: Request) => Promise<Response>;
      },
    };
    runInNewContext(
      themePreviewStartWorkerSource("instance-123")
        .replace(
          'import startEntry from "@tanstack/react-start/server-entry";',
          "",
        )
        .replace("export default {", "entry = {"),
      sandbox,
    );
    for (const method of ["GET", "HEAD"]) {
      const response = await sandbox.entry.fetch(
        new Request(
          `https://preview.example${START_PREVIEW_ADDRESS_PROBE_PATH}`,
          { method },
        ),
      );
      expect(response.status).toBe(204);
      expect(response.headers.get(START_PREVIEW_ID_HEADER)).toBe(
        "instance-123",
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("");
    }
    expect(
      (
        await sandbox.entry.fetch(
          new Request(
            `https://preview.example${START_PREVIEW_ADDRESS_PROBE_PATH}`,
            { method: "POST" },
          ),
        )
      ).status,
    ).toBe(405);
    expect(calls).toBe(0);
    expect(
      await (
        await sandbox.entry.fetch(
          new Request("https://preview.example/api/theme"),
        )
      ).text(),
    ).toBe("theme");
    expect(calls).toBe(1);
  });
  it("leaves today's client-only preview unchanged by default", () => {
    const { files } = plan();
    expect(files.has("/workspace/index.html")).toBe(true);
    expect(files.has("/workspace/__entry.tsx")).toBe(true);
    expect(files.has(`/workspace/${THEME_PREVIEW_START_WORKER_PATH}`)).toBe(
      false,
    );
    const config = files.get("/workspace/vite.config.ts")!;
    expect(config).toContain("const isStartPreview = false;");
    expect(JSON.parse(files.get("/workspace/wrangler.json")!).main).toBe(
      "@tanstack/react-start/server-entry",
    );
  });

  it("serves Start itself at the root, entering through the platform's Worker", () => {
    const { files } = plan("start");
    // Start renders the document; there is no browser-only entry.
    expect(files.has("/workspace/index.html")).toBe(false);
    expect(files.has("/workspace/__entry.tsx")).toBe(false);
    expect(files.get(`/workspace/${THEME_PREVIEW_START_WORKER_PATH}`)).toBe(
      themePreviewStartWorkerSource("start-preview-test"),
    );
    expect(files.get(`/workspace/${THEME_PREVIEW_START_CLIENT_PATH}`)).toBe(
      themePreviewStartClientSource(),
    );
    const wrangler = JSON.parse(files.get("/workspace/wrangler.json")!);
    expect(wrangler.main).toBe(`./${THEME_PREVIEW_START_WORKER_PATH}`);
    // No bindings of any kind are declared for Theme server code.
    expect(Object.keys(wrangler).sort()).toEqual(
      ["compatibility_date", "compatibility_flags", "main", "name"].sort(),
    );
    const config = files.get("/workspace/vite.config.ts")!;
    expect(config).toContain("const isStartPreview = true;");
    expect(config).toContain("base: isStartRuntimeBuild || isStartPreview");
    // The browser-only stand-ins are not what answers in this preview.
    expect(config).toContain("const previewRootPublicPlugin = null;");
  });

  it("ignores the option for a build", () => {
    const { files } = plan("start", "build");
    expect(files.get("/workspace/vite.config.ts")).toContain(
      "const isStartPreview = false;",
    );
    expect(files.has(`/workspace/${THEME_PREVIEW_START_WORKER_PATH}`)).toBe(
      false,
    );
  });

  it("keeps both platform files out of an author's reach", () => {
    for (const path of [
      THEME_PREVIEW_START_WORKER_PATH,
      THEME_PREVIEW_START_CLIENT_PATH,
    ]) {
      expect(refuseThemeWorkspacePath(path)).toMatch(
        /^RESERVED_THEME_BUILD_PATH/,
      );
    }
  });

  it("never prunes the Cloudflare plugin's scratch directory", () => {
    const { result } = plan("start");
    expect(
      unplannedWorkspaceFiles(
        [{ absolutePath: "/workspace/.wrangler/tmp/x.js", type: "file" }],
        result.workspaceFiles,
      ),
    ).toEqual([]);
  });

  it("tells Theme server code to read content from an origin only the entry answers", () => {
    const source = themePreviewStartWorkerSource();
    expect(THEME_PREVIEW_START_CONTENT_ORIGIN.endsWith(".invalid")).toBe(true);
    expect(source).toContain(
      'headers.set("x-morph-content-origin", CONTENT_ORIGIN)',
    );
    expect(source).toContain(
      'import startEntry from "@tanstack/react-start/server-entry"',
    );
  });
});

describe("previewOutboundRefusal", () => {
  it.each([
    ["http://127.0.0.1:3000/", "private-address"],
    ["http://10.1.2.3/", "private-address"],
    ["http://172.17.0.1:3000/", "private-address"],
    ["http://192.168.1.1/", "private-address"],
    ["http://169.254.169.254/latest/meta-data", "private-address"],
    ["http://100.64.0.1/", "private-address"],
    ["http://0.0.0.0/", "private-address"],
    ["http://[::1]/", "ipv6-literal"],
    ["http://localhost:5173/", "internal-name"],
    ["http://5173-abc.preview.localhost/", "internal-name"],
    ["http://metadata.google.internal/", "internal-name"],
    ["http://host.docker.internal/", "internal-name"],
    ["http://intranet/", "single-label-name"],
    // The URL parser normalises these spellings to 127.0.0.1 first.
    ["http://2130706433/", "private-address"],
    ["http://0x7f.0.0.1/", "private-address"],
    ["http://127.1/", "private-address"],
    ["file:///etc/passwd", "protocol"],
    ["not a url", "invalid-url"],
  ])("refuses %s", (url, reason) => {
    expect(previewOutboundRefusal(url)).toBe(reason);
  });

  it.each([
    "https://example.com/",
    "https://api.stripe.com/v1",
    "http://8.8.8.8/",
  ])("passes the public host %s", (url) => {
    expect(previewOutboundRefusal(url)).toBeNull();
  });
});
