/**
 * What `check-client-bundle.mjs` has to refuse, and what it lets through.
 *
 * Run by `node --test` from `pnpm build`, not vitest: vitest collects `src/**`
 * and `packages/*\/src/**` only, so a test beside this script would never run.
 *
 * The guard finds `dist/client` relative to its own file, so each fixture is a
 * scratch project root holding a copy of the script under `scripts/` and a
 * synthetic `dist/client`. The script runs exactly as the build runs it, with
 * no test-only entry point. Every value below is a variable name or an obvious
 * placeholder; no fixture holds a credential.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-client-bundle.mjs");
const scratchRoot = mkdtempSync(join(tmpdir(), "morph-client-bundle-test-"));
after(() => rmSync(scratchRoot, { recursive: true, force: true }));

let fixtureCount = 0;

/** Runs the guard over a `dist/client` holding `files` (relative path → text). */
const runGuard = (files) => {
  const root = join(scratchRoot, `fixture-${fixtureCount++}`);
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(scriptPath, join(root, "scripts", "check-client-bundle.mjs"));
  for (const [relPath, text] of Object.entries(files)) {
    const full = join(root, "dist", "client", relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  const result = spawnSync(process.execPath, [join(root, "scripts", "check-client-bundle.mjs")], {
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

const CLEAN_CHUNK = 'const greet=(n)=>`Hello ${n}`;export{greet as g};\n';

/** A source map shaped as Vite emits one, with `sourcesContent` set. */
const sourceMap = (originalSource) =>
  JSON.stringify({
    version: 3,
    file: "index-abc123.js",
    sources: ["../../src/cms.config.ts"],
    sourcesContent: [originalSource],
    names: [],
    mappings: "AAAA",
  });

describe("check-client-bundle", () => {
  it("passes a clean client build", () => {
    const { status, output } = runGuard({
      "assets/index-abc123.js": CLEAN_CHUNK,
      "assets/index-abc123.css": "body{margin:0}\n",
    });
    assert.equal(status, 0, output);
  });

  it("refuses a server-only name in a shipped chunk", () => {
    const { status, output } = runGuard({
      "assets/index-abc123.js": "const k=process.env.BETTER_AUTH_SECRET;export{k};\n",
    });
    assert.equal(status, 1, output);
    assert.match(output, /BETTER_AUTH_SECRET/);
  });

  it("refuses a source map whose sourcesContent names a server-only variable", () => {
    // The gap this test was written for: `.map` files were skipped outright,
    // so a public map carrying server-only source passed the guard.
    const { status, output } = runGuard({
      "assets/index-abc123.js": `${CLEAN_CHUNK}//# sourceMappingURL=index-abc123.js.map\n`,
      "assets/index-abc123.js.map": sourceMap(
        "export const secret = () => process.env.BETTER_AUTH_SECRET;\n",
      ),
    });
    assert.equal(status, 1, output);
    assert.match(output, /index-abc123\.js\.map/);
  });

  it("refuses any shipped source map, even one with harmless content", () => {
    // A public map publishes the original source of every client module.
    // The client build is configured not to emit them, so one appearing is a
    // configuration change to review, whatever it contains.
    const { status, output } = runGuard({
      "assets/index-abc123.js": CLEAN_CHUNK,
      "assets/index-abc123.js.map": sourceMap("export const greet = (n) => `Hello ${n}`;\n"),
    });
    assert.equal(status, 1, output);
    assert.match(output, /index-abc123\.js\.map/);
  });

  it("refuses an inline source map, which no `.map` file would reveal", () => {
    const inline = Buffer.from(sourceMap("export const greet = () => 1;\n")).toString("base64");
    const { status, output } = runGuard({
      "assets/index-abc123.js": `${CLEAN_CHUNK}//# sourceMappingURL=data:application/json;base64,${inline}\n`,
    });
    assert.equal(status, 1, output);
    assert.match(output, /inline source map/);
  });

  it("refuses an inline source map in a stylesheet", () => {
    const inline = Buffer.from(sourceMap("body { margin: 0 }\n")).toString("base64");
    const { status, output } = runGuard({
      "assets/index-abc123.css": `body{margin:0}\n/*# sourceMappingURL=data:application/json;base64,${inline} */\n`,
    });
    assert.equal(status, 1, output);
    assert.match(output, /inline source map/);
  });

  it("lets through a chunk that only mentions the inline-map marker inside code", () => {
    // Bundled tooling (a compiler, a source-map library) can carry the marker
    // as a string literal. Only a line-leading `//#` comment is a real map.
    const { status, output } = runGuard({
      "assets/tooling-abc123.js":
        'const m="//# sourceMappingURL=data:application/json;base64,";export{m};\n',
    });
    assert.equal(status, 0, output);
  });
});
