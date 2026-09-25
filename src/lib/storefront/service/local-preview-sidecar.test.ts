// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { LocalPreviewSidecarClient } from "./local-preview-sidecar-client";
import { startLocalPreviewSidecar } from "./local-preview-sidecar";
import { LocalVitePreviewServer } from "../compiler/local-vite-preview-server";
import { createHash } from "node:crypto";
import {
  LOCAL_PREVIEW_SIDECAR_DIGEST_HEADER,
  LOCAL_PREVIEW_SIDECAR_MAX_BINARY_BYTES,
  LOCAL_PREVIEW_SIDECAR_PREVIEW_ID_HEADER,
  LOCAL_PREVIEW_SIDECAR_SIZE_HEADER,
  LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER,
} from "./local-preview-sidecar.protocol";
import { THEME_PREVIEW_WORKSPACE_FINGERPRINT_RELATIVE_PATH } from "../compiler/theme-workspace-path";
import { THEME_PUBLIC_LIMITS } from "../theme-public-files";

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

/**
 * Binary files over the sidecar, end to end: staged raw ahead of the start,
 * checked before anything lands, laid out by the start, and served by Vite
 * byte for byte. This is the sidecar half of the gate on building binary
 * files, so it is run against the real sidecar and a real dev server.
 */
