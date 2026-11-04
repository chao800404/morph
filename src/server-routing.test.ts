// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which plane the Worker entry (`src/server.ts`) hands a request to, decided
 * by hostname alone and in this order: a Build Preview host, a Live Preview
 * (sandbox) host, a storefront host, and only then Morph Core itself.
 *
 * These planes read different content: Build Preview a build's sealed
 * snapshot behind its capability, Live Preview a draft snapshot, a storefront
 * the active release's publication. So exactly one of them may answer a
 * request, and a merchant's domain may never be read as a preview host.
 *
 * The real entry and the real hostname rules run
 * (`storefront-request-routing.ts`, `preview-proxy-credentials.ts`,
 * `build-preview-capability.ts`); each plane's handler is a spy at the module
 * boundary the entry imports it through.
 */

const spies = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  buildPreview: vi.fn(),
  sandboxProxy: vi.fn(),
  previewAccess: vi.fn(),
  storefront: vi.fn(),
  core: vi.fn(),
  platformAsset: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: spies.env,
  waitUntil: () => {},
}));
vi.mock("@/server/build-sandbox", () => ({ Sandbox: class {} }));
vi.mock("@/server/preview-sandbox", () => ({ PreviewSandbox: class {} }));
vi.mock("@/server/build-preview-sandbox", () => ({
  BuildPreviewSandbox: class {},
}));
vi.mock("@cloudflare/sandbox", () => ({
  ContainerProxy: class {},
  proxyToSandbox: spies.sandboxProxy,
  getSandbox: () => ({}),
}));
vi.mock("@/server/dev-preview-passthrough", () => ({
  restoreDevPreviewRequest: () => null,
}));
vi.mock("@/server/preview-access-request", () => ({
  servePreviewAccessRequest: spies.previewAccess,
}));
vi.mock("@/server/build-preview-request", () => ({
  serveBuildPreviewRequest: spies.buildPreview,
}));
vi.mock("@/lib/storefront/service/preview-sandbox-binding", () => ({
  previewProxyEnv: (bindings: unknown) => bindings,
  previewSandboxBinding: () => ({}),
}));
vi.mock("@/lib/storefront/service/preview-proxy-observation", () => ({
  previewResponseObservation: () => false,
  observePreviewProxyResponse: async () => {},
}));
vi.mock("@/lib/storefront/service/preview-proxy-response", () => ({
  proxyPreviewModuleRequest: (
    request: Request,
    proxy: (request: Request) => Promise<Response | null>,
  ) => proxy(request),
  finishPreviewResponse: (response: Response) => response,
}));
vi.mock("@/lib/storefront/service/storefront-production.service", () => ({
  StorefrontProductionService: class {
    handleRequest(request: Request) {
      return spies.storefront(request);
    }
  },
}));
vi.mock("@/lib/storefront/dal/storefront-content-publication.dal", () => ({
  storefrontContentPublicationDal: {},
}));
vi.mock("@/server/platform-assets", () => ({
  servePlatformAsset: spies.platformAsset,
}));
vi.mock("@tanstack/react-start/server", () => ({
  createStartHandler: () => spies.core,
  defaultStreamHandler: {},
}));

const { buildPreviewTokenFromHost } =
  await import("@/lib/storefront/service/build-preview/build-preview-capability");
const entry = (await import("./server")).default;

const PREVIEW_HOSTNAME = "preview.morph.example";
const TOKEN = "a".repeat(40);

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(spies.env)) delete spies.env[key];
  Object.assign(spies.env, {
    THEME_PREVIEW_HOSTNAME: PREVIEW_HOSTNAME,
    PUBLIC_URL: "https://cms.morph.example",
  });
  // As the real composition root answers: a response for a Build Preview
  // host, null for anything else.
  spies.buildPreview.mockImplementation(async (request: Request) =>
    buildPreviewTokenFromHost(new URL(request.url).host, spies.env)
      ? new Response("build preview")
      : null,
  );
  spies.sandboxProxy.mockImplementation(async () => new Response("sandbox"));
  spies.previewAccess.mockImplementation(
    async () => new Response("preview-access"),
  );
  spies.storefront.mockImplementation(async () => new Response("storefront"));
  spies.core.mockImplementation(async () => new Response("core"));
  spies.platformAsset.mockImplementation(async () => null);
});

