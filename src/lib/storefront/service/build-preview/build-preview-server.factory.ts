import { isProductionEnvironment } from "../storefront-domain-provider";
import { previewSandboxBinding } from "../preview-sandbox-binding";
import type { BuildPreviewServer } from "./build-preview-server.types";
import { LocalBuildPreviewServerClient } from "./local-build-preview-client";

/**
 * Which `BuildPreviewServer` this environment has, chosen the way
 * `theme-preview-server.factory` chooses the Live Preview's: by the bindings
 * present, never by a flag. A container binding means the container transport
 * — which is not written yet, so it is refused by name rather than falling
 * through to the local one. Without containers, the operator-started helper
 * process serves, outside production only.
 */
export type BuildPreviewServerSelection =
  | Readonly<{ enabled: true; server: BuildPreviewServer }>
  | Readonly<{ enabled: false; reason: string; message: string }>;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function createBuildPreviewServer(
  bindings: Record<string, unknown>,
): BuildPreviewServerSelection {
  if (previewSandboxBinding(bindings) || bindings.Sandbox) {
    return {
      enabled: false,
      reason: "BUILD_PREVIEW_CONTAINER_PENDING",
      message:
        "Build Preview in a container is not available yet; this deployment has no other way to run one.",
    };
  }
  const origin = readString(bindings.MORPH_LOCAL_THEME_PREVIEW_ORIGIN);
  const token = readString(bindings.MORPH_LOCAL_THEME_PREVIEW_TOKEN);
  if (origin && token && !isProductionEnvironment(bindings)) {
    return {
      enabled: true,
      server: new LocalBuildPreviewServerClient({ origin, token }),
    };
  }
  return {
    enabled: false,
    reason: "BUILD_PREVIEW_UNCONFIGURED",
    message:
      "Build Preview needs the local preview helper (MORPH_LOCAL_THEME_PREVIEW_ORIGIN and _TOKEN) outside production.",
  };
}
