// @vitest-environment node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STARTER_THEME_FILES } from "../starter-theme-files";
import { calculateThemeSourceSha256 } from "../storage/cloudflare-r2-theme-source-blob-store";
import { noisyPng } from "../theme-image.test-support";
import { LocalVitePreviewServer } from "./local-vite-preview-server";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";

/**
 * docs/astro-theme-plan.md 5.2.5, PR 2: a binary file kept under src/ in a
 * Live Preview on the local transport. A route imports it; the preview
 * renders the route and serves the image the page points at with the stored
 * bytes, through the same by-reference loader as public/ files.
 */
const WORKSPACES_ROOT = path.join(process.cwd(), ".morph-previews-source-asset-test");
const PREVIEW_ID = "source-asset-preview";
const HERO = noisyPng(64, 48);
const GALLERY = {
  path: "src/routes/gallery.tsx",
  content:
    'import { createFileRoute } from "@tanstack/react-router";\n' +
    'import hero from "../assets/hero.png";\n' +
    'export const Route = createFileRoute("/gallery")({ component: Gallery });\n' +
    'function Gallery() { return <img id="hero" src={hero} alt="hero" />; }\n',
};

let server: LocalVitePreviewServer;
let origin = "";

beforeAll(async () => {
  await fs.mkdir(WORKSPACES_ROOT, { recursive: true });
  server = new LocalVitePreviewServer({
    workspacesRoot: WORKSPACES_ROOT,
    toolchainRoot: process.cwd(),
    approvedDependencies: DEFAULT_APPROVED_DEPENDENCIES,
    readyTimeoutMs: 120_000,
  });
  const started = await server.start({
    previewId: PREVIEW_ID,
    files: [
      ...STARTER_THEME_FILES,
      GALLERY,
      {
        path: "src/assets/hero.png",
        binary: {
          digest: calculateThemeSourceSha256(HERO),
          sizeBytes: HERO.byteLength,
        },
      },
    ] as never,
    entry: "src/routes/index.tsx",
    previewHostname: "127.0.0.1",
    platformHostEnv: {},
    previewRuntime: "start",
    loadBinary: async (ref) => {
      if (ref.digest !== calculateThemeSourceSha256(HERO)) {
        throw new Error("unknown blob");
      }
      return HERO;
    },
  });
  if (!started.ok) throw new Error(`${started.stage}: ${started.errorMessage}`);
  origin = new URL(started.url).origin;
}, 180_000);

afterAll(async () => {
  await server?.stop(PREVIEW_ID).catch(() => {});
  await fs.rm(WORKSPACES_ROOT, { recursive: true, force: true }).catch(() => {});
}, 60_000);

describe("a src/ image in the local Live Preview", { timeout: 120_000 }, () => {
  it("is imported by a route and served with its stored bytes", async () => {
    const page = await fetch(`${origin}/gallery`);
    expect(page.status).toBe(200);
    const html = await page.text();
    const src = /<img[^>]*id="hero"[^>]*src="([^"]+)"/.exec(html)?.[1]
      ?? /<img[^>]*src="([^"]+)"[^>]*id="hero"/.exec(html)?.[1];
    expect(src, html.slice(0, 2000)).toBeTruthy();
    const image = await fetch(new URL(src!, origin));
    expect(image.status).toBe(200);
    const bytes = new Uint8Array(await image.arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      calculateThemeSourceSha256(HERO),
    );
  });
});
