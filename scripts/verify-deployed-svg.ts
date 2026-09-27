/**
 * The deploy gate for SVG in Theme public/: checks a deployed storefront's
 * SVG as browsers receive it. Read-only — it sends GET requests and nothing
 * else, and uploads nothing.
 *
 *   pnpm verify:deployed-svg --svg https://<store>/icons/logo.svg --page https://<store>/
 *   pnpm verify:deployed-svg --self-test
 *
 * `--svg` is an SVG in the live release's public/ (a benign one, uploaded and
 * published for this); `--page` is a storefront page whose component shows
 * it with `<img>`. Checked, in Chromium, Firefox and WebKit:
 *
 * 1. The GET response — not a HEAD, which a server may answer differently —
 *    is 200 `image/svg+xml` with `nosniff` and the sandbox CSP, both as Node
 *    fetches it and as each browser receives it.
 * 2. The page's `<img>` for it decodes and has a size.
 * 3. Opened directly, the document is sandboxed: its origin is opaque.
 * 4. Script cannot run under the headers production sends. Production holds
 *    no script-carrying SVG — uploads refuse one — so the browser is handed
 *    production's own GET response with its body replaced by one. It must
 *    run nothing, and the same body without those headers (the control) must
 *    run, or "did not run" would prove nothing. Execution is detected in the
 *    document itself; the probe sends no request anywhere.
 *
 * Any failure exits non-zero. DEPLOY.md says what to do then: withdraw SVG
 * and deal with the release that holds it.
 *
 * `--self-test` runs the checks against local servers — correct headers,
 * missing CSP, wrong type, headers on HEAD only, an `<img>` that cannot be
 * drawn — and fails unless each verdict is the right one, so the gate cannot
 * pass by being unable to fail.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, firefox, webkit, type BrowserType } from "playwright";

import { SVG_ISOLATION_HEADERS } from "../src/lib/storefront/theme-svg-isolation";

const PROBE = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" onload="document.documentElement.setAttribute('data-ran','onload')"><script>document.documentElement.setAttribute("data-ran","script")</script><rect width="40" height="20" fill="#c00"/></svg>`;
const REQUIRED_CSP = SVG_ISOLATION_HEADERS["Content-Security-Policy"];

type Headers = Record<string, string>;

/** Problems with a GET response's status and headers; empty when right. */
function headerProblems(status: number, headers: Headers): string[] {
  const get = (name: string) => headers[name.toLowerCase()] ?? "";
  const problems: string[] = [];
  if (status !== 200) problems.push(`status ${status}`);
  if (!/^\s*image\/svg\+xml\b/i.test(get("content-type"))) {
    problems.push(`content-type "${get("content-type")}"`);
  }
  if (get("x-content-type-options").toLowerCase() !== "nosniff") {
    problems.push(`x-content-type-options "${get("x-content-type-options")}"`);
  }
  const csp = get("content-security-policy");
  const directives = new Set(
    csp.split(";").map((part) => part.trim().replace(/\s+/g, " ")),
  );
  for (const required of REQUIRED_CSP.split(";").map((part) => part.trim())) {
    if (!directives.has(required)) {
      problems.push(`content-security-policy lacks "${required}" ("${csp}")`);
    }
  }
  return problems;
}

async function checkBrowser(
  name: string,
  type: BrowserType,
  svgUrl: string,
  pageUrl: string,
): Promise<string[]> {
  const problems: string[] = [];
  const browser = await type.launch();
  try {
    // 1 and 3: the GET the browser makes when the SVG is opened directly.
    const direct = await (await browser.newContext()).newPage();
    const response = await direct.goto(svgUrl);
    if (!response) {
      problems.push("direct open: no response");
    } else {
      problems.push(
        ...headerProblems(response.status(), response.headers()).map(
          (problem) => `direct open: ${problem}`,
        ),
      );
      const origin = await direct.evaluate(() => self.origin);
      if (origin !== "null") {
        problems.push(`direct open: not sandboxed (origin ${origin})`);
      }
    }

    // 2: the storefront's own <img> for it.
    const page = await (await browser.newContext()).newPage();
    await page.goto(pageUrl);
    const target = new URL(svgUrl).pathname;
    const shown = await page.evaluate(async (path) => {
      const image = [...document.images].find(
        (candidate) =>
          new URL(candidate.currentSrc || candidate.src).pathname === path,
      );
      if (!image) return { found: false, width: 0 };
      try {
        await image.decode();
      } catch {
        return { found: true, width: 0 };
      }
      return { found: true, width: image.naturalWidth };
    }, target);
    if (!shown.found) problems.push(`page: no <img> for ${target}`);
    else if (shown.width === 0)
      problems.push(`page: <img> for ${target} is not drawn`);

    // 4: production's headers, a script-carrying body; then no headers.
    const ran = async (withProductionHeaders: boolean) => {
      const context = await browser.newContext();
      const probe = await context.newPage();
      await probe.route(svgUrl, async (route) => {
        if (withProductionHeaders) {
          const real = await route.fetch();
          await route.fulfill({ response: real, body: PROBE });
        } else {
          await route.fulfill({
            status: 200,
            contentType: "image/svg+xml",
            body: PROBE,
          });
        }
      });
      await probe.goto(svgUrl);
      await probe.waitForTimeout(1_000);
      const result = await probe.evaluate(() =>
        document.documentElement.getAttribute("data-ran"),
      );
      await context.close();
      return result;
    };
    const underHeaders = await ran(true);
    if (underHeaders !== null) {
      problems.push(`script ran under production's headers (${underHeaders})`);
    }
    const control = await ran(false);
    if (control === null) {
      problems.push(
        "control: script did not run without the headers, so detection proves nothing",
      );
    }
  } catch (error) {
    problems.push(`could not run: ${String(error).split("\n")[0]}`);
  } finally {
    await browser.close();
  }
  return problems.map((problem) => `[${name}] ${problem}`);
}

