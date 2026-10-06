// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// The same stand-in as preview-sandbox.test.ts: the SDK needs the Workers
// runtime, and the registration mechanism is what is checked here.
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
vi.mock("cloudflare:workers", () => ({ env: {} }));

// @ts-expect-error TS7016
import { parseJsonc } from "../../scripts/theme-runtime-wiring-scan.mjs";
import { PREVIEW_EGRESS_HEADER } from "@/lib/storefront/service/preview-egress-policy";
import { BuildPreviewSandbox } from "./build-preview-sandbox";

describe("the Build Preview container class", () => {
  it("registers its outbound policy as the class's handler", async () => {
    const handler = registry.get("BuildPreviewSandbox") as
      ((...args: unknown[]) => Promise<Response>) | undefined;
    expect(handler).toBeTypeOf("function");
    expect(Object.getOwnPropertyNames(BuildPreviewSandbox)).not.toContain(
      "outbound",
    );
    // Not a Build Preview content request, so refused before any lookup.
    const response = await handler!(
      new Request("https://api.example.com/"),
      {
        THEME_PREVIEW_HOSTNAME: "preview.example.test",
        BuildPreviewSandbox: { idFromName: () => "id" },
      },
      { containerId: "c", className: "BuildPreviewSandbox" },
    );
    expect(response.status).toBe(403);
    expect(response.headers.get(PREVIEW_EGRESS_HEADER)).toBeTruthy();
  });

  it("declares no internet and HTTPS interception", () => {
    const source = readFileSync("src/server/build-preview-sandbox.ts", "utf8");
    expect(source).toMatch(/^\s+enableInternet = false;$/m);
    expect(source).toMatch(/^\s+interceptHttps = true;$/m);
  });
});

describe("the Worker's Build Preview container configuration", () => {
  const config = parseJsonc(readFileSync("wrangler.jsonc", "utf8")).value;

  it("binds BuildPreviewSandbox with its own container and migration", () => {
    expect(config.durable_objects.bindings).toEqual(
      expect.arrayContaining([
        { name: "BuildPreviewSandbox", class_name: "BuildPreviewSandbox" },
      ]),
    );
    expect(
      config.containers.map(
        (container: { class_name: string }) => container.class_name,
      ),
    ).toContain("BuildPreviewSandbox");
    expect(
      config.migrations.flatMap(
        (migration: { new_sqlite_classes?: string[] }) =>
          migration.new_sqlite_classes ?? [],
      ),
    ).toContain("BuildPreviewSandbox");
  });

  it("leaves it out of the local-transport environment", () => {
    // Like the Live Preview's: without containers, the helper process serves.
    expect(config.env.local_preview_e2e.durable_objects).toBeUndefined();
    expect(config.env.local_preview_e2e.containers).toBeUndefined();
  });

  it("exports the class from the Worker entry", () => {
    const entry = readFileSync("src/server.ts", "utf8");
    expect(entry).toMatch(/export \{ BuildPreviewSandbox \}/);
  });
});
