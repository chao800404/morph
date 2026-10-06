// @vitest-environment node
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
});
