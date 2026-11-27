// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openMigratedD1 } from "@/lib/test-utils/real-d1";
import type {
  StorefrontThemeBuildDTO,
  StorefrontThemeBuildInput,
} from "@/lib/storefront/dto/storefront-theme-build.dto";
import type { ThemeWorkerDeploymentPlan } from "./theme-worker-deployment-plan";

/**
 * The active release picks the static HTML: publish A, publish B, roll back
 * to A, and the public URL answers with each step's bytes.
 *
 * Everything on the path is real except the Theme Worker transport and the
 * Cloudflare upload: a local D1 (Miniflare) with every migration, a local
 * R2 bucket, the artifact store that registers the page from the Starter
 * source and a sealed SSG claim, the release DAL's CAS and deployment lease,
 * the reconciler that publish and rollback share, the host resolver and
 * Core's storefront entry. The deployer only records the plan it was handed.
 *
 * The publish guard is untouched: releases are written here the way the
 * reconciler activates them, not through the editor's publish, which still
 * refuses SSG.
 */

const HOST = "ssg-release.example.com";
const NOW = "2026-11-26T00:00:00.000Z";
const WORKER_CONFIG = {
  name: "authors-own-name",
  main: "index.js",
  compatibility_date: "2025-09-02",
  compatibility_flags: ["nodejs_compat"],
  assets: { directory: "../client" },
};

let harness: Awaited<ReturnType<typeof openMigratedD1>> | null = null;
let d1: D1Database;
let bucket: R2Bucket;

async function run(sql: string, ...values: unknown[]) {
  await d1.prepare(sql).bind(...values).run();
}

async function starterBuildInput(
  buildId: string,
  publicationId: string,
  renderPolicy: { mode: "ssg" } | { mode: "ssr" },
): Promise<StorefrontThemeBuildInput> {
  const { starterThemeWorkspaceFiles } = await import("../starter-theme-files");
  return {
    buildId,
    storefrontId: "sf_ssg",
    themeId: "th_ssg",
    sourceRevisionId: "rev_ssg",
    revisionNumber: 1,
    files: starterThemeWorkspaceFiles().map((file) => ({
      path: file.path,
      content: file.content,
    })),
    entry: "src/routes/index.tsx",
    inputHash: `hash-${buildId}`,
    compilerId: "tailwind-v4-build",
    compilerVersion: "test",
    framework: "tanstack-start",
    contentSnapshot: {
      publicationId,
      storefrontId: "sf_ssg",
      themeId: "th_ssg",
      documents: [
        {
          item: {
            id: `item-${publicationId}`,
            publicationId,
            itemType: "template",
            contentId: "tpl_home",
            revisionId: `tpl-rev-${publicationId}`,
            metadata: { templateType: "index" },
          },
          document: { version: 1, sections: [], renderPolicy },
        },
      ],
    } as NonNullable<StorefrontThemeBuildInput["contentSnapshot"]>,
  };
}

/**
 * A succeeded build, persisted by the real artifact store into the local R2
 * bucket, and recorded in D1 with the canonical manifest the store wrote.
 */
