// @vitest-environment node
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
} from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { StorefrontBuildPreviewCapabilityDAL } from "../../dal/storefront-build-preview-capability.dal";
import { startLocalPreviewSidecar } from "../local-preview-sidecar";
import { fixtureBuild } from "./build-preview-artifact.fixture";
import { hashBuildPreviewToken } from "./build-preview-capability";
import { handleBuildPreviewRequest } from "./build-preview-request";
import { LocalBuildPreviewServerClient } from "./local-build-preview-client";

vi.mock("cloudflare:workers", () => ({ env: {} }));

/**
 * The whole local chain, run for real: a browser request on a Build Preview
 * host reaches Core's handler, which verifies the capability, starts the
 * build's instance through the helper process and forwards to it; the
 * instance's Theme code calls back on its content origin, which leaves
 * workerd only through the egress policy and lands on Core again.
 */

const SIDECAR_TOKEN = "s".repeat(48);
const TOKEN = "0123456789abcdef0123456789abcdef01234567";
const PREVIEW_HOSTNAME = "preview.localhost";

let sidecar: Awaited<ReturnType<typeof startLocalPreviewSidecar>>;
let core: Server;
let corePort = 0;
let host = "";
let client: LocalBuildPreviewServerClient;
// Counted by hand: the suite's mock reset would clear a vi.fn implementation.
let starts = 0;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createNetServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function toWebRequest(incoming: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
    headers.append(
      incoming.rawHeaders[i] as string,
      incoming.rawHeaders[i + 1] as string,
    );
  }
  const method = incoming.method ?? "GET";
  return new Request(`http://${incoming.headers.host}${incoming.url}`, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? null : Buffer.concat(chunks),
  });
}

type Answer = { status: number; headers: string[]; body: string };

function send(
  path: string,
  options: {
    hostHeader?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: "localhost",
        port: corePort,
        path,
        method: options.method ?? "GET",
        headers: { host: options.hostHeader ?? host, ...options.headers },
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () =>
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.rawHeaders,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end(options.body);
  });
}

const setCookies = (answer: Answer) =>
  answer.headers.filter(
    (_, i, all) => i % 2 === 1 && all[i - 1]?.toLowerCase() === "set-cookie",
  );

beforeAll(async () => {
  const sidecarPort = await freePort();
  sidecar = await startLocalPreviewSidecar({
    origin: `http://127.0.0.1:${sidecarPort}`,
    token: SIDECAR_TOKEN,
    workspacesRoot: `${process.cwd()}/.morph-previews-build-preview-test`,
    toolchainRoot: process.cwd(),
    env: { NODE_ENV: "test" },
  });
  client = new LocalBuildPreviewServerClient({
    origin: sidecar.origin,
    token: SIDECAR_TOKEN,
  });

  const tokenHash = await hashBuildPreviewToken(TOKEN);
  const { build, r2Bucket } = fixtureBuild();
  const capabilityDal = {
    findByTokenHash: async (hash: string) =>
      hash !== tokenHash
        ? null
        : {
            id: "cap-1",
            storefrontId: build.storefrontId,
            themeId: build.themeId,
            buildId: build.id,
            userId: "admin-1",
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
            revokedAt: null,
            build: {
              storefrontId: build.storefrontId,
              themeId: build.themeId,
              status: "succeeded" as const,
              artifactPrefix: build.artifactPrefix,
              contentPublicationId: "pub-of-build",
            },
            themeLive: true,
            user: { role: "admin", banned: false },
          },
  } as unknown as StorefrontBuildPreviewCapabilityDAL;

  core = createServer((incoming, outgoing) => {
    void (async () => {
      const response = await handleBuildPreviewRequest(
        await toWebRequest(incoming),
        {
          env: { THEME_PREVIEW_HOSTNAME: PREVIEW_HOSTNAME },
          capabilityDal,
          readBuild: async () => build,
          r2Bucket,
          contentPorts: {
            getPublishedDocument: async () => ({
              sections: [
                {
                  id: "hero",
                  enabled: true,
                  props: { heading: "Frozen" },
                },
              ],
            }),
          } as never,
          server: () => ({
            enabled: true,
            server: {
              kind: "local-sidecar",
              fetch: (id, request) => client.fetch(id, request),
              start: (input) => {
                starts += 1;
                return client.start(input);
              },
              stop: (id) => client.stop(id),
            },
          }),
        },
      );
      if (!response) {
        outgoing.writeHead(599).end("not a build preview host");
        return;
      }
      const headers: string[] = [];
      response.headers.forEach((value, name) => {
        if (name !== "set-cookie") headers.push(name, value);
      });
      for (const cookie of response.headers.getSetCookie()) {
        headers.push("set-cookie", cookie);
      }
      outgoing.writeHead(response.status, headers);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    })().catch((error: unknown) => {
      outgoing.writeHead(500).end(String(error));
    });
  });
  // `localhost`, as Vite's dev server listens, and as the instance's content
  // upstream names it.
  await new Promise<void>((resolve) => core.listen(0, "localhost", resolve));
  corePort = (core.address() as AddressInfo).port;
  host = `bp-${TOKEN}.${PREVIEW_HOSTNAME}:${corePort}`;
}, 60_000);

