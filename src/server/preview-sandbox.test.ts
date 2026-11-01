// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The SDK needs the Workers runtime to load. This stand-in registers an
// outbound handler the way `@cloudflare/containers` does — through an
// inherited static accessor, keyed by class name — which is the mechanism a
// `static outbound = …` field would silently bypass. That the real SDK then
// applies it is checked against a real container, not here.
const registry = vi.hoisted(() => new Map<string, unknown>());
// The SDK's own fetch, which a test holds and releases: what the SDK does
// with a request is its business; what PreviewSandbox does around it is ours.
const sdk = vi.hoisted(() => ({
  fetch: vi.fn<(request: Request) => Promise<unknown>>(),
}));
const access = vi.hoisted(() => ({ reverify: vi.fn() }));
vi.mock("@cloudflare/sandbox", () => {
  class Sandbox {
    static get outbound(): unknown {
      return registry.get(this.name);
    }
    static set outbound(handler: unknown) {
      registry.set(this.name, handler);
    }
    fetch(request: Request) {
      return sdk.fetch(request);
    }
  }
  return { Sandbox };
});
vi.mock("@/lib/storefront/service/preview-access/preview-access", () => ({
  reverifyPreviewAccessGrant: access.reverify,
}));

import { Sandbox } from "@cloudflare/sandbox";
// The repo's own JSONC reader for wrangler.jsonc; a plain .mjs with no types.
// @ts-expect-error TS7016
import { parseJsonc } from "../../scripts/theme-runtime-wiring-scan.mjs";
import { PREVIEW_EGRESS_HEADER } from "@/lib/storefront/service/preview-egress-policy";
import { PreviewSandbox } from "./preview-sandbox";

describe("the Live Preview container class", () => {
  it("registers its refusal as the class's outbound handler", async () => {
    // Registered through the inherited static setter. A `static outbound`
    // field would define its own property instead, and the SDK would find no
    // handler for the class.
    // Read from the registry, not the class: a field would still answer
    // `PreviewSandbox.outbound` while leaving the registry empty.
    const handler = registry.get("PreviewSandbox") as
      | ((...args: unknown[]) => Response)
      | undefined;
    expect(handler).toBeTypeOf("function");
    expect(Object.getOwnPropertyNames(PreviewSandbox)).not.toContain("outbound");
    const response = await handler!(
      new Request("https://api.example.com/"),
      {} as never,
      { containerId: "c", className: "PreviewSandbox" } as never,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get(PREVIEW_EGRESS_HEADER)).toBeTruthy();
  });

  it("leaves the build and deploy class without one", () => {
    expect(Sandbox.outbound).toBeUndefined();
  });

  it("declares no internet and HTTPS interception", () => {
    // Instance fields exist only on a constructed Durable Object, which needs
    // a container runtime; the declaration is checked here, and the behaviour
    // in the Sandbox-transport check against a real container.
    const source = readFileSync("src/server/preview-sandbox.ts", "utf8");
    expect(source).toMatch(/^\s+enableInternet = false;$/m);
    expect(source).toMatch(/^\s+interceptHttps = true;$/m);
  });
});

describe("the Worker's container configuration", () => {
  const config = parseJsonc(readFileSync("wrangler.jsonc", "utf8")).value;

  it("binds PreviewSandbox with its own container and migration", () => {
    expect(config.durable_objects.bindings).toEqual(
      expect.arrayContaining([
        { name: "Sandbox", class_name: "Sandbox" },
        { name: "PreviewSandbox", class_name: "PreviewSandbox" },
      ]),
    );
    expect(
      config.containers.map((container: { class_name: string }) => container.class_name),
    ).toEqual(expect.arrayContaining(["Sandbox", "PreviewSandbox"]));
    expect(
      config.migrations.flatMap(
        (migration: { new_sqlite_classes?: string[] }) =>
          migration.new_sqlite_classes ?? [],
      ),
    ).toContain("PreviewSandbox");
  });

  it("exports the classes and ContainerProxy from the Worker entry", () => {
    const entry = readFileSync("src/server.ts", "utf8");
    expect(entry).toMatch(/export \{ PreviewSandbox \}/);
    expect(entry).toMatch(/export \{ ContainerProxy \}/);
  });
});

