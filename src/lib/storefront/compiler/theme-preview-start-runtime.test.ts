// @vitest-environment node
import { describe, expect, it } from "vitest";

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

const plan = (previewRuntime?: ThemePreviewRuntime, mode: "build" | "preview-server" = "preview-server") => {
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
  it("leaves today's client-only preview unchanged by default", () => {
    const { files } = plan();
    expect(files.has("/workspace/index.html")).toBe(true);
    expect(files.has("/workspace/__entry.tsx")).toBe(true);
    expect(files.has(`/workspace/${THEME_PREVIEW_START_WORKER_PATH}`)).toBe(false);
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
      themePreviewStartWorkerSource(),
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
    expect(files.has(`/workspace/${THEME_PREVIEW_START_WORKER_PATH}`)).toBe(false);
  });

  it("keeps both platform files out of an author's reach", () => {
    for (const path of [THEME_PREVIEW_START_WORKER_PATH, THEME_PREVIEW_START_CLIENT_PATH]) {
      expect(refuseThemeWorkspacePath(path)).toMatch(/^RESERVED_THEME_BUILD_PATH/);
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
    expect(source).toContain('headers.set("x-morph-content-origin", CONTENT_ORIGIN)');
    expect(source).toContain('import startEntry from "@tanstack/react-start/server-entry"');
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

  it.each(["https://example.com/", "https://api.stripe.com/v1", "http://8.8.8.8/"])(
    "passes the public host %s",
    (url) => {
      expect(previewOutboundRefusal(url)).toBeNull();
    },
  );
});
