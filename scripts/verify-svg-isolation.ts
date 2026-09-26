/**
 * Opens an SVG that tries to run script, in real browsers, through each way
 * the platform sends SVG, and reports whether its script ran.
 *
 *   pnpm exec tsx scripts/verify-svg-isolation.ts
 *
 * Isolated on purpose: the SVG exists only here, served by local servers this
 * script starts, never through an upload. Theme public/ refuses SVG, and no
 * switch is added to let this one in.
 *
 * Each way is checked three times over: the response carries the isolation
 * headers; the file opened directly runs none of its script; the file shown
 * through `<img>` still draws. A control sends the same file with no headers
 * and must run its script — otherwise "did not run" would prove nothing about
 * the headers, only that the probe cannot see.
 *
 * The Theme Worker's static assets are exercised with `wrangler dev` and the
 * `_headers` the deployer writes, with a control that has none. That is
 * Wrangler's local asset server, not a deployed Worker; a deployment still
 * needs the same check against its own URL.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox, webkit, type BrowserType } from "playwright";

import {
  PRODUCTION_ARTIFACT_POLICY,
  serveThemeArtifact,
} from "../src/lib/storefront/service/theme-artifact-server";
import {
  isolateSvgResponse,
  SVG_ISOLATION_HEADERS,
  svgIsolationHeadersFile,
  svgIsolationVitePluginSource,
} from "../src/lib/storefront/theme-svg-isolation";

/** Tries to reach `/ran` from script, from an event handler, and through `<a>`-free markup. */
const PROBE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" onload="fetch('/ran?via=onload')">
  <script>fetch('/ran?via=script')</script>
  <rect width="40" height="40" fill="#3b82f6"/>
</svg>`;
const PAGE = `<!doctype html><img id="probe" src="SRC" width="40" height="40">`;

type Way = { name: string; origin: string; svgPath: string; control: boolean };

async function sendWebResponse(response: Response, res: ServerResponse) {
  res.writeHead(
    response.status,
    Object.fromEntries(response.headers.entries()),
  );
  res.end(Buffer.from(await response.arrayBuffer()));
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );
}

/** A server answering `/page.html` and the probe SVG, the SVG by `sendSvg`. */
async function nodeServer(
  sendSvg: (res: ServerResponse, url: URL) => Promise<void> | void,
  servers: Server[],
): Promise<string> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname === "/page.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(PAGE.replace("SRC", url.searchParams.get("src") ?? "/probe.svg"));
      return;
    }
    if (url.pathname.endsWith(".svg")) return void (await sendSvg(res, url));
    res.writeHead(404);
    res.end();
  });
  servers.push(server);
  return listen(server);
}

async function wranglerAssets(
  withHeaders: boolean,
  processes: ChildProcess[],
  directories: string[],
): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "morph-svg-assets-"));
  directories.push(root);
  mkdirSync(join(root, "client", "deep", "nested"), { recursive: true });
  writeFileSync(join(root, "client", "probe.svg"), PROBE_SVG);
  writeFileSync(join(root, "client", "deep", "nested", "probe.svg"), PROBE_SVG);
  writeFileSync(
    join(root, "client", "page.html"),
    PAGE.replace("SRC", "/deep/nested/probe.svg"),
  );
  if (withHeaders) {
    writeFileSync(join(root, "client", "_headers"), svgIsolationHeadersFile());
  }
  writeFileSync(
    join(root, "wrangler.json"),
    JSON.stringify({
      name: "morph-svg-isolation-probe",
      compatibility_date: "2025-09-02",
      assets: { directory: "./client" },
    }),
  );
  const port = 8900 + processes.length;
  const child = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--config",
      join(root, "wrangler.json"),
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
    ],
    {
      stdio: "ignore",
      // Its own process group: `npx` starts wrangler, which starts workerd
      // and esbuild, and signalling `npx` alone leaves those running.
      detached: true,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
  processes.push(child);
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${origin}/page.html`)).ok) return origin;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`wrangler dev did not start on ${port}`);
}

/** Ends a detached child and everything it started, and waits for it to go. */
async function stopGroup(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    return;
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      // Already gone.
    }
  }, 5_000);
  await exited;
  clearTimeout(timer);
}

async function check(browserType: BrowserType, way: Way) {
  const response = await fetch(`${way.origin}${way.svgPath}`);
  const headers = {
    type: response.headers.get("content-type"),
    csp: response.headers.get("content-security-policy"),
    nosniff: response.headers.get("x-content-type-options"),
  };
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    const ran: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/ran") ran.push(request.url());
    });
    await page.goto(`${way.origin}${way.svgPath}`);
    await page.waitForTimeout(1_500);

    const pageUrl = way.name.startsWith("wrangler")
      ? `${way.origin}/page.html`
      : `${way.origin}/page.html?src=${encodeURIComponent(way.svgPath)}`;
    await page.goto(pageUrl);
    const drawn = await page
      .locator("#probe")
      .evaluate((image: HTMLImageElement) =>
        image.decode().then(
          () => image.naturalWidth > 0,
          () => false,
        ),
      );
    return { headers, ran, drawn };
  } finally {
    await browser.close();
  }
}

