import { describe, expect, it } from "vitest";
import { resolveRemoveBackgroundTarget } from "./remove-background-target";

const requestUrl = "https://cms.example.com/_serverFn/removeBackground";

describe("resolveRemoveBackgroundTarget", () => {
  it("resolves a stored asset path against the request origin", () => {
    expect(
      resolveRemoveBackgroundTarget({ candidate: "/assets/a.png", requestUrl }),
    ).toEqual({ ok: true, url: "https://cms.example.com/assets/a.png" });
  });

  it("accepts an absolute URL on the same origin", () => {
    expect(
      resolveRemoveBackgroundTarget({
        candidate: "https://cms.example.com/assets/a.png",
        requestUrl,
      }),
    ).toEqual({ ok: true, url: "https://cms.example.com/assets/a.png" });
  });

  // The fetch carries the caller's CMS session cookie, so a target outside the
  // origin would hand the session to whoever was named.
  it("refuses anything that leaves the origin", () => {
    for (const candidate of [
      "https://attacker.example/steal.png",
      "http://cms.example.com/assets/a.png", // scheme differs, origin differs
      "//attacker.example/steal.png",
      "https://cms.example.com.attacker.test/a.png",
    ]) {
      expect(
        resolveRemoveBackgroundTarget({ candidate, requestUrl }),
      ).toEqual({ ok: false, reason: "cross-origin" });
    }
  });

  // Internal addresses are the other half of the same problem: an arbitrary
  // server-side fetch reaches things the caller cannot reach directly.
  it("refuses internal and loopback hosts", () => {
    for (const candidate of [
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:8080/admin",
      "http://10.0.0.5/internal",
    ]) {
      expect(
        resolveRemoveBackgroundTarget({ candidate, requestUrl }).ok,
      ).toBe(false);
    }
  });

  it("refuses code-bearing schemes", () => {
    for (const candidate of [
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "file:///etc/passwd",
    ]) {
      expect(
        resolveRemoveBackgroundTarget({ candidate, requestUrl }).ok,
      ).toBe(false);
    }
  });

  it("reports a missing or unusable candidate", () => {
    expect(
      resolveRemoveBackgroundTarget({ candidate: null, requestUrl }),
    ).toEqual({ ok: false, reason: "missing" });
    expect(
      resolveRemoveBackgroundTarget({ candidate: "   ", requestUrl }),
    ).toEqual({ ok: false, reason: "missing" });
  });
});
