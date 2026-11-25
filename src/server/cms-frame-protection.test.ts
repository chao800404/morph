// @vitest-environment node
import { describe, expect, it } from "vitest";
import { withCmsFrameProtection } from "./cms-frame-protection";

describe("withCmsFrameProtection", () => {
  it("lets only the CMS frame its own HTML documents", async () => {
    const response = withCmsFrameProtection(
      new Response("<!doctype html><title>Dashboard</title>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    expect(response.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'self'",
    );
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      "<!doctype html><title>Dashboard</title>",
    );
  });

  it("covers error documents too", () => {
    const response = withCmsFrameProtection(
      new Response("<h1>Not found</h1>", {
        status: 404,
        headers: { "content-type": "text/html" },
      }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("keeps a document's own framing policy (the previews' sandbox)", () => {
    const own = new Response("<html></html>", {
      headers: {
        "content-type": "text/html",
        "content-security-policy": "sandbox allow-scripts",
        "x-frame-options": "SAMEORIGIN",
      },
    });
    const response = withCmsFrameProtection(own);
    expect(response).toBe(own);
    expect(response.headers.get("content-security-policy")).toBe(
      "sandbox allow-scripts",
    );
  });

  it("leaves non-HTML responses alone", () => {
    const json = new Response("{}", {
      headers: { "content-type": "application/json" },
    });
    expect(withCmsFrameProtection(json)).toBe(json);
    expect(json.headers.has("x-frame-options")).toBe(false);
  });
});
