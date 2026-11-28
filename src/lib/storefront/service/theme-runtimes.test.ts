import { describe, expect, it } from "vitest";
import { createThemeRuntime } from "./storefront-request-routing";
import type { ResolvedStorefrontHost } from "./storefront-host-resolver";
import {
  ServiceBindingThemeRuntime,
  type ThemeServiceBinding,
} from "./theme-runtimes";

const HOST = "shop.example.com";
const resolved = {
  hostname: HOST,
  storefrontId: "sf_1",
  releaseId: "rel_1",
  themeBuildId: "bld_1",
  contentPublicationId: "pub_1",
} as unknown as ResolvedStorefrontHost;

/**
 * Mimics a real Cloudflare service binding. In workerd a `Fetcher` with JS RPC
 * support reports `true` for `"<any name>" in binding`, returns a callable for
 * every property, and has no own keys. Plain `{ fetch }` test doubles hide all
 * of that, which is how `"unmapped" in value` reached staging.
 */
function rpcStubLikeBinding(
  fetch: (request: Request) => Promise<Response>,
): ThemeServiceBinding {
  return new Proxy(Object.create(null) as object, {
    has: () => true,
    get: (_target, property) =>
      property === "fetch" ? fetch : () => Promise.resolve(undefined),
    ownKeys: () => [],
  }) as ThemeServiceBinding;
}

describe("ServiceBindingThemeRuntime with an RPC-stub-like binding", () => {
  it("forwards to a binding that claims every property", async () => {
    let seen: Request | null = null;
    const binding = rpcStubLikeBinding(async (request) => {
      seen = request;
      return new Response("themed");
    });
    // What a real Fetcher answers, and what the old shape check looked for.
    expect("unmapped" in binding).toBe(true);
    expect("ok" in binding).toBe(true);

    const result = await new ServiceBindingThemeRuntime(() => ({
      ok: true,
      binding,
    })).handle({ request: new Request(`https://${HOST}/`), resolved });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(await result.response.text()).toBe("themed");
    expect(seen!.headers.get("x-morph-storefront-id")).toBe("sf_1");
  });

  it("forwards through createThemeRuntime with only THEME_WORKER bound", async () => {
    // The staging configuration: THEME_WORKER bound, no MORPH_THEME_SERVICE_BINDINGS.
    const runtime = createThemeRuntime({
      THEME_WORKER: rpcStubLikeBinding(async () => new Response("themed")),
    });
    expect(runtime.kind).toBe("service-binding");

    const result = await runtime.handle({
      request: new Request(`https://${HOST}/`),
      resolved,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(await result.response.text()).toBe("themed");
  });

  it("forwards through a storefront map to an RPC-stub-like binding", async () => {
    const runtime = createThemeRuntime({
      MORPH_THEME_SERVICE_BINDINGS: '{"sf_1":"THEME_WORKER_A"}',
      THEME_WORKER_A: rpcStubLikeBinding(async () => new Response("themed A")),
    });

    const result = await runtime.handle({
      request: new Request(`https://${HOST}/`),
      resolved,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(await result.response.text()).toBe("themed A");
  });
});

describe("ServiceBindingThemeRuntime misses", () => {
  it("reports the resolver's subcode", async () => {
    const result = await new ServiceBindingThemeRuntime(() => ({
      ok: false,
      unmapped: "ENTRY_MISSING",
    })).handle({ request: new Request(`https://${HOST}/`), resolved });

    expect(result.success).toBe(false);
    if (result.success || result.reason !== "RUNTIME_NOT_CONFIGURED") {
      throw new Error("expected RUNTIME_NOT_CONFIGURED");
    }
    expect(result.reason).toBe("RUNTIME_NOT_CONFIGURED");
    expect(result.status).toBe(503);
    expect(result.notConfigured).toEqual({
      code: "BINDING_UNMAPPED",
      subcode: "ENTRY_MISSING",
    });
  });

  it("refuses a storefront the map leaves out, even when other stubs are bound", async () => {
    const runtime = createThemeRuntime({
      MORPH_THEME_SERVICE_BINDINGS: '{"sf_other":"THEME_WORKER_B"}',
      THEME_WORKER: rpcStubLikeBinding(async () => new Response("wrong")),
      THEME_WORKER_B: rpcStubLikeBinding(async () => new Response("wrong")),
    });

    const result = await runtime.handle({
      request: new Request(`https://${HOST}/`),
      resolved,
    });

    expect(result.success).toBe(false);
    if (result.success || result.reason !== "RUNTIME_NOT_CONFIGURED") {
      throw new Error("expected RUNTIME_NOT_CONFIGURED");
    }
    expect(result.notConfigured).toEqual({
      code: "BINDING_UNMAPPED",
      subcode: "ENTRY_MISSING",
    });
  });

  it("reports a mapped name with nothing bound as BINDING_ABSENT", async () => {
    const runtime = createThemeRuntime({
      MORPH_THEME_SERVICE_BINDINGS: '{"sf_1":"THEME_WORKER_A"}',
    });

    const result = await runtime.handle({
      request: new Request(`https://${HOST}/`),
      resolved,
    });

    expect(result.success).toBe(false);
    if (result.success || result.reason !== "RUNTIME_NOT_CONFIGURED") {
      throw new Error("expected RUNTIME_NOT_CONFIGURED");
    }
    expect(result.notConfigured).toEqual({
      code: "BINDING_UNMAPPED",
      subcode: "BINDING_ABSENT",
    });
  });
});
