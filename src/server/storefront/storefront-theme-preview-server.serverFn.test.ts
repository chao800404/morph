import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import {
  recordPreviewStartFailure,
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

describe("recording why a preview failed to start", () => {
  it("logs the cause and returns only a reference", () => {
    const logged: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((line: unknown) => {
        logged.push(String(line));
      });
    try {
      const traceId = recordPreviewStartFailure({
        stage: "preview-server-start",
        errorMessage: "listen EADDRINUSE :::5173",
        logs: Array.from({ length: 60 }, (_, index) => `line-${index}`),
        storefrontId: "storefront",
        themeId: "theme",
        previewId: "preview",
      });

      expect(traceId).toMatch(/^[0-9a-f]{8}$/);
      const record = JSON.parse(logged[0]!);
      expect(record.scope).toBe("storefront.preview.start");
      expect(record.traceId).toBe(traceId);
      // The stage alone could not tell a taken port from a dead process.
      expect(record.errorMessage).toBe("listen EADDRINUSE :::5173");
      // The tail is where a start failure explains itself.
      expect(record.logs).toHaveLength(40);
      expect(record.logs.at(-1)).toBe("line-59");
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps container output out of anything the browser could read", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const traceId = recordPreviewStartFailure({
        stage: "preview-server-start",
        errorMessage: "/workspace/node_modules/.vite is not writable",
        logs: ["/workspace/internal/path"],
        storefrontId: "storefront",
        themeId: "theme",
        previewId: "preview",
      });
      // Everything the handler puts in front of the author is this id.
      expect(traceId).not.toContain("/workspace");
      expect(traceId).toHaveLength(8);
    } finally {
      spy.mockRestore();
    }
  });
});
