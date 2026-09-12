import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  startThemePreviewServer,
  stopThemePreviewServer,
} from "./storefront-theme-preview-server.serverFn";
import { resolveThemePreviewServerHost } from "@/lib/storefront/service/theme-preview-server-origin";

describe("storefront-theme-preview-server.serverFn", () => {
  it("exports server functions", () => {
    expect(startThemePreviewServer).toBeDefined();
    expect(stopThemePreviewServer).toBeDefined();
  });

  it("is off until a deployment gives the preview its own hostname", () => {
    // The decision this server function makes before touching a container, on
    // an environment with nothing configured: the Live Preview server stays
    // off rather than falling back to somewhere it should not run.
    const configured = (env as unknown as { THEME_PREVIEW_HOSTNAME?: string })
      .THEME_PREVIEW_HOSTNAME;
    expect(configured).toBeUndefined();

    expect(
      resolveThemePreviewServerHost({
        configuredPreviewHostname: configured,
        env: env as unknown as Record<string, unknown>,
      }),
    ).toEqual({ enabled: false, reason: "MISSING_PREVIEW_HOST" });
  });
});