/** A Workers WebSocket stand-in. */
function fakeSocket() {
  const listeners: Record<string, Array<(event: unknown) => void>> = {};
  return {
    accepted: false,
    // workerd's default from compatibility date 2026-03-17.
    binaryType: "blob" as "blob" | "arraybuffer",
    acceptedAs: null as "blob" | "arraybuffer" | null,
    sent: [] as unknown[],
    closes: [] as Array<{ code?: number; reason?: string }>,
    accept() {
      this.accepted = true;
      this.acceptedAs = this.binaryType;
    },
    /** A binary frame arriving, as workerd hands it to `message`. */
    receiveBinary(bytes: number[]) {
      const data =
        this.binaryType === "arraybuffer"
          ? new Uint8Array(bytes).buffer
          : new Blob([new Uint8Array(bytes)]);
      (listeners.message ?? []).forEach((l) => l({ data }));
    },
    send(data: unknown) {
      this.sent.push(data);
    },
    close(code?: number, reason?: string) {
      this.closes.push({ code, reason });
    },
    addEventListener(type: string, listener: (event: unknown) => void) {
      (listeners[type] ??= []).push(listener);
    },
    emit(type: string, event: unknown) {
      (listeners[type] ?? []).forEach((l) => l(event));
    },
  };
}
type FakeSocket = ReturnType<typeof fakeSocket>;

