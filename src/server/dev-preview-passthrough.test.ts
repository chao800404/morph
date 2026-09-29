// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  DEV_PREVIEW_PASSTHROUGH_HEADER,
  DEV_PREVIEW_PASSTHROUGH_PATH,
  isDevPreviewHost,
  restoreDevPreviewRequest,
} from "./dev-preview-passthrough";

describe("isDevPreviewHost", () => {
  it.each([
    "5173-d71a98ea08efb7c153cfb496c699d0dd-token.preview.localhost:3100",
    "5173-abc.preview.localhost",
  ])("parks the preview host %s", (host) => {
    expect(isDevPreviewHost(host, "preview.localhost")).toBe(true);
  });

  it.each([
    "localhost:3100",
    "preview.localhost",
    "evil.preview.localhost",
    "5173-abc.preview.localhost.evil.test",
    "shop.localtest.me:3000",
    undefined,
  ])("leaves %s to Morph's own dev server", (host) => {
    expect(isDevPreviewHost(host, "preview.localhost")).toBe(false);
  });
});

describe("restoreDevPreviewRequest", () => {
  const origin = "http://5173-abc-token.preview.localhost:3100";

  it("gives back the path and query the browser asked for", async () => {
    const parked = new Request(`${origin}${DEV_PREVIEW_PASSTHROUGH_PATH}`, {
      method: "POST",
      headers: {
        [DEV_PREVIEW_PASSTHROUGH_HEADER]: "/_serverFn/abc?x=1",
        cookie: "compat_count=2",
      },
      body: "payload",
    });
    const restored = restoreDevPreviewRequest(parked)!;
    expect(restored.url).toBe(`${origin}/_serverFn/abc?x=1`);
    expect(restored.method).toBe("POST");
    expect(restored.headers.get("cookie")).toBe("compat_count=2");
    expect(restored.headers.has(DEV_PREVIEW_PASSTHROUGH_HEADER)).toBe(false);
    expect(await restored.text()).toBe("payload");
  });

  it("ignores requests that were not parked", () => {
    expect(
      restoreDevPreviewRequest(
        new Request(`${origin}/src/router.tsx`, {
          headers: { [DEV_PREVIEW_PASSTHROUGH_HEADER]: "/elsewhere" },
        }),
      ),
    ).toBeNull();
  });

  it.each(["//evil.test/x", "https://evil.test/x", "relative", ""])(
    "refuses an original of %j that is not a path on the same host",
    (original) => {
      expect(
        restoreDevPreviewRequest(
          new Request(`${origin}${DEV_PREVIEW_PASSTHROUGH_PATH}`, {
            headers: { [DEV_PREVIEW_PASSTHROUGH_HEADER]: original },
          }),
        ),
      ).toBeNull();
    },
  );
});
