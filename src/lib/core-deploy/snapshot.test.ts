// @vitest-environment node
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// The repo's own JSONC reader for wrangler.jsonc; a plain .mjs with no types.
// @ts-expect-error TS7016
import { parseJsonc } from "../../../scripts/theme-runtime-wiring-scan.mjs";
import { checkNormalizedConfig } from "./deploy-config-guard";
import {
  SnapshotRefusal,
  createSnapshot,
  dockerfileSources,
  expectedSnapshotConfig,
  pathsOutsideSnapshot,
} from "./snapshot";

const REPO = process.cwd();
const require = createRequire(import.meta.url);
const { unstable_readConfig } = require("wrangler") as {
  unstable_readConfig: (args: { config: string }, options: { hideWarnings: boolean }) => Record<string, unknown>;
};

const cleanups: string[] = [];
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  cleanups.push(dir);
  return dir;
}

/**
 * A checkout shaped like this repo after `pnpm build`: the real
 * Dockerfile.sandbox and the context files it copies, the real wrangler.jsonc
 * containers, and a dist/server/wrangler.json with the paths the Vite plugin
 * writes (absolute container paths, migrations_dir relative to dist/server).
 */
function realShapeCheckout(): { root: string; artifactPath: string; artifactText: string } {
  const root = tempDir("morph-snapshot-repo-");
  const dockerfile = readFileSync(path.join(REPO, "Dockerfile.sandbox"), "utf8");
  writeFileSync(path.join(root, "Dockerfile.sandbox"), dockerfile);
  for (const source of dockerfileSources(dockerfile)) {
    mkdirSync(path.dirname(path.join(root, source)), { recursive: true });
    cpSync(path.join(REPO, source), path.join(root, source), { recursive: true });
  }
  mkdirSync(path.join(root, "drizzle"), { recursive: true });
  writeFileSync(path.join(root, "drizzle", "0001_init.sql"), "select 1;\n");
  mkdirSync(path.join(root, "dist", "server"), { recursive: true });
  mkdirSync(path.join(root, "dist", "client"), { recursive: true });
  writeFileSync(path.join(root, "dist", "server", "index.js"), "export default { fetch() { return new Response('ok'); } };\n");
  writeFileSync(path.join(root, "dist", "client", "index.html"), "<p>ok</p>\n");
  // A file in the checkout the snapshot must not take.
  writeFileSync(path.join(root, "README.md"), "not a deploy input\n");

  const source = parseJsonc(readFileSync(path.join(REPO, "wrangler.jsonc"), "utf8")).value;
  const artifact = {
    name: "morph-test",
    main: "index.js",
    compatibility_date: source.compatibility_date,
    compatibility_flags: source.compatibility_flags,
    workers_dev: false,
    preview_urls: false,
    assets: { binding: "ASSETS", directory: "../client" },
    d1_databases: [{ binding: "DATABASE", database_name: "db", database_id: "2f492a71-a681-4c5d-adfa-a3429f3f4e59", migrations_dir: "../../drizzle" }],
    durable_objects: source.durable_objects,
    migrations: source.migrations,
    containers: (source.containers as Array<Record<string, unknown>>).map((container) => ({
      ...container,
      image: path.join(root, String(container.image)),
      image_build_context: root,
    })),
  };
  const artifactPath = path.join(root, "dist", "server", "wrangler.json");
  const artifactText = JSON.stringify(artifact);
  writeFileSync(artifactPath, artifactText);
  return { root, artifactPath, artifactText };
}

