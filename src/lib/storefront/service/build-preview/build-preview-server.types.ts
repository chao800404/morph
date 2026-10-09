import type { BuildPreviewArtifact } from "./build-preview-artifact";

/**
 * What runs a Build Preview, for the transports that can.
 *
 * The same arrangement as the Live Preview's `ThemePreviewServer`: one
 * contract, a local transport (the operator-started helper process on a
 * developer's machine) and a container one, chosen by which bindings the
 * environment has. Core holds no state between requests: it asks the executor
 * to answer a request for an instance, and starts the instance when the
 * executor says there is none — the first request, and the first one after
 * an idle stop, alike.
 *
 * One instance per capability, not per build: an instance may reach exactly
 * one origin, the preview host it is served on, so two users previewing one
 * build each get their own. It is still one build's artifact, never a Live
 * Preview's process.
 */
export type BuildPreviewInstanceStart = Readonly<{
  /** The capability's id. */
  instanceId: string;
  /** Read from R2 and verified by Core; the executor never reads storage. */
  artifact: BuildPreviewArtifact;
  /**
   * The preview host's origin, where the Theme fetches `/_morph/content`.
   * The only origin the instance may reach.
   */
  contentOrigin: string;
  /**
   * Where a request for `contentOrigin` actually connects, when that is not
   * the origin itself — locally, Core's loopback address. The transport
   * decides whether it honours this.
   */
  contentUpstream?: string;
}>;

/**
 * The platform did not give the instance a place to run this time — its
 * container failed to start before anything of the build ran. Unlike a
 * build that does not start (its own process exiting, never opening its
 * port), asking again later can succeed, so Core answers "starting" and the
 * browser asks again rather than being left on an error.
 */
export class BuildPreviewInstanceUnavailableError extends Error {
  readonly code = "BUILD_PREVIEW_INSTANCE_UNAVAILABLE";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BuildPreviewInstanceUnavailableError";
  }
}

export type BuildPreviewServer = Readonly<{
  kind: "local-sidecar" | "cloudflare-sandbox";
  /**
   * The instance's answer to one request, or null when it has no running
   * instance. Answering counts as activity for the instance's idle period.
   */
  fetch(instanceId: string, request: Request): Promise<Response | null>;
  /** Starts the instance; a start for one already running is a no-op. */
  start(input: BuildPreviewInstanceStart): Promise<void>;
  stop(instanceId: string): Promise<void>;
}>;
