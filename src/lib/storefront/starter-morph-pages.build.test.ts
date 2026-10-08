// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { build, type Rollup } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { STARTER_THEME_CONTENT_MODULE_SOURCE } from "./starter-theme-v3-files";

/**
 * Whether a built Theme can be steered to another store by the shell it runs in.
 *
 * The unit tests stand in for `import.meta.env.DEV`. This builds the real
 * starter content module with Vite, the way a Theme build does, and runs the
 * artifact in a plain Node process. Not in vitest: its loader supplies
 * `import.meta.env` to whatever it imports, which would answer the question
 * with the test runner's idea of the flag instead of the artifact's.
 *
 * A development build is run too, as a control. Without it, "the recording
 * store was never asked" could just mean this test cannot see a request.
 *
 * What this covers is the production transform of the starter content module.
 * It is not Morph's Build Preview or prerender pipeline.
 */

const execFileAsync = promisify(execFile);
const workdir = mkdtempSync(path.join(tmpdir(), "morph-pages-build-"));
const servers: Server[] = [];

async function recordingStore(body: unknown) {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url ?? "");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, requests };
}

function writeSources(dir: string) {
  const write = (name: string, content: string) =>
    writeFileSync(path.join(dir, name), content);
  write("content.ts", STARTER_THEME_CONTENT_MODULE_SOURCE);
  write("entry.ts", 'export * from "./content";\n');
  // The server build keeps the server branch of an isomorphic function.
  write(
    "react-start.ts",
    "export function createIsomorphicFn() { return { client() { return { server(fn: unknown) { return fn; } }; } }; }\n",
  );
  write(
    "react-start-server.ts",
    "export function getRequest() { return { headers: new Headers((globalThis as any).__morphTestHeaders ?? {}) }; }\n",
  );
  write(
    "react.ts",
    "export function createContext(v: unknown) { return { Provider: v }; }\nexport function useContext() { return {}; }\n",
  );
}

const RUNNER = `import { morph } from "./built.mjs";
globalThis.__morphTestHeaders = JSON.parse(process.env.TEST_HEADERS ?? "{}");
try {
  const page = await morph.pages.get("/home");
  console.log(JSON.stringify({ ok: true, page }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, message: String(error.message) }));
}
`;

/** Builds the module and returns the directory holding the runnable artifact. */
async function buildArtifact(mode: "production" | "development"): Promise<string> {
  const dir = path.join(workdir, mode);
  mkdirSync(dir, { recursive: true });
  writeSources(dir);

  // Vite takes DEV from NODE_ENV when it is already set, and vitest sets it.
  // A real `vite build` has it unset and so is production.
  vi.stubEnv("NODE_ENV", mode);
  let result: Rollup.RollupOutput | Rollup.RollupOutput[];
  try {
    result = (await build({
      root: dir,
      configFile: false,
      logLevel: "silent",
      mode,
      resolve: {
        alias: {
          "@tanstack/react-start/server": path.join(dir, "react-start-server.ts"),
          "@tanstack/react-start": path.join(dir, "react-start.ts"),
          react: path.join(dir, "react.ts"),
        },
      },
      ssr: { noExternal: true },
      build: {
        ssr: path.join(dir, "entry.ts"),
        write: false,
        minify: false,
        rollupOptions: { output: { format: "es" } },
      },
    })) as Rollup.RollupOutput | Rollup.RollupOutput[];
  } finally {
    vi.unstubAllEnvs();
  }

  const output = Array.isArray(result) ? result[0]! : result;
  const chunk = output.output.find((item) => item.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("no chunk built");
  writeFileSync(path.join(dir, "built.mjs"), chunk.code);
  writeFileSync(path.join(dir, "run.mjs"), RUNNER);
  return dir;
}

type Outcome =
  | { ok: true; page: Record<string, unknown> }
  | { ok: false; message: string };

/** Runs the artifact the way a deployed Theme runs: no vitest, no NODE_ENV. */
async function run(
  dir: string,
  env: { shellOrigin?: string; platformHeader?: string },
): Promise<Outcome> {
  const { stdout } = await execFileAsync(process.execPath, [path.join(dir, "run.mjs")], {
    env: {
      ...(env.shellOrigin ? { MORPH_CONTENT_ORIGIN: env.shellOrigin } : {}),
      TEST_HEADERS: JSON.stringify(
        env.platformHeader === undefined
          ? {}
          : { "x-morph-content-origin": env.platformHeader },
      ),
    },
    timeout: 20_000,
  });
  return JSON.parse(stdout.trim()) as Outcome;
}

let production: string;
let development: string;

beforeAll(async () => {
  production = await buildArtifact("production");
  development = await buildArtifact("development");
}, 120_000);

afterAll(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  rmSync(workdir, { recursive: true, force: true });
});

const page = (heading: string) => ({
  slots: { hero: { heading } },
  hiddenSlots: [],
});

describe("a built Theme and MORPH_CONTENT_ORIGIN", () => {
  it("control: a development build reads the store the shell names", async () => {
    const wrong = await recordingStore(page("from the shell"));

    const outcome = await run(development, { shellOrigin: wrong.origin });

    expect(outcome).toMatchObject({
      ok: true,
      page: { hero: { heading: "from the shell" } },
    });
    expect(wrong.requests).toEqual(["/_morph/content?path=%2Fhome"]);
  });

  it("a production build has the check decided at build time", async () => {
    const built = await import("node:fs").then((fs) =>
      fs.readFileSync(path.join(production, "built.mjs"), "utf8"),
    );
    // Held as a constant by the build, not left for the host to answer.
    expect(built).not.toMatch(/import\.meta\.env/);
    expect(built).not.toMatch(/import\.meta/);
  });

  it("a production build without the platform header fails and never contacts that store", async () => {
    const wrong = await recordingStore(page("from the shell"));

    const outcome = await run(production, { shellOrigin: wrong.origin });

    expect(outcome).toMatchObject({ ok: false });
    expect((outcome as { message: string }).message).toContain("No content source");
    expect(wrong.requests).toEqual([]);
  });

  it("a production build with the platform header reads only that snapshot", async () => {
    const wrong = await recordingStore(page("from the shell"));
    const snapshot = await recordingStore(page("from the snapshot"));

    const outcome = await run(production, {
      shellOrigin: wrong.origin,
      platformHeader: snapshot.origin,
    });

    expect(outcome).toMatchObject({
      ok: true,
      page: { hero: { heading: "from the snapshot" } },
    });
    expect(snapshot.requests).toEqual(["/_morph/content?path=%2Fhome"]);
    expect(wrong.requests).toEqual([]);
  });

  it("a production build rejects an unusable platform header instead of using the shell's store", async () => {
    const wrong = await recordingStore(page("from the shell"));

    const outcome = await run(production, {
      shellOrigin: wrong.origin,
      platformHeader: "not a url",
    });

    expect(outcome).toMatchObject({ ok: false });
    expect((outcome as { message: string }).message).toContain(
      "platform content origin header",
    );
    expect(wrong.requests).toEqual([]);
  });
});