describe("the deploy snapshot holds every path the built config references", () => {
  it("on the real wrangler.jsonc shape: Wrangler's reader resolves every container image, context and migrations dir inside the snapshot", () => {
    const { root, artifactPath, artifactText } = realShapeCheckout();
    const snapshot = createSnapshot({ root, artifactPath, artifactText, parent: tempDir("morph-snapshot-parent-") });

    // The real Dockerfile's context files are in the snapshot, the decoy is not.
    expect(existsSync(path.join(snapshot.dir, "Dockerfile.sandbox"))).toBe(true);
    for (const source of dockerfileSources(readFileSync(path.join(REPO, "Dockerfile.sandbox"), "utf8"))) {
      expect(existsSync(path.join(snapshot.dir, source)), source).toBe(true);
    }
    expect(existsSync(path.join(snapshot.dir, "README.md"))).toBe(false);
    expect(existsSync(path.join(snapshot.dir, "drizzle", "0001_init.sql"))).toBe(true);

    // The config differs from the checked artifact only by the moved container paths.
    expect(snapshot.configText).toBe(expectedSnapshotConfig(artifactText, root, artifactPath, snapshot.dir));

    const seen = unstable_readConfig({ config: snapshot.configPath }, { hideWarnings: true });
    const containers = seen.containers as Array<{ image: string; image_build_context?: string }>;
    expect(containers.length).toBe(3);
    for (const container of containers) {
      expect(path.resolve(path.dirname(snapshot.configPath), container.image).startsWith(`${snapshot.dir}${path.sep}`)).toBe(true);
    }
    expect(pathsOutsideSnapshot(seen, snapshot.dir, snapshot.configPath)).toEqual([]);
    expect(
      checkNormalizedConfig(seen, {
        accountId: "0123456789abcdef0123456789abcdef",
        workerName: "morph-test",
        environment: "production",
        d1Databases: { DATABASE: "2f492a71-a681-4c5d-adfa-a3429f3f4e59" },
        kvNamespaces: {},
        r2Buckets: {},
      }),
    ).toEqual([]);
  });

  it("finds a container that still points at the checkout", () => {
    const { root, artifactPath, artifactText } = realShapeCheckout();
    const snapshot = createSnapshot({ root, artifactPath, artifactText, parent: tempDir("morph-snapshot-parent-") });
    // What the config would look like had the copy not moved the container paths.
    writeFileSync(snapshot.configPath, artifactText);
    const seen = unstable_readConfig({ config: snapshot.configPath }, { hideWarnings: true });
    expect(pathsOutsideSnapshot(seen, snapshot.dir, snapshot.configPath).some((p) => p.startsWith("containers[0].image"))).toBe(true);
  });

  it.each([
    ["a wildcard COPY source", "FROM x\nCOPY sandbox/*.json /opt/\n", /wildcard/],
    ["a remote ADD", "FROM x\nADD https://example.com/a.tgz /opt/\n", /remote URL/],
    ["a source outside the context", "FROM x\nCOPY ../secret /opt/\n", /outside the build context/],
  ])("refuses %s", (_label, dockerfile, message) => {
    expect(() => dockerfileSources(dockerfile)).toThrow(message);
  });

  it("skips COPY --from, which reads another stage, and joins continued lines", () => {
    expect(
      dockerfileSources("FROM a AS build\nCOPY --from=build /out /out\nCOPY --chown=1000 sandbox/a.json \\\n  sandbox/b.json /opt/\n"),
    ).toEqual(["sandbox/a.json", "sandbox/b.json"]);
  });

  it.each([
    ["a container image outside the checkout", (a: Record<string, unknown>) => ({ ...a, containers: [{ class_name: "X", image: "/etc/Dockerfile", image_build_context: "/etc" }] })],
    ["a migrations_dir outside the checkout", (a: Record<string, unknown>) => ({ ...a, d1_databases: [{ binding: "DATABASE", database_id: "x", migrations_dir: "../../../outside" }] })],
    ["an assets directory outside dist", (a: Record<string, unknown>) => ({ ...a, assets: { directory: "../../public" } })],
  ])("refuses %s", (_label, change) => {
    const { root, artifactPath, artifactText } = realShapeCheckout();
    const text = JSON.stringify(change(JSON.parse(artifactText)));
    expect(() => createSnapshot({ root, artifactPath, artifactText: text, parent: tempDir("morph-snapshot-parent-") })).toThrow(SnapshotRefusal);
  });
});