export async function verifyDeployedSvg(svgUrl: string, pageUrl: string) {
  const problems: string[] = [];
  // 1, as a plain client sees it: a GET, following redirects.
  const response = await fetch(svgUrl, { method: "GET" });
  await response.arrayBuffer();
  problems.push(
    ...headerProblems(
      response.status,
      Object.fromEntries(response.headers.entries()),
    ).map((problem) => `[fetch GET] ${problem}`),
  );
  for (const [name, type] of [
    ["chromium", chromium],
    ["firefox", firefox],
    ["webkit", webkit],
  ] as const) {
    problems.push(...(await checkBrowser(name, type, svgUrl, pageUrl)));
  }
  return problems;
}

/** A local storefront whose SVG responses are shaped by `mode`. */
async function selfTestServer(
  mode: "correct" | "no-csp" | "wrong-type" | "head-only" | "broken-img",
): Promise<{ origin: string; server: Server }> {
  const clean = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#0a7"/></svg>`;
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://local").pathname;
    if (path === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<!doctype html><img src="/icons/logo.svg" width="40" height="20">`,
      );
      return;
    }
    if (path !== "/icons/logo.svg") {
      res.writeHead(404);
      res.end();
      return;
    }
    const isolated = {
      "content-type": "image/svg+xml",
      "content-security-policy": REQUIRED_CSP,
      "x-content-type-options": "nosniff",
    };
    const headers =
      mode === "no-csp"
        ? {
            "content-type": "image/svg+xml",
            "x-content-type-options": "nosniff",
          }
        : mode === "wrong-type"
          ? { ...isolated, "content-type": "text/plain" }
          : mode === "head-only" && req.method === "GET"
            ? { "content-type": "image/svg+xml" }
            : isolated;
    res.writeHead(200, headers);
    res.end(
      req.method === "HEAD"
        ? undefined
        : mode === "broken-img"
          ? "<svg"
          : clean,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    server,
  };
}

async function selfTest() {
  const expectations: Array<
    [Parameters<typeof selfTestServer>[0], RegExp | null]
  > = [
    ["correct", null],
    ["no-csp", /content-security-policy lacks/],
    ["wrong-type", /content-type "text\/plain"/],
    ["head-only", /\[fetch GET\] content-security-policy lacks/],
    ["broken-img", /is not drawn/],
  ];
  const failures: string[] = [];
  for (const [mode, expected] of expectations) {
    const { origin, server } = await selfTestServer(mode);
    try {
      const problems = await verifyDeployedSvg(
        `${origin}/icons/logo.svg`,
        `${origin}/`,
      );
      const ok =
        expected === null
          ? problems.length === 0
          : problems.some((problem) => expected.test(problem));
      console.log(
        `[self-test] ${mode}: ${ok ? "as expected" : "UNEXPECTED"} (${problems.length} problem(s))`,
      );
      if (!ok)
        failures.push(`${mode}: ${problems.join("; ") || "no problems found"}`);
    } finally {
      server.close();
    }
  }
  if (failures.length > 0) {
    console.error(`\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log("\nThe gate passes a correct response and fails each wrong one.");
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.includes("--self-test")) return selfTest();
  const value = (flag: string) => {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const svgUrl = value("--svg");
  const pageUrl = value("--page");
  if (!svgUrl || !pageUrl) {
    console.error(
      "Usage: pnpm verify:deployed-svg --svg https://<store>/<path>.svg --page https://<store>/<page>",
    );
    process.exit(2);
  }
  const problems = await verifyDeployedSvg(svgUrl, pageUrl);
  if (problems.length > 0) {
    console.error(
      `${problems.join("\n")}\n\nThe SVG deploy gate FAILED. See DEPLOY.md: withdraw SVG and deal with the release that holds it.`,
    );
    process.exit(1);
  }
  console.log("The SVG deploy gate passed in Chromium, Firefox and WebKit.");
}

// Run when executed, not when imported (the self-test and tools import it).
if (process.argv[1]?.endsWith("verify-deployed-svg.ts")) void main();