afterAll(async () => {
  await sidecar?.close().catch(() => undefined);
  await new Promise<void>((resolve) => core?.close(() => resolve()));
});

describe("a Build Preview, end to end on this machine", () => {
  it("starts the build's instance on its first request and answers from it", async () => {
    const answer = await send("/account");
    expect(answer.status).toBe(200);
    expect(answer.body).toBe("worker:/account");
    expect(starts).toBe(1);
    expect(answer.headers).toContain("noindex");
  }, 60_000);

  it("serves the build's assets", async () => {
    const answer = await send("/app.css");
    expect(answer.body).toBe("body{color:red}");
  });

  it("hands Theme code no platform credential and no header the browser asserted", async () => {
    const answer = await send("/headers", {
      headers: {
        cookie: "better-auth.session_token=secret; theme=1",
        "x-morph-storefront-id": "spoofed",
        "x-morph-release-id": "spoofed",
      },
    });
    const seen = JSON.parse(answer.body) as Record<string, string>;
    expect(seen.cookie).toBe("theme=1");
    expect(seen["x-morph-storefront-id"]).toBe("sf-1");
    expect(seen["x-morph-release-id"]).toBeUndefined();
    expect(seen["x-morph-theme-build-id"]).toBe("build-1");
    expect(seen["x-morph-content-origin"]).toBe(`http://${host}`);
    expect(seen["x-morph-content-publication-id"]).toBe("pub-of-build");
  });

  it("keeps every Theme cookie and drops one under a platform name", async () => {
    const answer = await send("/cookies");
    expect(setCookies(answer)).toEqual([
      "theme_a=1; Path=/",
      "theme_b=2; Path=/",
    ]);
  });

  it("lets Theme code read the build's content through its own host", async () => {
    const answer = await send("/content");
    expect(answer.body).toBe(
      `200:${JSON.stringify({ slots: { hero: { heading: "Frozen" } }, hiddenSlots: [] })}`,
    );
  });

  it("carries a request body", async () => {
    const answer = await send("/echo", { method: "POST", body: "hello" });
    expect(answer.body).toBe("POST:hello");
  });

  it("refuses egress anywhere else", async () => {
    const answer = await send(
      `/egress?to=${encodeURIComponent("https://example.com/")}`,
    );
    expect(answer.body).toBe(
      "403:PREVIEW_EGRESS_DENIED: Build Preview does not allow requests to https://example.com.",
    );
  });

  it("refuses a token it does not know, without reaching an instance", async () => {
    const calls = starts;
    const answer = await send("/account", {
      hostHeader: `bp-${"f".repeat(40)}.${PREVIEW_HOSTNAME}:${corePort}`,
    });
    expect(answer.status).toBe(404);
    expect(answer.body).toContain("CAPABILITY_UNKNOWN");
    expect(starts).toBe(calls);
  });

  it("starts again after the instance stops", async () => {
    await client.stop("cap-1");
    const answer = await send("/account");
    expect(answer.body).toBe("worker:/account");
    expect(starts).toBe(2);
  }, 60_000);
});
