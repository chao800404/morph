import { isProductionEnvironment } from "../storefront-domain-provider";
import { previewSandboxBinding } from "../preview-sandbox-binding";
import type { BuildPreviewServer } from "./build-preview-server.types";
import { LocalBuildPreviewServerClient } from "./local-build-preview-client";
import { CloudflareSandboxBuildPreviewServer } from "./cloudflare-sandbox-build-preview-server";

/**
 * Which `BuildPreviewServer` this environment has, chosen the way
 * `theme-preview-server.factory` chooses the Live Preview's: by the bindings
 * present, never by a flag. `BuildPreviewSandbox` bound means the container
 * transport. Containers bound but not that class is refused by name rather
 * than run under another class's policy or handed to the local transport.
 * Without containers, the operator-started helper process serves, outside
 * production only.
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
  const binding = bindings.BuildPreviewSandbox;
  if (binding) {
    return {
      enabled: true,
      server: new CloudflareSandboxBuildPreviewServer({
        provider: {
          async getSandbox(name) {
            const { getSandbox } = await import("@cloudflare/sandbox");
            return getSandbox(binding as never, name) as never;
          },
        },
      }),
    };
  }
  if (previewSandboxBinding(bindings) || bindings.Sandbox) {
    return {
      enabled: false,
      reason: "BUILD_PREVIEW_SANDBOX_UNBOUND",
      message:
        "Build Preview needs the BuildPreviewSandbox binding, which runs previews under their own outbound policy.",
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