describe("binary files over the local preview sidecar", () => {
  const sha256 = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");
  const png = (size: number, fill = 7) => {
    const bytes = new Uint8Array(size);
    // Every byte value, so an encoding that mangles any of them shows.
    for (let index = 0; index < size; index += 1) {
      bytes[index] = (index * 31 + fill) % 256;
    }
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return bytes;
  };
  const stage = (
    previewId: string,
    bytes: Uint8Array,
    headers: { digest?: string; size?: string; token?: string } = {},
  ) =>
    fetch(`${sidecar.origin}/stageBinary`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        [LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER]: headers.token ?? TOKEN,
        [LOCAL_PREVIEW_SIDECAR_PREVIEW_ID_HEADER]: previewId,
        [LOCAL_PREVIEW_SIDECAR_DIGEST_HEADER]: headers.digest ?? sha256(bytes),
        [LOCAL_PREVIEW_SIDECAR_SIZE_HEADER]:
          headers.size ?? String(bytes.byteLength),
      },
      body: bytes as Uint8Array<ArrayBuffer>,
    });
  const withImage = (bytes: Uint8Array) => [
    ...THEME,
    {
      path: "public/images/hero.png",
      binary: { digest: sha256(bytes), sizeBytes: bytes.byteLength },
    },
  ];
  const fingerprintOf = (previewId: string) =>
    path.join(
      WORKSPACES_ROOT,
      previewId,
      THEME_PREVIEW_WORKSPACE_FINGERPRINT_RELATIVE_PATH,
    );
  const exists = (target: string) =>
    fs.access(target).then(
      () => true,
      () => false,
    );

  it("serves a staged image exactly as it was stored", async () => {
    // Near the per-file limit, so the transfer is exercised at the size it
    // is bounded to.
    const bytes = png(LOCAL_PREVIEW_SIDECAR_MAX_BINARY_BYTES - 1024);
    let reads = 0;
    const started = await client.start({
      ...startInput(),
      files: withImage(bytes),
      loadBinary: async () => {
        reads += 1;
        return bytes;
      },
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(reads).toBe(1);

    // On disk, in the workspace the start laid out.
    const onDisk = await fs.readFile(
      path.join(WORKSPACES_ROOT, "preview-1", "public/images/hero.png"),
    );
    expect(Buffer.compare(onDisk, bytes)).toBe(0);

    // And over HTTP from Vite, the way the editor's canvas will ask for it.
    const served = await fetch(new URL("images/hero.png", started.url));
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toContain("image/png");
    const body = new Uint8Array(await served.arrayBuffer());
    expect(body.byteLength).toBe(bytes.byteLength);
    expect(Buffer.compare(body, bytes)).toBe(0);
  });

  it("refuses bytes that are not what the request says, before writing them", async () => {
    const bytes = png(64);
    const refusals = await Promise.all([
      stage("preview-1", bytes, { token: "x".repeat(48) }),
      stage("preview-1", bytes, { digest: "0".repeat(64) }),
      stage("preview-1", bytes, { digest: "not-a-digest" }),
      stage("preview-1", bytes, { size: "63" }),
      stage("preview-1", bytes, { size: String(10 * 1024 * 1024) }),
      stage("preview-1", png(LOCAL_PREVIEW_SIDECAR_MAX_BINARY_BYTES + 1)),
    ]);
    expect(refusals.map((response) => response.status)).toEqual([
      401, 400, 400, 400, 400, 413,
    ]);
    // Nothing was staged under the digest of the refused bytes.
    expect(
      await exists(
        path.join(
          WORKSPACES_ROOT,
          ".binary-staging",
          "preview-1",
          "0".repeat(64),
        ),
      ),
    ).toBe(false);
  });

  it("does not commit a workspace whose binary files were never staged", async () => {
    await removeTree(path.join(WORKSPACES_ROOT, "preview-2"));
    await removeTree(
      path.join(WORKSPACES_ROOT, ".binary-staging", "preview-2"),
    );
    const bytes = png(64, 3);

    // The start sent without staging, as a client that skipped it would.
    const response = await fetch(`${sidecar.origin}/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER]: TOKEN,
      },
      body: JSON.stringify({
        ...startInput(),
        previewId: "preview-2",
        files: withImage(bytes),
      }),
    });
    const started = (await response.json()) as {
      ok: boolean;
      errorMessage?: string;
    };
    expect(started.ok).toBe(false);
    expect(started.errorMessage).toContain("BINARY_NOT_STAGED");
    // A marker is left, but it says the workspace is incomplete.
    expect(await fs.readFile(fingerprintOf("preview-2"), "utf8")).toBe("dirty");
  });

  it("does not commit a workspace from staged bytes changed on disk", async () => {
    await removeTree(path.join(WORKSPACES_ROOT, "preview-2"));
    const bytes = png(64, 5);
    expect((await stage("preview-2", bytes)).status).toBe(200);
    await fs.writeFile(
      path.join(WORKSPACES_ROOT, ".binary-staging", "preview-2", sha256(bytes)),
      png(64, 6),
    );

    const started = await client.start({
      ...startInput(),
      previewId: "preview-2",
      files: withImage(bytes),
      // Stages the right bytes again; the start must still read the disk.
      loadBinary: async () => bytes,
    });
    // Re-staging repaired the file, so this start is sound.
    expect(started.ok).toBe(true);

    // Now damage it after staging, and start without a loader, as the
    // sidecar's own start does.
    await fs.writeFile(
      path.join(WORKSPACES_ROOT, ".binary-staging", "preview-2", sha256(bytes)),
      png(64, 6),
    );
    await client.stop("preview-2");
    await removeTree(path.join(WORKSPACES_ROOT, "preview-2"));
    const response = await fetch(`${sidecar.origin}/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER]: TOKEN,
      },
      body: JSON.stringify({
        ...startInput(),
        previewId: "preview-2",
        files: withImage(bytes),
      }),
    });
    const restarted = (await response.json()) as {
      ok: boolean;
      errorMessage?: string;
    };
    expect(restarted.ok).toBe(false);
    expect(restarted.errorMessage).toContain("BINARY_STAGED_CORRUPT");
    // A marker is left, but it says the workspace is incomplete.
    expect(await fs.readFile(fingerprintOf("preview-2"), "utf8")).toBe("dirty");
  });

  it("bounds a staged file by the per-file quota of public/", () => {
    expect(LOCAL_PREVIEW_SIDECAR_MAX_BINARY_BYTES).toBe(
      THEME_PUBLIC_LIMITS.maxFileBytes,
    );
  });
});

/**
 * What a start's marker promises, and what a start is ordered against.
 *
 * The marker on disk means only that every file of a plan is written: it is
 * withdrawn before a start changes anything and committed after the last
 * file. A start and the file syncs of the same preview run in one queue, so
 * neither can land inside the other.
 */
