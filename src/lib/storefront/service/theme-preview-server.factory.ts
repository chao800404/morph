import { env } from "cloudflare:workers";
import { CloudflareSandboxVitePreviewServer } from "@/lib/storefront/compiler/cloudflare-sandbox-vite-preview-server";
import { readLocalPreviewOrigin } from "@/lib/storefront/compiler/local-preview-host";
import type { ThemePreviewServer } from "@/lib/storefront/compiler/theme-preview-server.types";
import { isProductionEnvironment } from "./storefront-domain-provider";
import { LocalPreviewSidecarClient } from "./local-preview-sidecar-client";
import type {
  LocalPreviewSidecarApplyFilesRequest,
  LocalPreviewSidecarApplyFilesResult,
} from "./local-preview-sidecar.protocol";
import {
  resolveThemePreviewServerHost,
  validateExposedPreviewUrl,
  validateLoopbackPreviewUrl,
  type ExposedPreviewUrlResult,
} from "./theme-preview-server-origin";

/**
 * Server composition root for the Live Preview server.
 *
 * The shape is `theme-worker-deployer.factory`'s, because the question is the
 * same one and the repo has already answered it once: this capability exists in
 * two topologies, and the environment says which one it is running in. A
 * container binding means the sandbox serves the preview. No container, plus a
 * loopback sidecar an operator started plus its token, means a local one does.
 * Anything else is explicitly unavailable rather than a third, half-wired
 * arrangement.
 *
 * The order is deliberate and matches deployment: the sandbox wins whenever it
 * is bound, so a deployment cannot end up running the local transport even if
 * the local variables were somehow set. Then production is refused outright, for
 * the same reason `isProductionEnvironment` gates the operator-managed Theme
 * Worker deployer — a locally-run preview executes Theme code on whatever
 * machine the Worker is on, and there is no such machine to point it at in
 * production.
 *
 * Unlike the deployer factory this cannot report success without a transport:
 * a preview that is not configured has to say so, because the editor's fallback
 * is the lifecycle UI, not a silently empty frame.
 */

export type ThemePreviewServerSelection =
  | Readonly<{
      enabled: true;
      /** Which topology is serving, for logging and for tests. */
      kind: "cloudflare-sandbox" | "local-sidecar";
      /** Exactly the contract, and nothing about which transport it is. */
      server: ThemePreviewServer;
      /** The host the transport is asked to build its address on. */
      previewHostname: string;
      /** Whether an address it returned may be framed, and on which origin. */
      admitAddress(input: {
        url: string;
        env: Record<string, unknown> | undefined;
      }): ExposedPreviewUrlResult;
      /**
       * Applies edited files, for a transport whose filesystem this process
       * cannot reach.
       *
       * Absent on the sandbox, and that is the point rather than a gap: there,
       * the server function holds the container binding and writes into it
       * directly, so file application never had to travel through the transport
       * contract. A sidecar's filesystem is in another process, so here it does.
       */
      applyFiles?: (
        input: LocalPreviewSidecarApplyFilesRequest,
      ) => Promise<LocalPreviewSidecarApplyFilesResult>;
    }>
  | Readonly<{ enabled: false; reason: string; message: string }>;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function createServerThemePreviewServer(
  bindings: Record<string, unknown> = env as unknown as Record<string, unknown>,
): ThemePreviewServerSelection {
  const sandboxBinding = bindings.Sandbox;

  if (sandboxBinding) {
    const host = resolveThemePreviewServerHost({
      configuredPreviewHostname: readString(bindings.THEME_PREVIEW_HOSTNAME) ?? undefined,
      env: bindings,
    });
    if (!host.enabled) {
      return {
        enabled: false,
        reason: host.reason,
        message:
          "The Live Preview server needs its own hostname, separate from every Morph hostname.",
      };
    }
    return {
      enabled: true,
      kind: "cloudflare-sandbox",
      server: new CloudflareSandboxVitePreviewServer({ sandboxBinding }),
      previewHostname: host.hostname,
      admitAddress: ({ url, env: requestEnv }) =>
        validateExposedPreviewUrl({ url, hostname: host.hostname, env: requestEnv }),
    };
  }

  const localOrigin = readString(bindings.MORPH_LOCAL_THEME_PREVIEW_ORIGIN);
  const localToken = readString(bindings.MORPH_LOCAL_THEME_PREVIEW_TOKEN);

  if (localOrigin && localToken && !isProductionEnvironment(bindings)) {
    const origin = readLocalPreviewOrigin(localOrigin);
    if (!origin.ok) {
      return {
        enabled: false,
        reason: "INVALID_LOCAL_THEME_PREVIEW_ORIGIN",
        message: origin.reason,
      };
    }
    const client = new LocalPreviewSidecarClient({
      origin: localOrigin,
      token: localToken,
    });
    return {
      enabled: true,
      kind: "local-sidecar",
      server: client,
      previewHostname: origin.hostname,
      admitAddress: ({ url }) => validateLoopbackPreviewUrl({ url }),
      applyFiles: (input) => client.applyFiles(input),
    };
  }

  return {
    enabled: false,
    reason: "PREVIEW_TRANSPORT_UNAVAILABLE",
    message:
      "No Live Preview server is configured. Bind the Sandbox container, or set MORPH_LOCAL_THEME_PREVIEW_ORIGIN and MORPH_LOCAL_THEME_PREVIEW_TOKEN for a locally-run preview.",
  };
}
