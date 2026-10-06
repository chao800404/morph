import { createHash } from "node:crypto";
import type { R2BucketLike } from "../../compiler/cloudflare-r2-theme-build-artifact-store";
import type { CanonicalThemeBuildManifest } from "../../compiler/theme-build-artifact-store.types";
import type { BuildPreviewBuildRecord } from "./build-preview-artifact";

/**
 * A succeeded build as the artifact store leaves it: files under an immutable
 * prefix, and a manifest recording each file's sha256. Test-only.
 */
export const FIXTURE_WORKER = `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/env") return Response.json(Object.keys(env).sort());
    if (url.pathname === "/headers") {
      return Response.json(Object.fromEntries(request.headers));
    }
    if (url.pathname === "/cookies") {
      const headers = new Headers();
      headers.append("set-cookie", "theme_a=1; Path=/");
      headers.append("set-cookie", "better-auth.session_token=planted; Path=/");
      headers.append("set-cookie", "theme_b=2; Path=/");
      return new Response("cookies", { headers });
    }
    if (url.pathname === "/content") {
      const origin = request.headers.get("x-morph-content-origin");
      const response = await fetch(origin + "/_morph/content?path=/");
      return new Response(response.status + ":" + (await response.text()));
    }
    if (url.pathname === "/echo") {
      return new Response(request.method + ":" + (await request.text()));
    }
    if (url.pathname === "/egress") {
      const target = url.searchParams.get("to");
      try {
        const response = await fetch(target);
        return new Response(response.status + ":" + (await response.text()));
      } catch (error) {
        return new Response("threw:" + (error && error.message));
      }
    }
    return new Response("worker:" + url.pathname, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};
`;

export function fixtureBuild(
  overrides: {
    files?: Record<string, string>;
    workerConfig?: Record<string, unknown>;
    manifest?: Partial<CanonicalThemeBuildManifest>;
    build?: Partial<BuildPreviewBuildRecord>;
  } = {},
) {
  const prefix = "storefronts/sf-1/themes/th-1/builds/build-1";
  const files: Record<string, string> = {
    "runtime/server/index.js": FIXTURE_WORKER,
    "runtime/server/.vite/manifest.json": "{}",
    "runtime/client/app.css": "body{color:red}",
    "runtime/client/.assetsignore": "wrangler.json",
    ...overrides.files,
  };
  const workerConfig = overrides.workerConfig ?? {
    name: "authors-own-name",
    main: "index.js",
    compatibility_date: "2025-09-02",
    compatibility_flags: ["nodejs_compat"],
    vars: { AUTHOR_SECRET: "should-not-reach-the-preview" },
    assets: { directory: "../client" },
  };
  const objects = new Map<string, string>([
    ...Object.entries(files).map(
      ([path, content]) => [`${prefix}/${path}`, content] as [string, string],
    ),
    [`${prefix}/runtime/server/wrangler.json`, JSON.stringify(workerConfig)],
  ]);
  const sha = (content: string) =>
    createHash("sha256").update(content).digest("hex");
  const manifest: CanonicalThemeBuildManifest = {
    buildId: "build-1",
    storefrontId: "sf-1",
    themeId: "th-1",
    sourceRevisionId: "rev-1",
    revisionNumber: 1,
    inputHash: "hash",
    compilerId: "test",
    compilerVersion: "1",
    sourceEntry: "src/routes/index.tsx",
    artifactEntry: "runtime/server/index.js",
    runtime: {
      kind: "cloudflare-worker",
      workerEntry: "runtime/server/index.js",
      clientAssetsDirectory: "runtime/client",
    },
    filesCount: objects.size,
    totalSizeBytes: 0,
    files: [...objects.entries()].map(([key, content]) => ({
      path: key.slice(prefix.length + 1),
      contentType: key.endsWith(".js")
        ? "application/javascript"
        : "text/plain",
      sizeBytes: content.length,
      sha256: sha(content),
    })),
    cssChunks: [],
    jsChunks: [],
    createdAt: "2026-10-07T00:00:00.000Z",
    ...overrides.manifest,
  };
  const r2Bucket = {
    async get(key: string) {
      const content = objects.get(key);
      if (content === undefined) return null;
      const bytes = new TextEncoder().encode(content);
      return {
        body: null,
        arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
        text: async () => content,
      };
    },
  } as unknown as R2BucketLike;
  const build: BuildPreviewBuildRecord = {
    id: "build-1",
    storefrontId: "sf-1",
    themeId: "th-1",
    status: "succeeded",
    artifactPrefix: prefix,
    manifestJson: manifest,
    ...overrides.build,
  };
  return { build, r2Bucket, objects, prefix };
}
