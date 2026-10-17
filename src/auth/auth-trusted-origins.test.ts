import type { D1Database } from "@cloudflare/workers-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cmsDevTrustedOrigins,
  cmsTrustedOrigins,
} from "@/lib/config/trusted-origins";
import { buildAuthTrustedOrigins } from "./auth-trusted-origins";
import { createAuth, createStorefrontAuth, type CloudflareBindings } from "./index";

const DEV_ORIGIN = "http://localhost:3000";
const LAN_HTTP = "http://192.168.31.105:3000";
const LAN_HTTPS = "https://192.168.31.105:3000";
const DEV_ORIGINS = [DEV_ORIGIN, LAN_HTTP, LAN_HTTPS];
const CMS = ["https://cms.example"];

function build(overrides: Partial<Parameters<typeof buildAuthTrustedOrigins>[0]>) {
  return buildAuthTrustedOrigins({
    baseURL: DEV_ORIGIN,
    isProduction: false,
    cmsTrustedOrigins: CMS,
    cmsDevTrustedOrigins: [LAN_HTTP, LAN_HTTPS],
    additionalTrustedOrigins: [],
    ...overrides,
  });
}

function expectNoDevOrigins(list: readonly string[], except?: string) {
  for (const origin of DEV_ORIGINS) {
    if (origin !== except) expect(list).not.toContain(origin);
  }
}

function bindings(extra: Record<string, string>): CloudflareBindings {
  return { DATABASE: {} as D1Database, ...extra } as CloudflareBindings;
}

describe("trusted-origins config", () => {
  it("lists exactly the owner's LAN machine as dev-only and nothing for every environment", () => {
    expect(cmsDevTrustedOrigins).toEqual([LAN_HTTP, LAN_HTTPS]);
    expect(cmsTrustedOrigins).toEqual([]);
  });
});

describe("buildAuthTrustedOrigins", () => {
  it("adds the dev list outside production with a loopback baseURL", () => {
    for (const baseURL of [
      "http://localhost:3001",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
      "http://morph.localhost:3000",
    ]) {
      const list = build({ baseURL });
      for (const origin of DEV_ORIGINS) expect(list).toContain(origin);
    }
  });

  it("adds the dev list outside production when baseURL is exactly a listed dev origin", () => {
    for (const baseURL of [LAN_HTTP, LAN_HTTPS]) {
      const list = build({ baseURL });
      for (const origin of DEV_ORIGINS) expect(list).toContain(origin);
    }
  });

  it("adds no dev origin in production, even when baseURL is loopback or the LAN machine", () => {
    for (const baseURL of ["http://localhost:3001", LAN_HTTP]) {
      expect(build({ baseURL, isProduction: true })).toEqual([...CMS, baseURL]);
    }
  });

  it("fails closed outside production on any other private address", () => {
    for (const baseURL of [
      "http://192.168.31.106:3000",
      "http://10.0.0.5:3000",
      "http://172.16.0.1:3000",
      "http://192.168.31.105:3001",
    ]) {
      expect(build({ baseURL })).toEqual([...CMS, baseURL]);
    }
  });

  it("fails closed outside production on a public or unparsable baseURL", () => {
    // The NODE_ENV replacement broke: production reads as false, but the
    // configured origin is still a public one.
    expect(build({ baseURL: "https://shop.example" })).toEqual([
      ...CMS,
      "https://shop.example",
    ]);
    expectNoDevOrigins(build({ baseURL: "not a url" }));
  });

  it("is exactly baseURL, cmsTrustedOrigins and the additional origins in production", () => {
    expect(
      build({
        baseURL: "https://shop.example",
        isProduction: true,
        additionalTrustedOrigins: ["https://store.example"],
      }),
    ).toEqual([...CMS, "https://shop.example", "https://store.example"]);
  });

  it("removes duplicates", () => {
    expect(
      build({
        cmsTrustedOrigins: [DEV_ORIGIN],
        additionalTrustedOrigins: [LAN_HTTP],
      }),
    ).toEqual(DEV_ORIGINS);
  });
});

