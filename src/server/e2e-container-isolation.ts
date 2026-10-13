/**
 * What a container end-to-end run changes in its Worker config, so that its
 * containers can be told from everyone else's — by name and by image.
 *
 * By name: the run names its Worker `morph-e2e-<id>`. workerd names a
 * container after its Durable Object namespace, `<worker>-<class>`, so every
 * container the run starts is `workerd-morph-e2e-<id>-…`, and the runner
 * removes exactly those (`scripts/run-editor-e2e.mjs`, `containerPrefix`).
 *
 * By image: when a dev server stops, `@cloudflare/vite-plugin` removes
 * containers with `docker ps --filter ancestor=<its image tag>`. Docker
 * resolves the tag to an image id, and identical builds share one, so a random
 * tag per session does not keep sessions apart: stopping one dev server removed
 * every session's Sandbox containers. The run therefore builds each Sandbox
 * image with its id as `MORPH_DEV_IMAGE_RUN`, which `Dockerfile.sandbox` writes
 * into a label. That makes an image of its own, with the same layers. It is
 * built from the Dockerfile, not on top of anyone's image, so neither side's
 * `ancestor` reaches the other.
 *
 * This keeps a run apart from everything else. Plain `pnpm dev` sessions
 * still share one image, and so still remove each other's containers.
 *
 * Any doubt stops the run instead of falling back to the shared image: a
 * malformed id, no containers, or a container whose image is not built from a
 * local Dockerfile (a pulled image takes no build argument).
 */

export const E2E_WORKER_NAME = /^morph-e2e-[0-9a-f]{12}$/;

/** The build argument `Dockerfile.sandbox` turns into its run label. */
export const DEV_IMAGE_RUN_ARG = "MORPH_DEV_IMAGE_RUN";

interface ContainerConfig {
  class_name?: string;
  image?: string;
  image_vars?: Record<string, string>;
}

/** A local Dockerfile path, as Wrangler resolves `image` against the config. */
function isLocalDockerfile(image: string | undefined): boolean {
  return (
    typeof image === "string" &&
    (image.startsWith("./") || image.startsWith("../") || image.startsWith("/"))
  );
}

/**
 * The Cloudflare plugin's `config` for a run, or undefined outside one. The
 * function edits the containers in place: the plugin merges a returned object
 * with `defu`, which would append a returned `containers` array to the
 * configured one rather than replace it.
 */
export function e2eWorkerConfig(workerName: string | undefined) {
  if (workerName === undefined || workerName === "") return undefined;
  if (!E2E_WORKER_NAME.test(workerName)) {
    throw new Error(
      `E2E_WORKER_NAME_INVALID: MORPH_E2E_WORKER_NAME must be morph-e2e-<12 hex>, not "${workerName}".`,
    );
  }
  return <Config extends { containers?: ContainerConfig[] }>(config: Config) => {
    const containers = config.containers ?? [];
    if (containers.length === 0) {
      throw new Error(
        "E2E_CONTAINERS_MISSING: a container end-to-end run found no containers to give an image of their own.",
      );
    }
    for (const container of containers) {
      if (!isLocalDockerfile(container.image)) {
        throw new Error(
          `E2E_CONTAINER_IMAGE_NOT_BUILT: ${container.class_name ?? "a container"} uses "${container.image}", which is not built here and cannot be given an image of its own.`,
        );
      }
      container.image_vars = { ...container.image_vars, [DEV_IMAGE_RUN_ARG]: workerName };
    }
    return { name: workerName };
  };
}