async function seedBuild(args: {
  buildId: string;
  publicationId: string;
  homeHtml: string | null;
  renderPolicy: { mode: "ssg" } | { mode: "ssr" };
}) {
  const { CloudflareR2ThemeBuildArtifactStore } = await import(
    "../compiler/cloudflare-r2-theme-build-artifact-store"
  );
  const buildInput = await starterBuildInput(
    args.buildId,
    args.publicationId,
    args.renderPolicy,
  );
  const build: StorefrontThemeBuildDTO = {
    id: args.buildId,
    storefrontId: "sf_ssg",
    themeId: "th_ssg",
    sourceRevisionId: "rev_ssg",
    status: "building",
    inputHash: buildInput.inputHash,
    compilerId: buildInput.compilerId,
    compilerVersion: buildInput.compilerVersion,
    artifactPrefix: null,
    manifestJson: null,
    diagnosticsJson: null,
    errorMessage: null,
    startedAt: NOW,
    completedAt: null,
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const store = new CloudflareR2ThemeBuildArtifactStore({
    r2Bucket: bucket as never,
  });
  const stored = await store.persistBuildArtifacts({
    build,
    buildInput,
    artifacts: [
      {
        path: "runtime/server/index.js",
        content: "export default { fetch() { return new Response('ssr'); } };",
        mimeType: "application/javascript",
      },
      {
        path: "runtime/server/wrangler.json",
        content: JSON.stringify(WORKER_CONFIG),
        mimeType: "application/json",
      },
      // An SSR build prerenders nothing, so it writes no page HTML.
      ...(args.homeHtml === null
        ? []
        : [
            {
              path: "runtime/client/index.html",
              content: args.homeHtml,
              mimeType: "text/html",
            },
          ]),
      {
        path: "runtime/client/assets/app.js",
        content: `export const build = ${JSON.stringify(args.buildId)};`,
        mimeType: "application/javascript",
      },
    ],
    runnerManifest: {
      artifactEntry: "runtime/server/index.js",
      metadata: {
        runtime: "cloudflare-worker",
        workerEntry: "runtime/server/index.js",
        clientAssetsDirectory: "runtime/client",
      },
    },
  });
  await run(
    `INSERT INTO storefront_content_publications (id, storefront_id, created_at, updated_at) VALUES (?, 'sf_ssg', ?, ?)`,
    args.publicationId,
    NOW,
    NOW,
  );
  await run(
    `INSERT INTO storefront_theme_builds
       (id, storefront_id, theme_id, source_revision_id, status, input_hash, compiler_id, compiler_version,
        artifact_prefix, manifest_json, content_publication_id, content_dependency, framework, created_at, updated_at)
     VALUES (?, 'sf_ssg', 'th_ssg', 'rev_ssg', 'succeeded', ?, ?, ?, ?, ?, ?, ?, 'tanstack-start', ?, ?)`,
    args.buildId,
    buildInput.inputHash,
    buildInput.compilerId,
    buildInput.compilerVersion,
    stored.artifactPrefix,
    JSON.stringify(stored.manifest),
    args.publicationId,
    // What the sealed build pass records for HTML made from content.
    args.renderPolicy.mode === "ssg" ? "dependent" : "independent",
    NOW,
    NOW,
  );
  return stored;
}

async function seedRelease(releaseId: string, buildId: string, publicationId: string) {
  await run(
    `INSERT INTO storefront_releases
       (id, storefront_id, theme_id, source_revision_id, theme_build_id, content_publication_id, status, created_at, updated_at)
     VALUES (?, 'sf_ssg', 'th_ssg', 'rev_ssg', ?, ?, 'available', ?, ?)`,
    releaseId,
    buildId,
    publicationId,
    NOW,
    NOW,
  );
}

beforeAll(async () => {
  harness = await openMigratedD1("ssg-release-selection", { r2: true });
  d1 = harness.d1;
  bucket = harness.r2!;

  await run(
    `INSERT INTO sales_channels (id, name, created_at, updated_at) VALUES ('sc_ssg', 'Online', ?, ?)`,
    NOW,
    NOW,
  );
  await run(
    `INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at)
     VALUES ('sf_ssg', 'sc_ssg', 'SSG store', 'published', ?, ?)`,
    NOW,
    NOW,
  );
  await run(
    `INSERT INTO storefront_domains (id, storefront_id, hostname, is_primary, status, created_at, updated_at)
     VALUES ('dom_ssg', 'sf_ssg', ?, 1, 'active', ?, ?)`,
    HOST,
    NOW,
    NOW,
  );
  await run(
    `INSERT INTO storefront_themes (id, storefront_id, name, created_at, updated_at, framework)
     VALUES ('th_ssg', 'sf_ssg', 'Starter', ?, ?, 'tanstack-start')`,
    NOW,
    NOW,
  );
  await run(
    `INSERT INTO storefront_theme_revisions (id, storefront_id, theme_id, revision_number, snapshot, created_at, updated_at)
     VALUES ('rev_ssg', 'sf_ssg', 'th_ssg', 1, '{}', ?, ?)`,
    NOW,
    NOW,
  );
}, 180_000);

afterAll(async () => {
  await harness?.dispose();
});

// Sequential on purpose: each case is the next step of one publish history
// (A, then B, then rollback to A, ...) on the same database, and reads the
// state the previous case left. They must never run concurrently or alone
// out of order; `describe.sequential` keeps that explicit even if the file
// is ever configured to run its tests concurrently.
describe.sequential("the public URL serves the active release's static HTML", () => {
  const HTML_A = "<!doctype html><h1>Home, release A</h1>";
  const HTML_B = "<!doctype html><h1>Home, release B</h1>";
  const deployed: Array<{ releaseId: string; plan: ThemeWorkerDeploymentPlan }> = [];
  const ssr = vi.fn(async () => ({
    success: true as const,
    response: new Response("rendered by the Theme Worker"),
  }));

  async function core() {
    const { StorefrontProductionService } = await import(
      "./storefront-production.service"
    );
    return new StorefrontProductionService({
      runtime: { kind: "local-direct", handle: ssr } as never,
      r2Bucket: bucket as never,
    });
  }

  async function activate(releaseId: string, expectedActiveReleaseId: string | null) {
    const [{ activateReleaseWithDeployment }, { storefrontReleaseDal }, { storefrontThemeBuildDal }] =
      await Promise.all([
        import("./storefront-release-reconciler"),
        import("../dal/storefront-release.dal"),
        import("../dal/storefront-theme-build.dal"),
      ]);
    // Wired as `activateStorefrontRelease` wires it, with a deployer that
    // records the plan instead of uploading it.
    const result = await activateReleaseWithDeployment({
      releaseId,
      expectedActiveReleaseId,
      r2Bucket: bucket as never,
      deployer: {
        kind: "sandbox-wrangler",
        deploy: async ({ plan, releaseId: deployedRelease }) => {
          deployed.push({ releaseId: deployedRelease, plan });
          return {
            success: true,
            scriptName: plan.scriptName,
            deploymentId: `dep-${deployedRelease}`,
            durationMs: 1,
          };
        },
      },
      ports: {
        getRelease: async (id) => {
          const release = await storefrontReleaseDal.getById("sf_ssg", id);
          return release
            ? {
                id: release.id,
                storefrontId: "sf_ssg",
                themeId: release.themeId,
                themeBuildId: release.themeBuildId,
                contentPublicationId: release.contentPublicationId ?? null,
              }
            : null;
        },
        getBuild: (buildId) => storefrontThemeBuildDal.getBuildById(buildId),
        activateRelease: (args) => storefrontReleaseDal.activateRelease(args),
        deploymentLease: {
          acquire: (args) => storefrontReleaseDal.acquireDeploymentLease(args),
          release: (args) => storefrontReleaseDal.releaseDeploymentLease(args),
        },
      },
    });
    expect(result, JSON.stringify(result)).toMatchObject({ success: true });
  }

  const get = async (path: string, headers: Record<string, string> = {}) =>
    (await core()).handleRequest(new Request(`https://${HOST}${path}`, { headers }));

  let etagA = "";

  it("registers each build's page with its own bytes", async () => {
    const a = await seedBuild({
      buildId: "bld_a",
      publicationId: "pub_a",
      homeHtml: HTML_A,
      renderPolicy: { mode: "ssg" },
    });
    const b = await seedBuild({
      buildId: "bld_b",
      publicationId: "pub_b",
      homeHtml: HTML_B,
      renderPolicy: { mode: "ssg" },
    });
    expect(a.manifest.runtime?.staticPages).toEqual([
      expect.objectContaining({ path: "/", artifactPath: "runtime/client/index.html" }),
    ]);
    expect(a.manifest.runtime?.staticPages?.[0]?.sha256).not.toBe(
      b.manifest.runtime?.staticPages?.[0]?.sha256,
    );
    await seedRelease("rel_a", "bld_a", "pub_a");
    await seedRelease("rel_b", "bld_b", "pub_b");
  });

  it("publish A: the URL serves A's HTML, and the Theme Worker was deployed without it", async () => {
    await activate("rel_a", null);
    const response = await get("/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(HTML_A);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache",
    );
    etagA = response.headers.get("etag")!;
    expect(etagA).toMatch(/^"ssg:rel_a:[0-9a-f]{64}"$/);
    expect((await get("/", { "if-none-match": etagA })).status).toBe(304);

    const plan = deployed.at(-1)!;
    expect(plan.releaseId).toBe("rel_a");
    const assets = plan.plan.assets.map((asset) => asset.artifactPath);
    expect(assets).toEqual(["runtime/client/assets/app.js"]);
  });

  it("publish B: the same URL serves B's HTML, and A's ETag no longer revalidates", async () => {
    await activate("rel_b", "rel_a");
    const response = await get("/", { "if-none-match": etagA });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(HTML_B);
    const etagB = response.headers.get("etag")!;
    expect(etagB).toMatch(/^"ssg:rel_b:[0-9a-f]{64}"$/);
    expect(etagB).not.toBe(etagA);
    expect(await (await get("/index.html")).text()).toBe(HTML_B);
    expect(
      deployed.at(-1)!.plan.assets.map((asset) => asset.artifactPath),
    ).toEqual(["runtime/client/assets/app.js"]);
  });

  it("rollback to A: the URL serves A's HTML again, and A's ETag revalidates", async () => {
    await activate("rel_a", "rel_b");
    const response = await get("/");
    expect(await response.text()).toBe(HTML_A);
    expect(response.headers.get("etag")).toBe(etagA);
    expect((await get("/", { "if-none-match": etagA })).status).toBe(304);
    expect(deployed.map((entry) => entry.releaseId)).toEqual([
      "rel_a",
      "rel_b",
      "rel_a",
    ]);
    expect(ssr).not.toHaveBeenCalled();
  });

  it("a release whose page is SSR: Core hands the URL to the Theme Worker, never an earlier release's HTML", async () => {
    // Same source, the home back to SSR: nothing is prerendered or
    // registered. (Whether the deployed Worker itself answers correctly is
    // the lane B acceptance of the next PR, on a real build.)
    const c = await seedBuild({
      buildId: "bld_c",
      publicationId: "pub_c",
      homeHtml: null,
      renderPolicy: { mode: "ssr" },
    });
    expect(c.manifest.runtime?.staticPages).toBeUndefined();
    await seedRelease("rel_c", "bld_c", "pub_c");
    await activate("rel_c", "rel_a");

    for (const path of ["/", "/index.html"]) {
      const response = await get(path, { "if-none-match": etagA });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("rendered by the Theme Worker");
    }
    expect(ssr).toHaveBeenCalledTimes(2);
    expect(
      deployed.at(-1)!.plan.assets.map((asset) => asset.artifactPath),
    ).toEqual(["runtime/client/assets/app.js"]);
  });

  it("a registered page whose HTML object is gone is an error, not SSR", async () => {
    await activate("rel_a", "rel_c");
    await bucket.delete(
      "storefronts/sf_ssg/themes/th_ssg/builds/bld_a/runtime/client/index.html",
    );
    const before = ssr.mock.calls.length;
    const response = await get("/");
    expect(response.status).toBe(503);
    expect(await response.text()).toMatch(/^SSG_ARTIFACT_UNAVAILABLE/);
    expect(ssr.mock.calls.length).toBe(before);
  });
});
