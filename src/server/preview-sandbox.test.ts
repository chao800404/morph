// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// The SDK needs the Workers runtime to load. This stand-in registers an
// outbound handler the way `@cloudflare/containers` does — through an
// inherited static accessor, keyed by class name — which is the mechanism a
// `static outbound = …` field would silently bypass. That the real SDK then
// applies it is checked against a real container, not here.
const registry = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@cloudflare/sandbox", () => {
  class Sandbox {
    static get outbound(): unknown {
      return registry.get(this.name);
    }
    static set outbound(handler: unknown) {
      registry.set(this.name, handler);
    }
  }
  return { Sandbox };
});

import { Sandbox } from "@cloudflare/sandbox";
// The repo's own JSONC reader for wrangler.jsonc; a plain .mjs with no types.
// @ts-expect-error TS7016
import { parseJsonc } from "../../scripts/theme-runtime-wiring-scan.mjs";
import { PREVIEW_EGRESS_HEADER } from "@/lib/storefront/service/preview-egress-policy";
import { PreviewSandbox } from "./preview-sandbox";

describe("the Live Preview container class", () => {
  it("registers its refusal as the class's outbound handler", async () => {
    // Registered through the inherited static setter. A `static outbound`
    // field would define its own property instead, and the SDK would find no
    // handler for the class.
    // Read from the registry, not the class: a field would still answer
    // `PreviewSandbox.outbound` while leaving the registry empty.
    const handler = registry.get("PreviewSandbox") as
      | ((...args: unknown[]) => Response)
      | undefined;
    expect(handler).toBeTypeOf("function");
    expect(Object.getOwnPropertyNames(PreviewSandbox)).not.toContain("outbound");
    const response = await handler!(
      new Request("https://api.example.com/"),
      {} as never,
      { containerId: "c", className: "PreviewSandbox" } as never,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get(PREVIEW_EGRESS_HEADER)).toBeTruthy();
  });

  it("leaves the build and deploy class without one", () => {
    expect(Sandbox.outbound).toBeUndefined();
  });

  it("declares no internet and HTTPS interception", () => {
    // Instance fields exist only on a constructed Durable Object, which needs
    // a container runtime; the declaration is checked here, and the behaviour
    // in the Sandbox-transport check against a real container.
    const source = readFileSync("src/server/preview-sandbox.ts", "utf8");
    expect(source).toMatch(/^\s+enableInternet = false;$/m);
    expect(source).toMatch(/^\s+interceptHttps = true;$/m);
  });
});

describe("the Worker's container configuration", () => {
  const config = parseJsonc(readFileSync("wrangler.jsonc", "utf8")).value;

  it("binds PreviewSandbox with its own container and migration", () => {
    expect(config.durable_objects.bindings).toEqual(
      expect.arrayContaining([
        { name: "Sandbox", class_name: "Sandbox" },
        { name: "PreviewSandbox", class_name: "PreviewSandbox" },
      ]),
    );
    expect(
      config.containers.map((container: { class_name: string }) => container.class_name),
    ).toEqual(expect.arrayContaining(["Sandbox", "PreviewSandbox"]));
    expect(
      config.migrations.flatMap(
        (migration: { new_sqlite_classes?: string[] }) =>
          migration.new_sqlite_classes ?? [],
      ),
    ).toContain("PreviewSandbox");
  });

  it("exports the classes and ContainerProxy from the Worker entry", () => {
    const entry = readFileSync("src/server.ts", "utf8");
    expect(entry).toMatch(/export \{ PreviewSandbox \}/);
    expect(entry).toMatch(/export \{ ContainerProxy \}/);
  });
});
