// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";

/**
 * The Theme Worker transport against a real workerd service binding.
 *
 * Unit tests bind `{ fetch }` objects; a deployed `THEME_WORKER` is a
 * `Fetcher` RPC stub that answers `true` to `"<any name>" in binding`, and
 * `"unmapped" in value` turned every storefront request on staging into
 * `BINDING_UNMAPPED` 503s. Here Core's own `createThemeRuntime` runs inside
 * workerd with `THEME_WORKER` bound to a real service: the Worker itself,
 * which answers as the Theme when Core's storefront headers are present.
 */

const ROUTING_MODULE = join(
  process.cwd(),
  "src/lib/storefront/service/storefront-request-routing.ts",
);

const COMPATIBILITY_DATE = (() => {
  const match = /"compatibility_date"\s*:\s*"([^"]+)"/.exec(
    readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8"),
  );
  if (!match) throw new Error("wrangler.jsonc has no compatibility_date");
  return match[1]!;
})();

const ENTRY = `
import { createThemeRuntime } from ${JSON.stringify(ROUTING_MODULE)};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.headers.get("x-morph-storefront-id")) {
      return new Response("theme:" + url.pathname);
    }
    const binding = env.THEME_WORKER;
    const probe = {
      unmappedIn: "unmapped" in binding,
      okIn: "ok" in binding,
      ownKeys: Object.keys(binding).length,
    };
    const result = await createThemeRuntime(env).handle({
      request,
      resolved: {
        hostname: url.hostname,
        storefrontId: "sf_1",
        releaseId: "rel_1",
        themeBuildId: "bld_1",
        contentPublicationId: null,
      },
    });
    const body = result.success
      ? { success: true, text: await result.response.text() }
      : { success: false, notConfigured: result.notConfigured };
    return Response.json({ probe, ...body });
  },
};
`;

let dir = "";
let worker: Awaited<ReturnType<typeof unstable_startWorker>> | null = null;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "theme-runtime-workerd-"));
  const entrypoint = join(dir, "entry.js");
  writeFileSync(entrypoint, ENTRY);
  worker = await unstable_startWorker({
    name: "theme-runtime-workerd-test",
    entrypoint,
    compatibilityDate: COMPATIBILITY_DATE,
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      THEME_WORKER: {
        type: "service",
        service: "theme-runtime-workerd-test",
      },
    },
    dev: {
      server: { port: 0 },
      inspector: false,
      logLevel: "warn",
      persist: join(dir, "state"),
    },
  });
  await worker.ready;
}, 120_000);

afterAll(async () => {
  await worker?.dispose();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("ServiceBindingThemeRuntime in workerd", () => {
  it("forwards through a real THEME_WORKER service binding", async () => {
    const response = await worker!.fetch("http://shop.example.com/about");
    const body = (await response.json()) as {
      probe: { unmappedIn: boolean; okIn: boolean; ownKeys: number };
      success: boolean;
      text?: string;
      notConfigured?: unknown;
    };

    // The stub really does claim every property, so a probe on it can never
    // tell a binding from a miss.
    expect(body.probe).toEqual({ unmappedIn: true, okIn: true, ownKeys: 0 });
    expect(body).toMatchObject({ success: true, text: "theme:/about" });
  });
});
