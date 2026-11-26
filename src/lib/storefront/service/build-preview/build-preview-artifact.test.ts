// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { wranglerDeployConfig } from "../sandbox-wrangler-theme-worker-deployer";
import { planThemeWorkerDeployment } from "../theme-worker-deployment-plan";
import { readBuildPreviewArtifact } from "./build-preview-artifact";
import { fixtureBuild } from "./build-preview-artifact.fixture";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("readBuildPreviewArtifact", () => {
  it("previews exactly what publishing the build would deploy", async () => {
    const { build, r2Bucket } = fixtureBuild();
    const result = await readBuildPreviewArtifact({ build, r2Bucket });
    if (!result.ok) throw new Error(result.message);
    const { artifact } = result;

    // The same plan and the same config the release deployer computes.
    const workerConfig = JSON.parse(
      await (await r2Bucket.get(
        `${build.artifactPrefix}/runtime/server/wrangler.json`,
      ))!.text(),
    );
    const planned = planThemeWorkerDeployment({
      target: "production",
      storefrontId: build.storefrontId,
      manifest: build.manifestJson as never,
      workerConfig,
    });
    if (!planned.success) throw new Error(planned.message);
    expect(artifact.plan).toEqual(planned.plan);
    expect(artifact.workerConfig).toEqual(wranglerDeployConfig(planned.plan));

    expect(artifact.modules.map((m) => m.path)).toEqual(["index.js"]);
    expect(artifact.assets.map((a) => a.path)).toEqual(["/app.css"]);
    expect(text(artifact.assets[0]!.bytes)).toBe("body{color:red}");
  });

  it("drops the author's name and variables, as a deployment does", async () => {
    const { build, r2Bucket } = fixtureBuild();
    const result = await readBuildPreviewArtifact({ build, r2Bucket });
    if (!result.ok) throw new Error(result.message);
    expect(result.artifact.workerConfig).not.toHaveProperty("vars");
    expect(result.artifact.workerConfig.name).not.toBe("authors-own-name");
    expect(result.artifact.workerConfig).toMatchObject({
      workers_dev: false,
      preview_urls: false,
    });
  });

  it("refuses a file whose bytes differ from the manifest", async () => {
    const { build, r2Bucket, objects, prefix } = fixtureBuild();
    objects.set(`${prefix}/runtime/client/app.css`, "body{color:blue}");
    expect(await readBuildPreviewArtifact({ build, r2Bucket })).toMatchObject({
      ok: false,
      reason: "ARTIFACT_INTEGRITY",
    });
  });

  it("refuses a file missing from the artifact", async () => {
    const { build, r2Bucket, objects, prefix } = fixtureBuild();
    objects.delete(`${prefix}/runtime/server/index.js`);
    expect(await readBuildPreviewArtifact({ build, r2Bucket })).toMatchObject({
      ok: false,
      reason: "ARTIFACT_UNREADABLE",
    });
  });

  it("previews a server-only build with no client assets, as a deployment now accepts it", async () => {
    const { build, r2Bucket, objects, prefix } = fixtureBuild();
    objects.delete(`${prefix}/runtime/client/app.css`);
    const manifest = build.manifestJson as { files: Array<{ path: string }> };
    manifest.files = manifest.files.filter(
      (file) => file.path !== "runtime/client/app.css",
    );
    const result = await readBuildPreviewArtifact({ build, r2Bucket });
    if (!result.ok) throw new Error(result.message);
    expect(result.artifact.assets).toEqual([]);
    expect(result.artifact.modules.map((m) => m.path)).toEqual(["index.js"]);
    expect(result.artifact.workerConfig.assets).toEqual({
      directory: "../client",
    });
  });

  it("refuses a binding a deployment would refuse", async () => {
    const { build, r2Bucket } = fixtureBuild({
      workerConfig: {
        main: "index.js",
        compatibility_date: "2025-09-02",
        d1_databases: [{ binding: "DB" }],
      },
    });
    expect(await readBuildPreviewArtifact({ build, r2Bucket })).toMatchObject({
      ok: false,
      reason: "PLAN_REJECTED",
    });
  });

  it.each([
    ["a build that has not succeeded", { status: "running" }],
    ["a build without an artifact", { artifactPrefix: null }],
    ["a manifest of another build", { id: "build-2" }],
  ])("refuses %s", async (_label, buildOverrides) => {
    const { build, r2Bucket } = fixtureBuild({ build: buildOverrides });
    expect(await readBuildPreviewArtifact({ build, r2Bucket })).toMatchObject({
      ok: false,
      reason: "BUILD_NOT_PREVIEWABLE",
    });
  });

  it("keeps a registered static page's HTML, which only production leaves out", async () => {
    const aboutHtml = "<!doctype html><h1>About</h1>";
    const plain = fixtureBuild({
      files: { "runtime/client/about/index.html": aboutHtml },
    });
    const registered = fixtureBuild({
      files: { "runtime/client/about/index.html": aboutHtml },
      manifest: {
        runtime: {
          kind: "cloudflare-worker",
          workerEntry: "runtime/server/index.js",
          clientAssetsDirectory: "runtime/client",
          staticPages: [
            {
              path: "/about",
              artifactPath: "runtime/client/about/index.html",
              sha256: createHash("sha256").update(aboutHtml).digest("hex"),
            },
          ],
        },
      },
    });
    const before = await readBuildPreviewArtifact(plain);
    const after = await readBuildPreviewArtifact(registered);
    if (!before.ok || !after.ok) throw new Error("not previewable");
    // Build Preview is unchanged by registration: same plan, same files.
    expect(after.artifact.plan).toEqual(before.artifact.plan);
    expect(after.artifact.assets.map((asset) => asset.path)).toContain(
      "/about/index.html",
    );
  });
});
