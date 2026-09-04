import { describe, expect, it, vi } from "vitest";

import {
  BrowserRunScreenshotter,
  createBrowserRunScreenshotter,
} from "./browser-run-screenshot.service";

function okResponse(bytes = new Uint8Array([1, 2, 3])) {
  return new Response(bytes, { status: 200 });
}

describe("createBrowserRunScreenshotter", () => {
  it("returns null until the deployment has credentials", () => {
    // Capture is optional infrastructure: without a token, publishing must
    // still work and simply produce no picture.
    expect(createBrowserRunScreenshotter({})).toBeNull();
    expect(
      createBrowserRunScreenshotter({ CLOUDFLARE_ACCOUNT_ID: "acct" }),
    ).toBeNull();
    expect(
      createBrowserRunScreenshotter({ BROWSER_RENDERING_API_TOKEN: "tok" }),
    ).toBeNull();
    expect(
      createBrowserRunScreenshotter({
        CLOUDFLARE_ACCOUNT_ID: "",
        BROWSER_RENDERING_API_TOKEN: "tok",
      }),
    ).toBeNull();
  });

  it("builds a screenshotter once both are present", () => {
    expect(
      createBrowserRunScreenshotter({
        CLOUDFLARE_ACCOUNT_ID: "acct",
        BROWSER_RENDERING_API_TOKEN: "tok",
      }),
    ).toBeInstanceOf(BrowserRunScreenshotter);
  });
});

describe("BrowserRunScreenshotter", () => {
  it("asks Browser Run for the requested viewport", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const shot = new BrowserRunScreenshotter({
      accountId: "acct",
      apiToken: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const bytes = await shot.capture({
      url: "https://shop.example.com/",
      width: 390,
      height: 844,
    });

    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct/browser-rendering/screenshot",
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
    const body = JSON.parse(init.body as string);
    expect(body.url).toBe("https://shop.example.com/");
    expect(body.viewport).toMatchObject({ width: 390, height: 844 });
  });

  it("captures at 2x so the card is not blurry on a dense display", () => {
    // Browser Run defaults deviceScaleFactor to 1, and the card renders these
    // images small — at 1x the storefront's own text is unreadable in them.
    const fetchImpl = vi.fn(async () => okResponse());
    return new BrowserRunScreenshotter({
      accountId: "acct",
      apiToken: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
      .capture({ url: "https://shop.example.com/", width: 1440, height: 900 })
      .then(() => {
        const body = JSON.parse(
          (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]
            .body as string,
        );
        expect(body.viewport.deviceScaleFactor).toBe(2);
        expect(body.screenshotOptions.fullPage).toBe(false);
      });
  });

  it("carries Cloudflare's reason into the error", async () => {
    // A bad token, a daily cap and an unreachable page all fail here, and
    // without the body they would be indistinguishable in the logs.
    const fetchImpl = vi.fn(
      async () =>
        new Response("Browser time limit exceeded for today", { status: 429 }),
    );
    const shot = new BrowserRunScreenshotter({
      accountId: "acct",
      apiToken: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      shot.capture({
        url: "https://shop.example.com/",
        width: 1440,
        height: 900,
      }),
    ).rejects.toThrow(/429.*Browser time limit exceeded/);
  });
});