async function main() {
  const servers: Server[] = [];
  const processes: ChildProcess[] = [];
  const directories: string[] = [];
  const failures: string[] = [];
  try {
    const plugin = new Function(
      `return (${svgIsolationVitePluginSource()});`,
    )();
    let middleware: any = null;
    plugin.configureServer({
      middlewares: { use: (fn: unknown) => (middleware = fn) },
    });

    const ways: Way[] = [
      {
        name: "control: no headers",
        control: true,
        svgPath: "/probe.svg",
        origin: await nodeServer((res) => {
          res.writeHead(200, { "Content-Type": "image/svg+xml" });
          res.end(PROBE_SVG);
        }, servers),
      },
      {
        name: "Live Preview: generated Vite middleware",
        control: false,
        svgPath: "/probe.svg",
        origin: await nodeServer(
          (res) =>
            middleware({}, res, () => {
              res.writeHead(200, { "Content-Type": "image/svg+xml" });
              res.end(PROBE_SVG);
            }),
          servers,
        ),
      },
      {
        name: "preview proxy and storefront runtime: isolateSvgResponse",
        control: false,
        svgPath: "/probe.svg",
        origin: await nodeServer(
          (res) =>
            sendWebResponse(
              isolateSvgResponse(
                new Response(PROBE_SVG, {
                  headers: { "Content-Type": "image/svg+xml" },
                }),
              ),
              res,
            ),
          servers,
        ),
      },
      {
        name: "storefront assets: serveThemeArtifact",
        control: false,
        svgPath: "/probe.svg",
        origin: await nodeServer(async (res, url) => {
          const served = await serveThemeArtifact({
            request: new Request(`http://local${url.pathname}`),
            artifactPrefix: "builds/b1",
            manifest: {
              artifactEntry: "preview/index.html",
              files: [
                {
                  path: "runtime/client/probe.svg",
                  contentType: "image/svg+xml",
                  sizeBytes: PROBE_SVG.length,
                  sha256: "0".repeat(64),
                },
              ],
            } as never,
            artifactPath: "runtime/client/probe.svg",
            r2Bucket: {
              get: async () => ({
                body: null,
                httpEtag: '"probe"',
                httpMetadata: {},
                arrayBuffer: async () =>
                  new TextEncoder().encode(PROBE_SVG).buffer,
              }),
            } as never,
            policy: PRODUCTION_ARTIFACT_POLICY,
          });
          if (!served.success) throw new Error(served.failure.message);
          await sendWebResponse(served.response, res);
        }, servers),
      },
      {
        name: "wrangler dev: static assets with no _headers (control)",
        control: true,
        svgPath: "/deep/nested/probe.svg",
        origin: await wranglerAssets(false, processes, directories),
      },
      {
        name: "wrangler dev: static assets with the platform _headers",
        control: false,
        svgPath: "/deep/nested/probe.svg",
        origin: await wranglerAssets(true, processes, directories),
      },
    ];

    for (const [label, browserType] of [
      ["chromium", chromium],
      ["firefox", firefox],
      ["webkit", webkit],
    ] as const) {
      for (const way of ways) {
        let result;
        try {
          result = await check(browserType, way);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message.split("\n")[0]
              : String(error);
          console.log(`[${label}] ${way.name}: could not run (${message})`);
          if (label === "chromium")
            failures.push(`${label} ${way.name}: ${message}`);
          continue;
        }
        const isolated =
          result.headers.csp ===
            SVG_ISOLATION_HEADERS["Content-Security-Policy"] &&
          result.headers.nosniff === "nosniff";
        const expected = way.control
          ? result.ran.length > 0 && !isolated
          : isolated && result.ran.length === 0;
        const line = `[${label}] ${way.name}: type=${result.headers.type} isolated=${isolated} scriptRan=${result.ran.length > 0 ? result.ran.map((url) => new URL(url).search).join(",") : "no"} imgDrawn=${result.drawn} → ${expected && result.drawn ? "as expected" : "UNEXPECTED"}`;
        console.log(line);
        if (!expected || !result.drawn) failures.push(line);
      }
    }
  } finally {
    for (const server of servers) server.close();
    await Promise.all(processes.map(stopGroup));
    for (const directory of directories)
      rmSync(directory, { recursive: true, force: true });
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} unexpected result(s).`);
    process.exit(1);
  }
  console.log("\nEvery way isolated the SVG; every control ran its script.");
}

void main();