describe("the local preview workspace lifecycle", () => {
  const sha256 = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");
  const markerOf = (previewId: string) =>
    fs
      .readFile(
        path.join(
          WORKSPACES_ROOT,
          previewId,
          THEME_PREVIEW_WORKSPACE_FINGERPRINT_RELATIVE_PATH,
        ),
        "utf8",
      )
      .catch(() => null);
  const rawStart = async (body: unknown) => {
    const response = await fetch(`${sidecar.origin}/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER]: TOKEN,
      },
      body: JSON.stringify(body),
    });
    return (await response.json()) as { ok: boolean; errorMessage?: string };
  };

  it("withdraws the marker before a start rewrites anything", async () => {
    await removeTree(path.join(WORKSPACES_ROOT, "preview-3"));
    const first = await client.start({
      ...startInput(),
      previewId: "preview-3",
    });
    expect(first.ok).toBe(true);
    const committed = await markerOf("preview-3");
    expect(committed).not.toBeNull();
    expect(committed).not.toBe("dirty");

    // A start that fails partway, on a file it cannot lay out.
    const failed = await rawStart({
      ...startInput(),
      previewId: "preview-3",
      files: [
        ...THEME,
        {
          path: "public/missing.png",
          binary: { digest: "e".repeat(64), sizeBytes: 8 },
        },
      ],
    });
    expect(failed.ok).toBe(false);
    // The earlier marker is gone rather than vouching for a half-written plan.
    expect(await markerOf("preview-3")).toBe("dirty");
    await client.stop("preview-3");
  });

  it("refuses a digest that is not one before using it as a file name", async () => {
    const failed = await rawStart({
      ...startInput(),
      previewId: "preview-3",
      files: [
        ...THEME,
        {
          path: "public/escape.png",
          binary: { digest: "../../../../package.json", sizeBytes: 8 },
        },
      ],
    });
    expect(failed.ok).toBe(false);
    expect(failed.errorMessage).toContain("BINARY_DIGEST_INVALID");
  });

  it("orders a file sync after a start still laying out the workspace", async () => {
    const server = new LocalVitePreviewServer({
      workspacesRoot: WORKSPACES_ROOT,
      toolchainRoot: process.cwd(),
    });
    const previewId = "preview-queue";
    await removeTree(path.join(WORKSPACES_ROOT, previewId));
    const base = {
      previewId,
      entry: "src/pages/index.tsx",
      previewHostname: "127.0.0.1",
      env: {},
    };
    try {
      expect((await server.start({ ...base, files: THEME })).ok).toBe(true);

      // A restart whose binary file is slow to arrive.
      const image = new Uint8Array(64).fill(4);
      let release!: () => void;
      const arrived = new Promise<void>((resolve) => (release = resolve));
      const restart = server.start({
        ...base,
        files: [
          ...THEME,
          {
            path: "public/slow.png",
            binary: { digest: sha256(image), sizeBytes: image.byteLength },
          },
        ],
        loadBinary: async () => {
          await arrived;
          return image;
        },
      });

      // A sync sent while that restart is waiting.
      const page = THEME.find((file) => file.path === "src/pages/index.tsx")!;
      const edited = `// edited while the start ran\n${page.content}`;
      let synced = false;
      const sync = server
        .writeFiles(previewId, [
          { path: "src/pages/index.tsx", content: edited },
        ])
        .then((result) => {
          synced = true;
          return result;
        });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(synced).toBe(false);

      release();
      expect((await restart).ok).toBe(true);
      expect((await sync).changed).toEqual(["src/pages/index.tsx"]);

      // The sync landed after the start, so the start did not overwrite it,
      // and the marker no longer vouches for the start's plan alone.
      expect(
        await fs.readFile(
          path.join(WORKSPACES_ROOT, previewId, "src/pages/index.tsx"),
          "utf8",
        ),
      ).toBe(edited);
      expect(await markerOf(previewId)).toBe("dirty");
    } finally {
      await server.stop(previewId);
      await removeTree(path.join(WORKSPACES_ROOT, previewId));
    }
  });
});
