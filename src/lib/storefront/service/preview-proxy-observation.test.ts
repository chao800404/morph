// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimStateLookup,
  observePreviewProxyResponse,
  previewResponseObservation,
  previewRouteFromHostname,
  readPreviewErrorCode,
} from "./preview-proxy-observation";

const HOST =
  "5173-5f919496efe1c5c71e5c59c2aea22425-oyoqfh6fzfykvtz2.preview.localhost";

const staleResponse = () =>
  new Response(
    JSON.stringify({
      error: "Preview URL is stale because the sandbox runtime is not active",
      code: "STALE_PREVIEW_URL",
    }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  );

const observedLines = () => {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  return {
    lines: () =>
      spy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.startsWith("[preview-observe] proxy ")),
    fields: () =>
      spy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.startsWith("[preview-observe] proxy "))
        .map((line) =>
          JSON.parse(line.slice("[preview-observe] proxy ".length)),
        ),
  };
};

afterEach(() => vi.restoreAllMocks());

describe("previewRouteFromHostname", () => {
  it("reads the port and sandbox the way the SDK does, and drops the token", () => {
    expect(previewRouteFromHostname(HOST)).toEqual({
      port: 5173,
      sandboxId: "5f919496efe1c5c71e5c59c2aea22425",
    });
  });

  it("refuses hosts that are not preview hosts", () => {
    expect(previewRouteFromHostname("localhost")).toBeNull();
    expect(previewRouteFromHostname("admin.example.com")).toBeNull();
    expect(previewRouteFromHostname("5173-onlyone.example.com")).toBeNull();
    expect(previewRouteFromHostname("abc-sbx-tok.example.com")).toBeNull();
  });
});

describe("previewResponseObservation", () => {
  it("records errors and very slow successes, nothing else", () => {
    expect(previewResponseObservation(410, 4)).toBe("error");
    expect(previewResponseObservation(200, 6_000)).toBe("slow");
    expect(previewResponseObservation(200, 40)).toBeNull();
    expect(previewResponseObservation(304, 40)).toBeNull();
  });
});

describe("readPreviewErrorCode", () => {
  it("reads the SDK's code from a JSON error body", async () => {
    expect(await readPreviewErrorCode(staleResponse())).toBe(
      "STALE_PREVIEW_URL",
    );
    expect(
      await readPreviewErrorCode(new Response("nope", { status: 500 })),
    ).toBeNull();
  });
});

describe("claimStateLookup", () => {
  it("allows one lookup per sandbox per window", () => {
    expect(claimStateLookup("sbx-a", 10_000)).toBe(true);
    expect(claimStateLookup("sbx-a", 11_000)).toBe(false);
    expect(claimStateLookup("sbx-b", 11_000)).toBe(true);
    expect(claimStateLookup("sbx-a", 12_500)).toBe(true);
  });
});

describe("observePreviewProxyResponse", () => {
  it("records a refused request with the container's state at the time", async () => {
    const log = observedLines();
    const readContainerState = vi.fn(async () => "running");
    await observePreviewProxyResponse({
      request: new Request(
        `http://${HOST}:3000/__morph-theme-preview__/src/components/Hero.tsx?t=1`,
      ),
      responseForBody: staleResponse(),
      status: 410,
      durationMs: 4,
      readContainerState,
    });

    expect(readContainerState).toHaveBeenCalledWith(
      "5f919496efe1c5c71e5c59c2aea22425",
    );
    expect(log.fields()).toEqual([
      expect.objectContaining({
        kind: "error",
        previewId: "5f919496efe1c5c71e5c59c2aea22425",
        port: 5173,
        method: "GET",
        path: "/__morph-theme-preview__/src/components/Hero.tsx",
        status: 410,
        code: "STALE_PREVIEW_URL",
        durationMs: 4,
        containerState: "running",
      }),
    ]);
    expect(log.lines().join("\n")).not.toContain("oyoqfh6fzfykvtz2");
  });

  it("does not ask the container about errors other than a refusal", async () => {
    const log = observedLines();
    const readContainerState = vi.fn(async () => "healthy");
    await observePreviewProxyResponse({
      request: new Request(`http://${HOST}/missing.ts`),
      responseForBody: new Response("", { status: 404 }),
      status: 404,
      durationMs: 3,
      readContainerState,
    });
    expect(readContainerState).not.toHaveBeenCalled();
    expect(log.fields()[0]).toMatchObject({
      status: 404,
      containerState: null,
    });
  });

  it("says when the state could not be read", async () => {
    const log = observedLines();
    await observePreviewProxyResponse({
      request: new Request(
        "http://5173-sbx-lookup-fails-tok.preview.localhost/a.ts",
      ),
      responseForBody: staleResponse(),
      status: 410,
      durationMs: 5,
      readContainerState: async () => {
        throw new Error("boom");
      },
    });
    expect(log.fields()[0].containerState).toBe("lookup-failed:boom");
  });

  it("writes nothing for an ordinary response", async () => {
    const log = observedLines();
    await observePreviewProxyResponse({
      request: new Request(`http://${HOST}/a.ts`),
      responseForBody: null,
      status: 200,
      durationMs: 30,
      readContainerState: async () => "healthy",
    });
    expect(log.lines()).toEqual([]);
  });
});
