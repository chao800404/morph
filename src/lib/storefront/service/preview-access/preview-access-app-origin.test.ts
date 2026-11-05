import { describe, expect, it } from "vitest";
import { isMorphAppOrigin } from "./preview-access-app-origin";

const env = {
  PUBLIC_URL: "https://cms.example.com/dashboard",
  MORPH_CMS_HOSTNAME: "admin.example.com",
  MORPH_PLATFORM_HOSTNAMES: "staging.example.com, edit.example.com",
};

describe("Morph's own app origins, for the begin page's parent", () => {
  it.each([
    "https://cms.example.com",
    "https://admin.example.com",
    "https://staging.example.com",
    "https://edit.example.com",
  ])("believes %s exactly", (origin) => {
    expect(isMorphAppOrigin(origin, env, false)).toBe(true);
  });

  it.each([
    ["another port", "https://cms.example.com:8443"],
    ["another scheme", "http://cms.example.com"],
    ["a subdomain", "https://evil.cms.example.com"],
    ["a path", "https://cms.example.com/x"],
    ["loopback in production", "http://localhost:1234"],
    ["a platform host Morph does not serve the app on", "https://localhost"],
    ["nonsense", "not an origin"],
  ])("refuses %s", (_name, origin) => {
    expect(isMorphAppOrigin(origin, env, false)).toBe(false);
  });

  it("believes a loopback editor only on a development server", () => {
    expect(isMorphAppOrigin("http://localhost:3417", env, true)).toBe(true);
    expect(isMorphAppOrigin("http://127.0.0.1:3000", env, true)).toBe(true);
    expect(isMorphAppOrigin("http://localhost:3417", env, false)).toBe(false);
  });
});
