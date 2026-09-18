#!/usr/bin/env node
/**
 * Runs the local Live Preview sidecar.
 *
 * Why this exists at all: `pnpm dev` serves the app from workerd, and `node:fs`
 * there is an in-memory file system scoped to a single request. There is nowhere
 * for a Theme workspace to live and nothing for a Vite dev server to watch, so
 * the preview has to run in a Node process and the Worker has to reach it.
 *
 * It is started by hand, the way `MORPH_LOCAL_THEME_ORIGIN` expects a locally
 * started Theme Worker to be, and for the same reason: it is a real thing doing
 * real work, not a stub standing in for a deployment.
 *
 *   MORPH_LOCAL_THEME_PREVIEW_ORIGIN=http://127.0.0.1:5199 \
 *   MORPH_LOCAL_THEME_PREVIEW_TOKEN=$(openssl rand -hex 32) \
 *   pnpm theme:preview
 *
 * The origin and token have to match what the Worker reads. Put both in
 * `.dev.vars` (see `.dev.vars.example`) and run this with `--env-file` — which
 * `pnpm theme:preview` already does — so there is one copy of each.
 *
 * The TypeScript module is loaded through a throwaway Vite server rather than
 * `node --experimental-strip-types`, because the preview's import graph uses
 * this project's `@/` path aliases and its `tsconfig` is the thing that defines
 * them. The loader never listens on anything: it is a module resolver.
 */

import { createServer as createViteServer } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

const origin = process.env.MORPH_LOCAL_THEME_PREVIEW_ORIGIN;
if (!origin) {
  console.error(
    "MISSING_LOCAL_THEME_PREVIEW_ORIGIN: set MORPH_LOCAL_THEME_PREVIEW_ORIGIN (for example http://127.0.0.1:5199), the same value the Worker reads.",
  );
  process.exit(1);
}

const loader = await createViteServer({
  configFile: false,
  root: process.cwd(),
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true, hmr: false, watch: null },
  plugins: [tsConfigPaths({ projects: ["./tsconfig.json"] })],
});

let sidecar;
try {
  const { startLocalPreviewSidecar } = await loader.ssrLoadModule(
    "/src/lib/storefront/service/local-preview-sidecar.ts",
  );
  const { cmsConfig } = await loader.ssrLoadModule("/src/cms.config.ts");

  sidecar = await startLocalPreviewSidecar({
    origin,
    token: process.env.MORPH_LOCAL_THEME_PREVIEW_TOKEN,
    // The same allowlist the deployed build is held to, so a Theme cannot be
    // shown locally importing something production would refuse.
    approvedDependencies: cmsConfig?.theme?.dependencies
      ? Object.keys(cmsConfig.theme.dependencies)
      : undefined,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  await loader.close().catch(() => {});
  process.exit(1);
}

console.log(`morph local preview sidecar listening on ${sidecar.origin}`);
console.log(
  "The Worker reaches it with MORPH_LOCAL_THEME_PREVIEW_ORIGIN and MORPH_LOCAL_THEME_PREVIEW_TOKEN.",
);

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await sidecar.close().catch(() => {});
  await loader.close().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