async function route(host: string, path = "/") {
  const response = await entry.fetch(
    ...([new Request(`https://${host}${path}`)] as unknown as Parameters<
      typeof entry.fetch
    >),
  );
  return {
    status: response.status,
    body: await response.text(),
    previewAccess: spies.previewAccess.mock.calls.length,
    answered: {
      buildPreview: (
        await Promise.all(spies.buildPreview.mock.results.map((r) => r.value))
      ).filter((value) => value !== null).length,
      sandbox: spies.sandboxProxy.mock.calls.length,
      storefront: spies.storefront.mock.calls.length,
      core: spies.core.mock.calls.length,
    },
  };
}

describe("the Worker entry's host routing", () => {
  it("hands a Build Preview host to Build Preview, and to nothing else", async () => {
    const { body, answered } = await route(`bp-${TOKEN}.${PREVIEW_HOSTNAME}`);
    expect(body).toBe("build preview");
    expect(answered).toEqual({
      buildPreview: 1,
      sandbox: 0,
      storefront: 0,
      core: 0,
    });
  });

  it("hands a Build Preview host's /_morph/content to Build Preview, never the published service", async () => {
    const { body, answered } = await route(
      `bp-${TOKEN}.${PREVIEW_HOSTNAME}`,
      "/_morph/content?path=/",
    );
    expect(body).toBe("build preview");
    expect(answered).toEqual({
      buildPreview: 1,
      sandbox: 0,
      storefront: 0,
      core: 0,
    });
  });

  it("refuses the Sandbox SDK's own preview host from outside, and hands it to nothing (#214 P2)", async () => {
    const { status, body, previewAccess, answered } = await route(
      `5173-sandbox-abc.${PREVIEW_HOSTNAME}`,
      "/_morph/content?path=/",
    );
    expect(status).toBe(404);
    expect(body).toBe("Not found.");
    expect(previewAccess).toBe(0);
    expect(answered).toEqual({
      buildPreview: 0,
      sandbox: 0,
      storefront: 0,
      core: 0,
    });
  });

  it("hands a pv- Live Preview host to the access check alone (#214 P2)", async () => {
    const host = `pv-${"0".repeat(32)}.${PREVIEW_HOSTNAME}`;
    const { body, previewAccess, answered } = await route(
      host,
      "/_morph/content?path=/",
    );
    expect(body).toBe("preview-access");
    expect(previewAccess).toBe(1);
    // The access check forwards a verified request itself; the entry hands
    // the host to no other plane.
    expect(answered).toEqual({
      buildPreview: 0,
      sandbox: 0,
      storefront: 0,
      core: 0,
    });
  });

  it("hands a storefront host to the published service, and to nothing else", async () => {
    const { body, answered } = await route(
      "shop.example.com",
      "/_morph/content?path=/",
    );
    expect(body).toBe("storefront");
    expect(answered).toEqual({
      buildPreview: 0,
      sandbox: 0,
      storefront: 1,
      core: 0,
    });
  });

  it.each([
    // Shaped like a sandbox label, but on the merchant's own domain.
    "5173-sandbox-abc.shop.example.com",
    // Starts like a Build Preview label, on the merchant's own domain.
    `bp-${TOKEN}.shop.example.com`,
    "bp-shoes.example.com",
    // Ends like the preview hostname without being under it.
    `5173-sandbox-abc.not${PREVIEW_HOSTNAME}`,
  ])("never treats the merchant domain %s as a preview", async (host) => {
    const { body, answered } = await route(host, "/_morph/content?path=/");
    expect(body).toBe("storefront");
    expect(answered).toEqual({
      buildPreview: 0,
      sandbox: 0,
      storefront: 1,
      core: 0,
    });
  });

  // #214 P2 closed the gap recorded here: the SDK host is refused above and a
  // pv- host reaches only the access check, whose per-request credential and
  // revocation rules are tested in preview-access.test.ts.

  it("leaves a platform host to Morph Core (control)", async () => {
    const { body, answered } = await route("cms.morph.example");
    expect(body).toBe("core");
    expect(answered).toEqual({
      buildPreview: 0,
      sandbox: 0,
      storefront: 0,
      core: 1,
    });
  });
});
