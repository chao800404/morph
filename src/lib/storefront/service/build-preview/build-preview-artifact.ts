import type { R2BucketLike } from "../../compiler/cloudflare-r2-theme-build-artifact-store";
import type { CanonicalThemeBuildManifest } from "../../compiler/theme-build-artifact-store.types";
import { svgIsolationHeadersFile } from "../../theme-svg-isolation";
import { wranglerDeployConfig } from "../sandbox-wrangler-theme-worker-deployer";
import {
  GENERATED_WORKER_CONFIG_PATH,
  readGeneratedWorkerConfig,
} from "../storefront-release-reconciler";
import {
  planThemeWorkerDeployment,
  type ThemeWorkerDeploymentPlan,
} from "../theme-worker-deployment-plan";

/**
 * What an isolated Build Preview runs: exactly what publishing this build
 * would deploy.
 *
 * The plan comes from the same `planThemeWorkerDeployment` and the Worker
 * config from the same `wranglerDeployConfig` the release deployer uses, over
 * the same immutable artifact prefix — so the preview runs the bytes a publish
 * of this build would upload, with the author's `name` and `vars` dropped and
 * forbidden bindings refused exactly as a deployment refuses them. Every file is
 * checked against the sha256 the artifact store recorded in the manifest
 * before it is handed on; the deployer itself does not re-check, so this is the
 * stronger of the two reads.
 *
 * Nothing here runs the Worker; see `local-build-preview-worker.ts` for the
 * local executor. Framework-neutral: any framework whose artifact describes a
 * Worker entry and client assets in the manifest is previewed the same way.
 */

export type BuildPreviewArtifactFile = Readonly<{
  /** Path inside the Worker's own directory (`assets/x.js`) or served path (`/assets/x.css`). */
  path: string;
  bytes: Uint8Array;
}>;

export type BuildPreviewArtifact = Readonly<{
  buildId: string;
  storefrontId: string;
  themeId: string;
  artifactPrefix: string;
  plan: ThemeWorkerDeploymentPlan;
  /** The Worker config a deployment of this plan is given. */
  workerConfig: Record<string, unknown>;
  /** Worker modules, by path relative to the Worker's directory. */
  modules: readonly BuildPreviewArtifactFile[];
  /** Static assets, by the path they are served at. */
  assets: readonly BuildPreviewArtifactFile[];
  /** The platform `_headers` a deployment writes beside the assets. */
  headersFile: string;
}>;

export type BuildPreviewArtifactRefusal =
  | "BUILD_NOT_PREVIEWABLE"
  | "WORKER_CONFIG_UNREADABLE"
  | "PLAN_REJECTED"
  | "ARTIFACT_UNREADABLE"
  | "ARTIFACT_INTEGRITY";

export type BuildPreviewArtifactResult =
  | Readonly<{ ok: true; artifact: BuildPreviewArtifact }>
  | Readonly<{
      ok: false;
      reason: BuildPreviewArtifactRefusal;
      message: string;
    }>;

export type BuildPreviewBuildRecord = Readonly<{
  id: string;
  storefrontId: string;
  themeId: string;
  status: string;
  artifactPrefix: string | null;
  manifestJson: unknown;
}>;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function readBytes(
  bucket: R2BucketLike,
  key: string,
): Promise<Uint8Array | null> {
  const object = await bucket.get(key);
  return object ? new Uint8Array(await object.arrayBuffer()) : null;
}

const refuse = (
  reason: BuildPreviewArtifactRefusal,
  message: string,
): BuildPreviewArtifactResult => ({ ok: false, reason, message });

export async function readBuildPreviewArtifact(args: {
  build: BuildPreviewBuildRecord;
  r2Bucket: R2BucketLike;
}): Promise<BuildPreviewArtifactResult> {
  const { build } = args;
  if (
    build.status !== "succeeded" ||
    !build.artifactPrefix ||
    !build.manifestJson
  ) {
    return refuse(
      "BUILD_NOT_PREVIEWABLE",
      `Build "${build.id}" has no succeeded artifact to preview.`,
    );
  }
  const manifest = build.manifestJson as CanonicalThemeBuildManifest;
  if (
    manifest.buildId !== build.id ||
    manifest.storefrontId !== build.storefrontId ||
    manifest.themeId !== build.themeId
  ) {
    return refuse(
      "BUILD_NOT_PREVIEWABLE",
      `Build "${build.id}" carries a manifest for another build.`,
    );
  }

  const workerConfig = await readGeneratedWorkerConfig(
    args.r2Bucket,
    build.artifactPrefix,
  );
  if (workerConfig === null) {
    return refuse(
      "WORKER_CONFIG_UNREADABLE",
      `Build artifact is missing a readable "${GENERATED_WORKER_CONFIG_PATH}".`,
    );
  }
  const planned = planThemeWorkerDeployment({
    storefrontId: build.storefrontId,
    manifest,
    workerConfig,
  });
  if (!planned.success) return refuse("PLAN_REJECTED", planned.message);

  const recorded = new Map(
    (manifest.files ?? []).map((file) => [file.path, file.sha256]),
  );
  const read = async (
    artifactPath: string,
  ): Promise<Uint8Array | BuildPreviewArtifactResult> => {
    const bytes = await readBytes(
      args.r2Bucket,
      `${build.artifactPrefix}/${artifactPath}`,
    );
    if (!bytes) {
      return refuse(
        "ARTIFACT_UNREADABLE",
        `"${artifactPath}" is missing from the immutable artifact.`,
      );
    }
    const expected = recorded.get(artifactPath);
    if (!expected || (await sha256Hex(bytes)) !== expected) {
      return refuse(
        "ARTIFACT_INTEGRITY",
        `"${artifactPath}" does not match the sha256 recorded in the build manifest.`,
      );
    }
    return bytes;
  };

  const modules: BuildPreviewArtifactFile[] = [];
  for (const module of planned.plan.modules) {
    const bytes = await read(module.artifactPath);
    if (!(bytes instanceof Uint8Array)) return bytes;
    modules.push({ path: module.modulePath, bytes });
  }
  const assets: BuildPreviewArtifactFile[] = [];
  for (const asset of planned.plan.assets) {
    const bytes = await read(asset.artifactPath);
    if (!(bytes instanceof Uint8Array)) return bytes;
    assets.push({ path: asset.servedPath, bytes });
  }

  return {
    ok: true,
    artifact: {
      buildId: build.id,
      storefrontId: build.storefrontId,
      themeId: build.themeId,
      artifactPrefix: build.artifactPrefix,
      plan: planned.plan,
      workerConfig: wranglerDeployConfig(planned.plan),
      modules,
      assets,
      headersFile: svgIsolationHeadersFile(),
    },
  };
}
