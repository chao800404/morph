// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  isSandboxPreviewRequest,
  previewRequestFor,
  previewRequestHeaders,
  withoutPlatformCookies,
} from "./preview-proxy-credentials";
import { finishPreviewResponse } from "./preview-proxy-response";

const ENV = { THEME_PREVIEW_HOSTNAME: "preview.example.net" };
const PREVIEW_URL = "https://5173-abc123-tok_en.preview.example.net/page";

describe("which requests go to a preview container", () => {
  it("is a <port>- label directly under the configured preview host", () => {
    expect(isSandboxPreviewRequest(new URL(PREVIEW_URL), ENV)).toBe(true);
  });

  it("is nothing else, so Morph's own requests keep their body", () => {
    for (const url of [
      "https://preview.example.net/",
      "https://admin.example.com/api/thing",
      "https://5173-abc-tok.admin.example.com/",
      "https://www.preview.example.net/",
      "https://5173-abc-tok.x.preview.example.net/",
      "http://localhost:3000/",
    ]) {
      expect(isSandboxPreviewRequest(new URL(url), ENV)).toBe(false);
    }
  });

  it("is nothing at all when no preview host is configured", () => {
    expect(isSandboxPreviewRequest(new URL(PREVIEW_URL), {})).toBe(false);
  });
});

describe("what of a request reaches Theme code", () => {
  it("removes the platform's credential cookies and keeps the Theme's", () => {
    const headers = previewRequestHeaders(
      new Headers({
        cookie:
          "cart=3; better-auth.session_token=secret; __Secure-better-auth.session_data=x; theme_session=abc; verify_access=y",
      }),
    );
    expect(headers.get("cookie")).toBe("cart=3; theme_session=abc");
  });

  it("drops the Cookie header when nothing in it is the Theme's", () => {
    const headers = previewRequestHeaders(
      new Headers({ cookie: "better-auth.session_token=secret" }),
    );
    expect(headers.has("cookie")).toBe(false);
  });

  it("removes x-morph- headers and keeps Authorization and the rest", () => {
    const headers = previewRequestHeaders(
      new Headers({
        authorization: "Bearer theme-token",
        "x-morph-storefront-id": "forged",
        "X-Morph-Release-Id": "forged",
        accept: "text/html",
      }),
    );
    expect(headers.get("authorization")).toBe("Bearer theme-token");
    expect(headers.get("accept")).toBe("text/html");
    expect(headers.has("x-morph-storefront-id")).toBe(false);
    expect(headers.has("x-morph-release-id")).toBe(false);
  });

  it("carries the method and body of a Theme request", async () => {
    const forwarded = previewRequestFor(
      new Request(PREVIEW_URL, {
        method: "POST",
        headers: { cookie: "better-auth.session_token=s; cart=1" },
        body: "form=1",
      }),
    );
    expect(forwarded.method).toBe("POST");
    expect(forwarded.url).toBe(PREVIEW_URL);
    expect(forwarded.headers.get("cookie")).toBe("cart=1");
    expect(await forwarded.text()).toBe("form=1");
  });
});

describe("what of a response reaches the browser", () => {
  const response = (setCookies: string[], init: ResponseInit = {}) => {
    const headers = new Headers(init.headers);
    for (const value of setCookies) headers.append("set-cookie", value);
    return new Response("body", { ...init, headers });
  };

  it("removes a Set-Cookie under a platform credential's name", () => {
    const result = withoutPlatformCookies(
      response([
        "better-auth.session_token=planted; Path=/",
        "__Host-better-auth.session_data=planted; Path=/; Secure",
        "verify_access=planted",
      ]),
    );
    expect(result.headers.getSetCookie()).toEqual([]);
  });

  it("keeps every other Set-Cookie, separately and in order", () => {
    const theme = [
      "a=1; Path=/; HttpOnly",
      "b=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT",
      "c=3; SameSite=None; Secure",
    ];
    const result = withoutPlatformCookies(
      response([theme[0], "better-auth.session_token=x", theme[1], theme[2]]),
    );
    expect(result.headers.getSetCookie()).toEqual(theme);
  });

  it("returns a response with nothing to remove as it is", () => {
    const original = response(["a=1", "b=2"]);
    expect(withoutPlatformCookies(original)).toBe(original);
  });

  it("keeps the Theme's cookies through the whole proxy finish", () => {
    // The finish rebuilds a response for errors and for SVG; neither may
    // join or lose a Set-Cookie.
    const theme = ["a=1; Path=/", "b=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT"];
    for (const init of [
      { status: 500 },
      { status: 200, headers: { "content-type": "image/svg+xml" } },
      { status: 200 },
    ]) {
      const result = finishPreviewResponse(
        response([...theme, "better-auth.session_token=x"], init),
      );
      expect(result.headers.getSetCookie()).toEqual(theme);
    }
  });
});