describe("createAuth trustedOrigins", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("trusts only the configured PUBLIC_URL in production", () => {
    const auth = createAuth(
      bindings({ ENVIRONMENT: "production", PUBLIC_URL: "https://shop.example" }),
      "https://shop.example/api/auth/get-session",
    );
    expect(auth.options.trustedOrigins).toEqual(["https://shop.example"]);
  });

  it("adds no dev origin when only NODE_ENV says production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const auth = createAuth(
      bindings({ PUBLIC_URL: "https://shop.example" }),
      "http://localhost:3000/api/auth/get-session",
    );
    // In production the request is ignored and PUBLIC_URL is the baseURL.
    expect(auth.options.baseURL).toBe("https://shop.example");
    expect(auth.options.trustedOrigins).toEqual(["https://shop.example"]);
  });

  it("adds no dev origin in production even when PUBLIC_URL is the LAN machine", () => {
    const auth = createAuth(
      bindings({ ENVIRONMENT: "production", PUBLIC_URL: LAN_HTTP }),
      `${LAN_HTTP}/api/auth/get-session`,
    );
    // The configured origin is trusted as baseURL; nothing from the dev list is added.
    expect(auth.options.trustedOrigins).toEqual([LAN_HTTP]);
  });

  it("adds no dev origin in production even when PUBLIC_URL is loopback", () => {
    const auth = createAuth(
      bindings({ ENVIRONMENT: "production", PUBLIC_URL: "http://localhost:4000" }),
      "http://localhost:4000/api/auth/get-session",
    );
    expect(auth.options.trustedOrigins).toEqual(["http://localhost:4000"]);
  });

  it("documents a remaining exception: unconfigured production falls back to localhost:3000 as baseURL", () => {
    // Not changed by this fix. With neither PUBLIC_URL nor BETTER_AUTH_URL
    // set, the configured chain ends at DEFAULT_DEV_ORIGIN, and baseURL is
    // always trusted.
    vi.stubEnv("PUBLIC_URL", "");
    vi.stubEnv("BETTER_AUTH_URL", "");
    const auth = createAuth(
      bindings({ ENVIRONMENT: "production" }),
      "https://shop.example/api/auth/get-session",
    );
    expect(auth.options.baseURL).toBe(DEV_ORIGIN);
    expect(auth.options.trustedOrigins).toEqual([DEV_ORIGIN]);
  });

  it("trusts the dev list in dev on a loopback origin", () => {
    const auth = createAuth(
      bindings({ PUBLIC_URL: "https://morph.example.workers.dev" }),
      "http://localhost:3005/api/auth/get-session",
    );
    expect(auth.options.trustedOrigins).toEqual([
      "http://localhost:3005",
      ...DEV_ORIGINS,
    ]);
  });

  it("trusts the dev list in dev when served from the LAN machine", () => {
    const auth = createAuth(
      bindings({ PUBLIC_URL: "https://morph.example.workers.dev" }),
      `${LAN_HTTP}/api/auth/get-session`,
    );
    expect(auth.options.trustedOrigins).toEqual([LAN_HTTP, DEV_ORIGIN, LAN_HTTPS]);
  });

  it("adds no dev origin in dev when served from another private address", () => {
    const auth = createAuth(
      bindings({ PUBLIC_URL: "https://morph.example.workers.dev" }),
      "http://192.168.31.106:3000/api/auth/get-session",
    );
    expect(auth.options.trustedOrigins).toEqual(["http://192.168.31.106:3000"]);
  });

  it("adds no dev origin outside production on a public origin", () => {
    const auth = createAuth(
      bindings({ PUBLIC_URL: "https://shop.example" }),
      "https://preview.example/api/auth/get-session",
    );
    expect(auth.options.trustedOrigins).toEqual(["https://preview.example"]);
  });

  it("trusts no cmsapp.org origin in any environment", () => {
    // An expired deployment domain: anyone can register it now.
    const lists = [
      createAuth(
        bindings({ ENVIRONMENT: "production", PUBLIC_URL: "https://shop.example" }),
        "https://shop.example/",
      ),
      createAuth(bindings({ ENVIRONMENT: "production", PUBLIC_URL: LAN_HTTP }), null),
      createAuth(bindings({ PUBLIC_URL: "https://shop.example" }), "http://localhost:3000/"),
      createAuth(bindings({ PUBLIC_URL: "https://shop.example" }), `${LAN_HTTP}/`),
      createAuth(bindings({ PUBLIC_URL: "https://shop.example" }), "https://preview.example/"),
      createStorefrontAuth(
        bindings({ ENVIRONMENT: "production", PUBLIC_URL: "https://shop.example" }),
        "https://store.example/",
        "store.example",
      ),
    ].map((auth) => auth.options.trustedOrigins as string[]);
    for (const list of lists) {
      expect(list.some((origin) => origin.includes("cmsapp.org"))).toBe(false);
    }
  });

  it("gives a storefront baseURL and its own origin, nothing else", () => {
    const auth = createStorefrontAuth(
      bindings({ ENVIRONMENT: "production", PUBLIC_URL: "https://shop.example" }),
      "https://store.example/api/auth/get-session",
      "store.example",
    );
    expect(auth.options.trustedOrigins).toEqual([
      "https://shop.example",
      "https://store.example",
    ]);
  });
});
