import { describe, expect, it, vi } from "vitest";
import type { StorefrontBuildPreviewCapabilityDAL } from "../../dal/storefront-build-preview-capability.dal";
import { fixtureBuild } from "./build-preview-artifact.fixture";
import { hashBuildPreviewToken } from "./build-preview-capability";
import {
  handleBuildPreviewRequest,
  type BuildPreviewRequestDeps,
} from "./build-preview-request";
import type { BuildPreviewServer } from "./build-preview-server.types";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const TOKEN = "0123456789abcdef0123456789abcdef01234567";
const HOST = `bp-${TOKEN}.preview.example.test`;

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "cap-1",
    storefrontId: "sf-1",
    themeId: "th-1",
    buildId: "build-1",
    userId: "admin-1",
    expiresAt: "2026-10-07T01:00:00.000Z",
    revokedAt: null,
    build: {
      storefrontId: "sf-1",
      themeId: "th-1",
      status: "succeeded",
      artifactPrefix: "builds/1/",
      contentPublicationId: "pub-1",
    },
    themeLive: true,
    user: { role: "admin", banned: false },
    ...overrides,
  };
}

function setup(
  options: {
    record?: ReturnType<typeof record> | null;
    server?: Partial<BuildPreviewServer> | null;
    build?: ReturnType<typeof fixtureBuild>["build"] | null;
  } = {},
) {
  const server = {
    kind: "local-sidecar" as const,
    fetch: vi.fn(async () => new Response("from-instance")),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    ...options.server,
  };
  const fixture = fixtureBuild();
  const getPublishedDocument = vi.fn(async () => ({ sections: [] }));
  const deps: BuildPreviewRequestDeps = {
    env: { THEME_PREVIEW_HOSTNAME: "preview.example.test" },
    capabilityDal: {
      findByTokenHash: async (hash: string) =>
        hash === (await hashBuildPreviewToken(TOKEN))
          ? options.record === undefined
            ? record()
            : options.record
          : null,
    } as unknown as StorefrontBuildPreviewCapabilityDAL,
    readBuild: async () =>
      options.build === undefined ? fixture.build : options.build,
    r2Bucket: fixture.r2Bucket,
    contentPorts: { getPublishedDocument } as never,
    server: () =>
      options.server === null
        ? {
            enabled: false,
            reason: "BUILD_PREVIEW_UNCONFIGURED",
            message: "off",
          }
        : { enabled: true, server },
    now: new Date("2026-10-07T00:00:00.000Z"),
  };
  return { deps, server, getPublishedDocument };
}

const request = (path: string, init: RequestInit & { host?: string } = {}) =>
  new Request(`https://${init.host ?? HOST}${path}`, init);

describe("a request on a Build Preview host", () => {
  it("is not handled on any other host", async () => {
    const { deps } = setup();
    expect(
      await handleBuildPreviewRequest(
        request("/", { host: "preview.example.test" }),
        deps,
      ),
    ).toBeNull();
    expect(
      await handleBuildPreviewRequest(
        request("/", { host: `5173-abc.preview.example.test` }),
        deps,
      ),
    ).toBeNull();
  });

  it.each([
    [null, 404, "CAPABILITY_UNKNOWN"],
    [
      record({ revokedAt: "2026-10-06T00:00:00.000Z" }),
      410,
      "CAPABILITY_REVOKED",
    ],
    [
      record({ expiresAt: "2026-10-06T00:00:00.000Z" }),
      410,
      "CAPABILITY_EXPIRED",
    ],
    [
      record({ user: { role: "guest", banned: false } }),
      403,
      "USER_NOT_AUTHORIZED",
    ],
    [
      record({ build: { ...record().build, status: "failed" } }),
      409,
      "BUILD_NOT_PREVIEWABLE",
    ],
  ])(
    "is refused, without reaching an instance, for %#",
    async (stored, status, reason) => {
      const { deps, server } = setup({ record: stored });
      const response = await handleBuildPreviewRequest(
        request("/app.js"),
        deps,
      );
      expect(response?.status).toBe(status);
      expect(await response?.text()).toContain(reason);
      expect(response?.headers.get("cache-control")).toBe("no-store");
      expect(server.fetch).not.toHaveBeenCalled();
    },
  );

  it("answers /_morph/content itself, from the build's snapshot", async () => {
    const { deps, server, getPublishedDocument } = setup();
    const response = await handleBuildPreviewRequest(
      request("/_morph/content?path=/"),
      deps,
    );
    expect(response?.status).toBe(200);
    expect(getPublishedDocument).toHaveBeenCalledWith(
      expect.objectContaining({ publicationId: "pub-1" }),
    );
    expect(server.fetch).not.toHaveBeenCalled();
  });

  it("forwards to the capability's own instance", async () => {
    const { deps, server } = setup();
    const response = await handleBuildPreviewRequest(
      request("/products"),
      deps,
    );
    expect(await response?.text()).toBe("from-instance");
    expect(server.fetch).toHaveBeenCalledWith("cap-1", expect.any(Request));
    expect(server.start).not.toHaveBeenCalled();
  });

  it("starts the instance from the verified artifact when there is none", async () => {
    let running = false;
    const { deps, server } = setup({
      server: {
        fetch: vi.fn(async () => (running ? new Response("started") : null)),
        start: vi.fn(async () => {
          running = true;
        }),
      },
    });
    const response = await handleBuildPreviewRequest(request("/"), deps);
    expect(await response?.text()).toBe("started");
    expect(server.start).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: "cap-1",
        contentOrigin: `https://${HOST}`,
        contentUpstream: "https://localhost:443",
        artifact: expect.objectContaining({ buildId: "build-1" }),
      }),
    );
  });

  it("tells a container Theme its content origin on a port its egress policy sees", async () => {
    let running = false;
    const fetches: Request[] = [];
    const { deps, server } = setup({
      server: {
        kind: "cloudflare-sandbox",
        fetch: vi.fn(async (_id: string, forwarded: Request) => {
          fetches.push(forwarded);
          return running ? new Response("started") : null;
        }),
        start: vi.fn(async () => {
          running = true;
        }),
      },
    });
    await handleBuildPreviewRequest(new Request(`http://${HOST}:3300/`), deps);
    expect(server.start).toHaveBeenCalledWith(
      expect.objectContaining({ contentOrigin: `http://${HOST}` }),
    );
    expect(server.start).not.toHaveBeenCalledWith(
      expect.objectContaining({ contentUpstream: expect.anything() }),
    );
    expect(fetches.at(-1)?.headers.get("x-morph-content-origin")).toBe(
      `http://${HOST}`,
    );
  });

  it("does not start an instance from an artifact that fails verification", async () => {
    const tampered = fixtureBuild({
      manifest: { files: [] } as never,
    }).build;
    const { deps, server } = setup({
      server: { fetch: vi.fn(async () => null) },
      build: tampered,
    });
    const response = await handleBuildPreviewRequest(request("/"), deps);
    expect(response?.status).toBe(409);
    expect(server.start).not.toHaveBeenCalled();
  });

  it("says so when this environment cannot run one", async () => {
    const { deps } = setup({ server: null });
    const response = await handleBuildPreviewRequest(request("/"), deps);
    expect(response?.status).toBe(503);
    expect(await response?.text()).toContain("BUILD_PREVIEW_UNCONFIGURED");
  });
});
