// @vitest-environment node
import { describe, expect, it } from "vitest";
import { uncacheablePreviewError } from "./preview-proxy-response";

describe("uncacheablePreviewError", () => {
  it("forbids storing a refusal, keeping everything else about it", async () => {
    const refused = new Response(
      JSON.stringify({ code: "STALE_PREVIEW_URL" }),
      {
        status: 410,
        statusText: "Gone",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "max-age=3600",
        },
      },
    );

    const response = uncacheablePreviewError(refused);

    expect(response.status).toBe(410);
    expect(response.statusText).toBe("Gone");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toEqual({ code: "STALE_PREVIEW_URL" });
  });

  it("covers every error status, not only 410", () => {
    for (const status of [404, 500, 502]) {
      expect(
        uncacheablePreviewError(new Response(null, { status })).headers.get(
          "Cache-Control",
        ),
      ).toBe("no-store");
    }
  });

  it("returns a successful response untouched", () => {
    const ok = new Response("export {}", {
      headers: { "Cache-Control": "no-cache", ETag: 'W/"1"' },
    });
    expect(uncacheablePreviewError(ok)).toBe(ok);
  });
});
