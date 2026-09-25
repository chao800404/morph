// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { LocalPreviewSidecarClient } from "./local-preview-sidecar-client";
import { startLocalPreviewSidecar } from "./local-preview-sidecar";
import { LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER } from "./local-preview-sidecar.protocol";

/**
 * The Worker's client and the Node sidecar, against each other and a real Vite
 * dev server.
 *
 * The point is the boundary: a token that is checked, an address that is only
 * ever loopback, a refusal that arrives as a refusal, and a Theme that is really
 * served on the other side of it. Everything the editor needs is exercised here,
 * without a container and without the editor.
 *
 * One thing to know before trusting a green run of `pnpm test`: the assertion
 * that an edit reaches the served page is only decisive when this file runs on
 * its own. Inside the full suite the higher load makes it pass with or without
 * the transport's watcher override, so the suite's green is not evidence about
 * that option. The two commands that are evidence:
 *
 *   pnpm exec vitest run src/lib/storefront/service/local-preview-sidecar.test.ts
 *
 * ...is green with the override and red without it, which is how it was found.
 */

const TOKEN = "t".repeat(48);
const WORKSPACES_ROOT = path.join(
  process.cwd(),
  ".morph-previews-sidecar-test",
);

let port = 0;
let sidecar: Awaited<ReturnType<typeof startLocalPreviewSidecar>>;
let client: LocalPreviewSidecarClient;

const THEME = [
  {
    path: "src/pages/index.tsx",
    content: `export default function Page() {\n  return <section><h1>Sidecar preview</h1></section>;\n}\n`,
  },
];

async function removeTree(target: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch {
      if (Date.now() > deadline) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

beforeAll(async () => {
  // A fixed root, reused between runs and reconciled by the materializer, so a
  // run that loses the cleanup race leaves one directory rather than a new one.
  await fs.mkdir(WORKSPACES_ROOT, { recursive: true });
  // An ephemeral port, published through the origin: the sidecar refuses an
  // origin without an explicit port, so one is found first and then named.
  const probe = await import("node:net").then(
    (net) =>
      new Promise<number>((resolve) => {
        const server = net.createServer();
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          const found =
            typeof address === "object" && address ? address.port : 0;
          server.close(() => resolve(found));
        });
      }),
  );
  port = probe;
  sidecar = await startLocalPreviewSidecar({
    origin: `http://127.0.0.1:${port}`,
    token: TOKEN,
    workspacesRoot: WORKSPACES_ROOT,
    toolchainRoot: process.cwd(),
    env: { NODE_ENV: "test" },
  });
  client = new LocalPreviewSidecarClient({
    origin: sidecar.origin,
    token: TOKEN,
  });
});

afterEach(async () => {
  for (const previewId of ["preview-1", "preview-2"]) {
    await client.stop(previewId).catch(() => undefined);
  }
});

afterAll(async () => {
  await sidecar?.close().catch(() => undefined);
  await removeTree(WORKSPACES_ROOT);
});

const startInput = () => ({
  previewId: "preview-1",
  files: THEME,
  entry: "src/pages/index.tsx",
  previewHostname: "127.0.0.1",
  env: {},
});

describe("the local preview sidecar boundary", () => {
  it("serves a Theme the Worker can reach, and says so", async () => {
    const started = await client.start(startInput());
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const url = new URL(started.url);
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.origin).not.toBe("http://localhost:3000");

    const document = await fetch(started.url);
    expect(document.status).toBe(200);
    expect(await document.text()).toContain("data-storefront-preview-root");

    await expect(
      client.isServing({
        previewId: "preview-1",
        previewHostname: "127.0.0.1",
        expectedOrigin: url.origin,
      }),
    ).resolves.toBe(true);

    // Applying an edit through the client is what makes the page change, and
    // the sidecar reports what it wrote rather than what it intended.
    const applied = await client.applyFiles({
      previewId: "preview-1",
      files: [
        {
          path: "src/pages/index.tsx",
          content: THEME[0]!.content.replace("Sidecar", "Edited"),
          fence: 1,
        },
      ],
    });
    expect(applied.changed).toEqual(["src/pages/index.tsx"]);
    // Written, and then *served* — which are two different facts. The workspace
    // watcher polls, so an edit arrives a moment later rather than at the instant
    // the write returns; asserting it immediately would be asserting the poll
    // interval rather than the behaviour. What is asserted is the outcome the
    // editor depends on: the page updates.
    await expect
      .poll(
        async () =>
          await (
            await fetch(new URL("src/pages/index.tsx", started.url))
          ).text(),
        { timeout: 10_000, interval: 200 },
      )
      .toContain("Edited preview");

    // A write made from an older version than one the preview has already
    // taken is refused where it lands, and the file is left as it was.
    const stale = await client.applyFiles({
      previewId: "preview-1",
      files: [
        {
          path: "src/pages/index.tsx",
          content: THEME[0]!.content.replace("Sidecar", "Rewound"),
          fence: 0,
        },
      ],
    });
    expect(stale).toEqual({
      changed: [],
      unchanged: [],
      refused: ["src/pages/index.tsx"],
    });
    expect(
      await (await fetch(new URL("src/pages/index.tsx", started.url))).text(),
    ).toContain("Edited preview");

    await client.stop("preview-1");
    await expect(
      client.isServing({
        previewId: "preview-1",
        previewHostname: "127.0.0.1",
        expectedOrigin: url.origin,
      }),
    ).resolves.toBe(false);
  }, 180_000);

  it("refuses a request that does not carry the token", async () => {
    const answer = await fetch(`${sidecar.origin}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(startInput()),
    });
    expect(answer.status).toBe(401);
    expect(await answer.json()).toEqual({
      error: "LOCAL_PREVIEW_SIDECAR_UNAUTHORIZED",
    });

    // A wrong token of the same length is refused for the same reason, and
    // nothing about the refusal distinguishes it from a missing one.
    const wrong = await fetch(`${sidecar.origin}/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER]: "x".repeat(TOKEN.length),
      },
      body: JSON.stringify(startInput()),
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({
      error: "LOCAL_PREVIEW_SIDECAR_UNAUTHORIZED",
    });
  });

  it("has nothing but the four operations", async () => {
    const missing = await fetch(`${sidecar.origin}/applyThemeFiles`, {
      method: "POST",
      headers: { [LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER]: TOKEN },
    });
    // The token check comes first, so an unknown path with a valid token is the
    // only case that can say "no such operation" — and it is not a 401.
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "LOCAL_PREVIEW_SIDECAR_NOT_FOUND",
    });
  });

  it("reports an unreachable sidecar as a failed start, not as an exception", async () => {
    const dead = new LocalPreviewSidecarClient({
      origin: "http://127.0.0.1:1",
      token: TOKEN,
      timeoutMs: 2_000,
    });
    const started = await dead.start(startInput());
    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.stage).toBe("preview-sidecar");
    expect(started.errorMessage).toContain("LOCAL_PREVIEW_SIDECAR");

    // And a question that cannot be answered is answered "no", because that is
    // the only decision the caller makes with it.
    await expect(
      dead.isServing({ previewId: "preview-1", previewHostname: "127.0.0.1" }),
    ).resolves.toBe(false);
  });
});