describe("the Live Preview DO relays pv- sockets under their grant (#214 P4, A5/A6)", () => {
  const GRANT = "grant-1";
  const HOST = "pv-0123456789abcdef0123456789abcdef.preview.example.test";
  let pairs: Array<{ client: FakeSocket; server: FakeSocket }>;

  beforeEach(() => {
    pairs = [];
    sdk.fetch.mockReset();
    access.reverify.mockReset();
    access.reverify.mockResolvedValue({ ok: true });
    vi.stubGlobal(
      "WebSocketPair",
      class {
        0: FakeSocket;
        1: FakeSocket;
        constructor() {
          const client = fakeSocket();
          const server = fakeSocket();
          pairs.push({ client, server });
          this[0] = client;
          this[1] = server;
        }
      },
    );
    // Node's Response refuses 101; the Workers one carries a socket with it.
    const RealResponse = Response;
    vi.stubGlobal(
      "Response",
      class {
        status: number;
        headers: Headers;
        webSocket: unknown;
        body: unknown;
        constructor(body: unknown, init: { status?: number; headers?: HeadersInit; webSocket?: unknown } = {}) {
          this.body = body;
          this.status = init.status ?? 200;
          this.headers = new Headers(init.headers);
          this.webSocket = init.webSocket ?? null;
        }
        text() {
          return new RealResponse(this.body as string).text();
        }
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const sandbox = () =>
    new (PreviewSandbox as unknown as new () => InstanceType<typeof PreviewSandbox>)();
  const upgrade = (headers: Record<string, string> = {}) =>
    new Request(`https://${HOST}/socket`, {
      headers: {
        upgrade: "websocket",
        "x-morph-preview-grant": GRANT,
        "x-morph-preview-host": HOST,
        ...headers,
      },
    });
  const switched = (container: FakeSocket) => ({
    status: 101,
    headers: new Headers(),
    webSocket: container,
  });

  it("refuses to relay when the grant is revoked while the SDK is still opening the container socket", async () => {
    const container = fakeSocket();
    let release!: (value: unknown) => void;
    sdk.fetch.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const object = sandbox();

    const answer = object.fetch(upgrade());
    await Promise.resolve();
    expect(await object.closePreviewGrants([GRANT])).toBe(0);
    release(switched(container));
    const response = (await answer) as unknown as { status: number; webSocket: unknown };

    expect(response.status).toBe(403);
    expect(response.webSocket).toBeNull();
    expect(container.closes).toEqual([{ code: 1000, reason: "Preview access ended." }]);
    // No relay was registered, and no browser socket was made.
    expect(pairs).toEqual([]);
    expect(await object.closePreviewGrants([GRANT])).toBe(0);
    container.emit("message", { data: "after" });
    expect(access.reverify).not.toHaveBeenCalled();
  });

  it("refuses a new socket for a grant revoked before its upgrade, without asking the SDK", async () => {
    const object = sandbox();
    await object.closePreviewGrants([GRANT]);
    const response = (await object.fetch(upgrade())) as unknown as { status: number };
    expect(response.status).toBe(403);
    expect(sdk.fetch).not.toHaveBeenCalled();
  });

  it("keeps that refusal 2·L, and only that long", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const object = sandbox();
    await object.closePreviewGrants([GRANT]);
    vi.setSystemTime(1_000_000 + 60_000);
    expect(((await object.fetch(upgrade())) as unknown as { status: number }).status).toBe(403);
    vi.setSystemTime(1_000_000 + 60_001);
    sdk.fetch.mockResolvedValue(switched(fakeSocket()));
    expect(((await object.fetch(upgrade())) as unknown as { status: number }).status).toBe(101);
  });

  it("relays a socket under its grant, and a push closes it 4401", async () => {
    const container = fakeSocket();
    sdk.fetch.mockResolvedValue(switched(container));
    const object = sandbox();
    const response = (await object.fetch(upgrade())) as unknown as { status: number; webSocket: unknown };
    expect(response.status).toBe(101);
    expect(response.webSocket).toBe(pairs[0]!.client);
    expect(container.accepted && pairs[0]!.server.accepted).toBe(true);
    expect(access.reverify).toHaveBeenCalledWith(
      expect.objectContaining({ grantId: GRANT, previewHost: HOST }),
    );

    expect(await object.closePreviewGrants([GRANT])).toBe(1);
    expect(pairs[0]!.server.closes[0]!.code).toBe(4401);
    expect(container.closes[0]!.code).toBe(1000);
    // Ended, so it is no longer counted.
    expect(await object.closePreviewGrants([GRANT])).toBe(0);
  });

  it("takes binary frames as ArrayBuffer on both sides, so workerd's Blob default is never refused", async () => {
    const container = fakeSocket();
    sdk.fetch.mockResolvedValue(switched(container));
    const object = sandbox();
    await object.fetch(upgrade());
    const browser = pairs[0]!.server;

    browser.receiveBinary([0, 1, 255]);
    container.receiveBinary([7, 8]);
    await vi.waitFor(() => {
      expect(container.sent).toHaveLength(1);
      expect(browser.sent).toHaveLength(1);
    });
    expect([...new Uint8Array(container.sent[0] as ArrayBuffer)]).toEqual([0, 1, 255]);
    expect([...new Uint8Array(browser.sent[0] as ArrayBuffer)]).toEqual([7, 8]);
    expect([...browser.closes, ...container.closes]).toEqual([]);
    expect(container.acceptedAs).toBe("arraybuffer");
    expect(browser.acceptedAs).toBe("arraybuffer");
  });

  it("never shows the container the relay's headers, and leaves other requests to the SDK", async () => {
    sdk.fetch.mockResolvedValue({ status: 200, headers: new Headers(), webSocket: null });
    const object = sandbox();
    await object.fetch(
      new Request(`https://${HOST}/`, {
        headers: { "x-morph-preview-grant": "forged", "x-morph-preview-host": "forged" },
      }),
    );
    await object.fetch(upgrade());
    for (const [request] of sdk.fetch.mock.calls) {
      expect(request.headers.has("x-morph-preview-grant")).toBe(false);
      expect(request.headers.has("x-morph-preview-host")).toBe(false);
    }
    // An upgrade without a grant (the dev-only passthrough) is the SDK's.
    const passthrough = { status: 101, headers: new Headers(), webSocket: fakeSocket() };
    sdk.fetch.mockResolvedValue(passthrough);
    const answer = await object.fetch(
      new Request(`https://${HOST}/socket`, { headers: { upgrade: "websocket" } }),
    );
    expect(answer).toBe(passthrough);
    expect(pairs).toEqual([]);
  });
});
