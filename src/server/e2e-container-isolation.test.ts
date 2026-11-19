import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEV_IMAGE_RUN_ARG, e2eWorkerConfig } from "./e2e-container-isolation";

const RUN = "morph-e2e-0123456789ab";

function sandboxes() {
  return {
    name: "morph",
    containers: [
      { class_name: "Sandbox", image: "./Dockerfile.sandbox" },
      { class_name: "PreviewSandbox", image: "./Dockerfile.sandbox", image_vars: { KEEP: "1" } },
      { class_name: "BuildPreviewSandbox", image: "./Dockerfile.sandbox" },
    ],
  };
}

describe("e2eWorkerConfig", () => {
  it("changes nothing outside a container end-to-end run", () => {
    expect(e2eWorkerConfig(undefined)).toBeUndefined();
    expect(e2eWorkerConfig("")).toBeUndefined();
  });

  it("names the Worker and gives every Sandbox image the run's id", () => {
    const config = sandboxes();
    const result = e2eWorkerConfig(RUN)!(config);
    expect(result).toEqual({ name: RUN });
    expect(config.containers.map((c) => c.image_vars)).toEqual([
      { [DEV_IMAGE_RUN_ARG]: RUN },
      { KEEP: "1", [DEV_IMAGE_RUN_ARG]: RUN },
      { [DEV_IMAGE_RUN_ARG]: RUN },
    ]);
  });

  it("covers every container this repository configures", () => {
    // Read the real config's classes, so one added later cannot be missed.
    const wrangler = readFileSync(path.join(process.cwd(), "wrangler.jsonc"), "utf8");
    const block = wrangler.slice(wrangler.indexOf('"containers": ['));
    const configured = [...block.slice(0, block.indexOf("\n  ],")).matchAll(/"class_name": "(\w+)"/g)].map(
      (match) => match[1],
    );
    expect(configured).toEqual(["Sandbox", "PreviewSandbox", "BuildPreviewSandbox"]);
    expect([...block.matchAll(/"image": "([^"]+)"/g)].slice(0, 3).map((m) => m[1])).toEqual([
      "./Dockerfile.sandbox",
      "./Dockerfile.sandbox",
      "./Dockerfile.sandbox",
    ]);
  });

  it("adds no service without the parser opt-in", () => {
    const config = { ...sandboxes(), services: [{ binding: "OTHER", service: "other" }] };
    e2eWorkerConfig(RUN)!(config);
    e2eWorkerConfig(RUN, { astroParser: false })!(config);
    expect(config.services).toEqual([{ binding: "OTHER", service: "other" }]);
    const bare: ReturnType<typeof sandboxes> & {
      services?: { binding: string; service: string }[];
    } = sandboxes();
    e2eWorkerConfig(RUN)!(bare);
    expect(bare.services).toBeUndefined();
  });

  it("binds ASTRO_PARSER beside existing services, once, only with the opt-in", () => {
    const config: ReturnType<typeof sandboxes> & {
      services?: { binding: string; service: string }[];
    } = { ...sandboxes(), services: [{ binding: "OTHER", service: "other" }] };
    const result = e2eWorkerConfig(RUN, { astroParser: true })!(config);
    expect(result).toEqual({ name: RUN });
    expect(config.services).toEqual([
      { binding: "OTHER", service: "other" },
      { binding: "ASTRO_PARSER", service: "morph-astro-parser" },
    ]);
    e2eWorkerConfig(RUN, { astroParser: true })!(config);
    expect(config.services).toHaveLength(2);
    const bare: ReturnType<typeof sandboxes> & {
      services?: { binding: string; service: string }[];
    } = sandboxes();
    e2eWorkerConfig(RUN, { astroParser: true })!(bare);
    expect(bare.services).toEqual([{ binding: "ASTRO_PARSER", service: "morph-astro-parser" }]);
  });

  it("is inert outside a run even with the parser opt-in (no worker name)", () => {
    expect(e2eWorkerConfig(undefined, { astroParser: true })).toBeUndefined();
    expect(e2eWorkerConfig("", { astroParser: true })).toBeUndefined();
  });

  it("still refuses a run with no containers when the parser is requested", () => {
    expect(() => e2eWorkerConfig(RUN, { astroParser: true })!({})).toThrow(/E2E_CONTAINERS_MISSING/);
  });

  it("refuses a malformed run id instead of using the shared image", () => {
    for (const bad of ["morph", "morph-e2e-", "morph-e2e-0123456789a", "morph-e2e-0123456789abc", "morph-e2e-0123456789AB", "x; rm -rf /"]) {
      expect(() => e2eWorkerConfig(bad)).toThrow(/E2E_WORKER_NAME_INVALID/);
    }
  });

  it("refuses a run with no containers, or one whose image is pulled", () => {
    expect(() => e2eWorkerConfig(RUN)!({ containers: [] })).toThrow(/E2E_CONTAINERS_MISSING/);
    expect(() => e2eWorkerConfig(RUN)!({})).toThrow(/E2E_CONTAINERS_MISSING/);
    expect(() =>
      e2eWorkerConfig(RUN)!({ containers: [{ class_name: "Sandbox", image: "docker.io/cloudflare/sandbox:1" }] }),
    ).toThrow(/E2E_CONTAINER_IMAGE_NOT_BUILT/);
  });

  it("is the label Dockerfile.sandbox writes, last, so no layer changes", () => {
    const dockerfile = readFileSync(path.join(process.cwd(), "Dockerfile.sandbox"), "utf8").trimEnd().split("\n");
    expect(dockerfile.slice(-2)).toEqual([
      `ARG ${DEV_IMAGE_RUN_ARG}=""`,
      `LABEL dev.morph.image-run=$${DEV_IMAGE_RUN_ARG}`,
    ]);
  });
});
