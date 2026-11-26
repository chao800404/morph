// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { LocalVitePreviewServer } from "./local-vite-preview-server";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import { previewContentAsCoreWrites } from "./theme-preview-content.test-support";
import {
  PREVIEW_SERVED_INSTANCE_TIMING,
  parsePreviewServedInstance,
  previewServedInstanceFromEntries,
  type PreviewServedInstance,
} from "../editor/preview-protocol";

/**
 * Which start served a full Start preview's page, on a real Start child
 * (Vite + the Cloudflare plugin + workerd).
 *
 * The parent names the instance and hands it to the child; the child puts
 * it on every response it gives, the Worker's server-rendered document
 * included, and confirms it back. A page reads it from its own responses,
 * so what matters is what a document and a module response actually carry,
 * and what a page would conclude from them.
 */

const WORKSPACES_ROOT = path.join(
  process.cwd(),
  ".morph-previews-start-instance-test",
);
const PREVIEW_ID = "start-instance-test";

/** A Theme whose Worker sets its own `Server-Timing` on every response. */
const THEME_SERVER_TIMING_START = {
  path: "src/start.ts",
  content: `import { createMiddleware, createStart } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";

const themeTiming = createMiddleware().server(async ({ next }) => {
  setResponseHeader("server-timing", 'theme-render;dur=1');
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [themeTiming],
}));
`,
};

let server: LocalVitePreviewServer;

beforeAll(async () => {
  await fs.mkdir(WORKSPACES_ROOT, { recursive: true });
  server = new LocalVitePreviewServer({
    workspacesRoot: WORKSPACES_ROOT,
    toolchainRoot: process.cwd(),
    approvedDependencies: DEFAULT_APPROVED_DEPENDENCIES,
    readyTimeoutMs: 120_000,
  });
});

afterAll(async () => {
  await server?.stop(PREVIEW_ID).catch(() => {});
  await fs
    .rm(WORKSPACES_ROOT, { recursive: true, force: true })
    .catch(() => {});
}, 60_000);

async function startTheme(extra: { path: string; content: string }[] = []) {
  const started = await server.start({
    previewId: PREVIEW_ID,
    files: [...STARTER_THEME_FILES, ...extra] as never,
    entry: "src/routes/index.tsx",
    previewHostname: "127.0.0.1",
    platformHostEnv: {},
    previewRuntime: "start",
    previewContent: previewContentAsCoreWrites(),
  });
  if (!started.ok) {
    expect.fail(`${started.stage}: ${started.errorMessage}`);
  }
  return started;
}

/** The instance a response names, or null where it names none. */
function namedBy(response: Response): string | null {
  const header = response.headers.get("server-timing") ?? "";
  return (
    new RegExp(`${PREVIEW_SERVED_INSTANCE_TIMING};desc="([^"]+)"`).exec(
      header,
    )?.[1] ?? null
  );
}

/** What a page served these two responses would report on its ready. */
async function pageReport(url: string) {
  const document = await fetch(url);
  expect(document.status).toBe(200);
  expect(document.headers.get("content-type")).toContain("text/html");
  const html = await document.text();
  const module = await fetch(new URL("/@vite/client", url));
  expect(module.status).toBe(200);
  await module.text();
  return {
    html,
    document,
    module,
    report: previewServedInstanceFromEntries([
      {
        kind: "navigation",
        sameOrigin: true,
        transferSize: html.length,
        instance: namedBy(document),
      },
      {
        kind: "script",
        sameOrigin: true,
        transferSize: 1,
        instance: namedBy(module),
      },
    ]),
  };
}

describe(
  "the instance a Start child names",
  { timeout: 240_000 },
  () => {
    let firstInstance: PreviewServedInstance | null = null;

    it("names the parent's instance on the Worker's document and on a module, and reports it", async () => {
      const started = await startTheme();
      const instance = server.servedInstanceFor(PREVIEW_ID);
      expect(instance).not.toBeNull();
      expect(started.serving?.instance).toEqual(instance);
      firstInstance = instance;

      const { html, document, module, report } = await pageReport(started.url);
      // Rendered by the Theme's Worker, not a static index.html.
      expect(html.toLowerCase()).toContain("<!doctype html>");
      expect(parsePreviewServedInstance(namedBy(document))).toEqual(instance);
      expect(parsePreviewServedInstance(namedBy(module))).toEqual(instance);
      expect(report).toEqual({ kind: "known", instance });
    });

    it("names the next instance after the server is replaced", async () => {
      expect(firstInstance).not.toBeNull();
      const replaced = await startTheme([
        { path: "src/replaced-marker.ts", content: "export const replaced = 1;\n" },
      ]);
      expect(replaced.timings.reusedProcess).toBe(false);
      const instance = server.servedInstanceFor(PREVIEW_ID);
      expect(instance).toEqual({
        session: firstInstance!.session,
        serial: firstInstance!.serial + 1,
      });
      expect(replaced.serving?.instance).toEqual(instance);
      const { report } = await pageReport(replaced.url);
      expect(report).toEqual({ kind: "known", instance });
    });

    it("leaves a page unknown, never wrong, when the Theme's Worker sets its own Server-Timing", async () => {
      const started = await startTheme([THEME_SERVER_TIMING_START]);
      const instance = server.servedInstanceFor(PREVIEW_ID);
      expect(instance).not.toBeNull();
      const { document, module, report } = await pageReport(started.url);
      // The Worker's header replaces the one the child set on the document.
      expect(document.headers.get("server-timing")).toContain("theme-render");
      expect(namedBy(document)).toBeNull();
      // Vite still answers the modules itself, and names the instance there.
      expect(parsePreviewServedInstance(namedBy(module))).toEqual(instance);
      // A page that cannot say who served its document says so.
      expect(report).toEqual({ kind: "missing" });
    });
  },
);
