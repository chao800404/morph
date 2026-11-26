// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  PREVIEW_CHANNEL_BOOTSTRAP_PARAM,
  PREVIEW_CHANNEL_OFFER_MESSAGE,
  PREVIEW_CHANNEL_OFFER_TTL_MS,
  PREVIEW_CHANNEL_VERIFY_PATH,
  channelOfferMessage,
  createPreviewChannelOffers,
  installPreviewChannelBootstrap,
  installPreviewDocumentRestoreGuard,
  takeBootstrapNonce,
  type PreviewChannelWindow,
} from "./preview-channel-bootstrap";

/**
 * A preview document that a link, a form or a redirect brought to the frame
 * has no channel in its URL. It learns one from the editor only after the
 * preview host agrees that this editor, with this session, opened this frame
 * (preview-access exchange binding). These tests run the preview-side
 * receiver and the editor-side offer book as plain code, with the window
 * and the network stood in for.
 */

const EDITOR = "https://editor.example.test";
const FLOW = "a".repeat(32);
const SESSION = "11111111-1111-4111-8111-111111111111";
const NONCE = "b".repeat(32);

type Listener = (event: unknown) => void;

function frameWindow(options: { href?: string; embedded?: boolean } = {}) {
  const parent = { postMessage: vi.fn() };
  const listeners = new Map<string, Listener[]>();
  const replace = vi.fn();
  const reload = vi.fn();
  const win: PreviewChannelWindow = {
    parent:
      options.embedded === false ? (undefined as never) : (parent as never),
    location: {
      href: options.href ?? "https://pv-x.preview.test/astro-nav-b",
      origin: "https://pv-x.preview.test",
      replace,
      reload,
    },
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    history: { replaceState: vi.fn() },
  } as never;
  if (options.embedded === false) (win as { parent: unknown }).parent = win;
  const fire = (type: string, event: unknown) =>
    (listeners.get(type) ?? []).forEach((listener) => listener(event));
  return { win, parent, replace, reload, fire, listeners };
}

const offer = (overrides: Record<string, unknown> = {}) => ({
  type: PREVIEW_CHANNEL_OFFER_MESSAGE,
  flowId: FLOW,
  previewSession: SESSION,
  bootstrapNonce: NONCE,
  ...overrides,
});

const ok = () =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  }));
const refused = () =>
  vi.fn(async () => ({
    ok: false,
    status: 403,
    json: async () => ({ ok: false }),
  }));

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("a queryless document's receiver", () => {
  it("stays silent until a verified offer, then loads itself again with the channel", async () => {
    const frame = frameWindow();
    const fetchImpl = ok();
    installPreviewChannelBootstrap({
      window: frame.win,
      fetch: fetchImpl as never,
    });

    expect(frame.replace).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();

    frame.fire("message", {
      source: frame.parent,
      origin: EDITOR,
      data: offer(),
    });
    await settle();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [path, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(path).toBe(PREVIEW_CHANNEL_VERIFY_PATH);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
    // What the editor claims, and where the message really came from.
    expect(JSON.parse(String(init.body))).toEqual({
      flowId: FLOW,
      editorOrigin: EDITOR,
      previewSession: SESSION,
    });

    expect(frame.replace).toHaveBeenCalledTimes(1);
    const next = new URL(frame.replace.mock.calls[0]![0] as string);
    expect(next.pathname).toBe("/astro-nav-b");
    expect(next.searchParams.get("editorOrigin")).toBe(EDITOR);
    expect(next.searchParams.get("previewSession")).toBe(SESSION);
    expect(next.searchParams.get(PREVIEW_CHANNEL_BOOTSTRAP_PARAM)).toBe(NONCE);
  });

  it("keeps the query a link already carried", async () => {
    const frame = frameWindow({
      href: "https://pv-x.preview.test/shop?page=2#top",
    });
    installPreviewChannelBootstrap({ window: frame.win, fetch: ok() as never });
    frame.fire("message", {
      source: frame.parent,
      origin: EDITOR,
      data: offer(),
    });
    await settle();
    const next = new URL(frame.replace.mock.calls[0]![0] as string);
    expect(next.searchParams.get("page")).toBe("2");
    expect(next.hash).toBe("#top");
  });

  it("makes a second queryless document bootstrap on its own", async () => {
    const first = frameWindow();
    const second = frameWindow({
      href: "https://pv-x.preview.test/astro-live",
    });
    const fetchImpl = ok();
    installPreviewChannelBootstrap({
      window: first.win,
      fetch: fetchImpl as never,
    });
    installPreviewChannelBootstrap({
      window: second.win,
      fetch: fetchImpl as never,
    });

    first.fire("message", {
      source: first.parent,
      origin: EDITOR,
      data: offer(),
    });
    await settle();
    expect(first.replace).toHaveBeenCalledTimes(1);
    expect(second.replace).not.toHaveBeenCalled();

    second.fire("message", {
      source: second.parent,
      origin: EDITOR,
      data: offer({ bootstrapNonce: "c".repeat(32) }),
    });
    await settle();
    expect(second.replace).toHaveBeenCalledTimes(1);
  });
});

describe("a receiver that fails closed", () => {
  async function refusal(
    event: (frame: ReturnType<typeof frameWindow>) => unknown,
    fetchImpl = ok(),
    options?: Parameters<typeof frameWindow>[0],
  ) {
    const frame = frameWindow(options);
    installPreviewChannelBootstrap({
      window: frame.win,
      fetch: fetchImpl as never,
    });
    frame.fire("message", event(frame));
    await settle();
    return { frame, fetchImpl };
  }

  it("ignores a message from anything but its parent window", async () => {
    const { frame, fetchImpl } = await refusal(() => ({
      source: { postMessage: vi.fn() },
      origin: EDITOR,
      data: offer(),
    }));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(frame.replace).not.toHaveBeenCalled();
  });

  it("ignores an offer in a document that is not framed", async () => {
    const { frame, fetchImpl } = await refusal(
      (f) => ({ source: f.parent, origin: EDITOR, data: offer() }),
      ok(),
      { embedded: false },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(frame.replace).not.toHaveBeenCalled();
  });

  it.each([
    ["an opaque origin", "null"],
    ["a non-http origin", "chrome-extension://abc"],
    ["an origin with a path", `${EDITOR}/editor`],
  ])("ignores an offer from %s", async (_name, origin) => {
    const { frame, fetchImpl } = await refusal((f) => ({
      source: f.parent,
      origin,
      data: offer(),
    }));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(frame.replace).not.toHaveBeenCalled();
  });

  it.each([
    ["a flow id of the wrong shape", { flowId: "flow-1" }],
    ["a session of the wrong shape", { previewSession: "session" }],
    ["a nonce of the wrong shape", { bootstrapNonce: "short" }],
    ["a missing nonce", { bootstrapNonce: undefined }],
    ["another message type", { type: "morph:something-else" }],
  ])("ignores an offer with %s", async (_name, change) => {
    const { frame, fetchImpl } = await refusal((f) => ({
      source: f.parent,
      origin: EDITOR,
      data: offer(change),
    }));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(frame.replace).not.toHaveBeenCalled();
  });

  it("stays channel-less when the preview host refuses the binding, and never retries", async () => {
    const fetchImpl = refused();
    const { frame } = await refusal(
      (f) => ({ source: f.parent, origin: EDITOR, data: offer() }),
      fetchImpl,
    );
    expect(frame.replace).not.toHaveBeenCalled();
    frame.fire("message", {
      source: frame.parent,
      origin: EDITOR,
      data: offer(),
    });
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(frame.replace).not.toHaveBeenCalled();
  });

  it("stays channel-less when the verification cannot be made", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const { frame } = await refusal(
      (f) => ({ source: f.parent, origin: EDITOR, data: offer() }),
      fetchImpl as never,
    );
    expect(frame.replace).not.toHaveBeenCalled();
  });

  it("verifies one offer only: a second one, even a good one, is not tried", async () => {
    const frame = frameWindow();
    const fetchImpl = ok();
    installPreviewChannelBootstrap({
      window: frame.win,
      fetch: fetchImpl as never,
    });
    frame.fire("message", {
      source: frame.parent,
      origin: EDITOR,
      data: offer(),
    });
    frame.fire("message", {
      source: frame.parent,
      origin: "https://other.example.test",
      data: offer({ bootstrapNonce: "d".repeat(32) }),
    });
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not let a URL channel stand in for a refused offer", async () => {
    const href = `https://pv-x.preview.test/x?editorOrigin=${encodeURIComponent(EDITOR)}&previewSession=${SESSION}`;
    const frame = frameWindow({ href });
    const fetchImpl = refused();
    installPreviewChannelBootstrap({
      window: frame.win,
      fetch: fetchImpl as never,
    });
    frame.fire("message", {
      source: frame.parent,
      origin: EDITOR,
      data: offer(),
    });
    await settle();
    // A document that already has its channel has no use for an offer.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(frame.replace).not.toHaveBeenCalled();
  });
});

describe("the bootstrap nonce a reloaded document carries", () => {
  it("is read once and removed from the address, so a reload carries none", () => {
    const frame = frameWindow({
      href: `https://pv-x.preview.test/b?editorOrigin=${encodeURIComponent(EDITOR)}&previewSession=${SESSION}&${PREVIEW_CHANNEL_BOOTSTRAP_PARAM}=${NONCE}`,
    });
    expect(takeBootstrapNonce(frame.win)).toBe(NONCE);
    const replaceState = frame.win.history.replaceState as ReturnType<
      typeof vi.fn
    >;
    expect(replaceState).toHaveBeenCalledTimes(1);
    const cleaned = new URL(
      String(replaceState.mock.calls[0]![2]),
      frame.win.location.href,
    );
    expect(cleaned.searchParams.has(PREVIEW_CHANNEL_BOOTSTRAP_PARAM)).toBe(
      false,
    );
    expect(cleaned.searchParams.get("previewSession")).toBe(SESSION);
    expect(takeBootstrapNonce(frame.win)).toBeNull();
  });

  it("is null for a document without one, and for one of the wrong shape", () => {
    expect(takeBootstrapNonce(frameWindow().win)).toBeNull();
    const odd = frameWindow({
      href: `https://pv-x.preview.test/b?${PREVIEW_CHANNEL_BOOTSTRAP_PARAM}=not-a-nonce`,
    });
    expect(takeBootstrapNonce(odd.win)).toBeNull();
  });
});

describe("the editor's offers", () => {
  const T0 = 1_000_000;

  it("names a nonce that is good for ten seconds on the frame it was made for", () => {
    const offers = createPreviewChannelOffers();
    const nonce = offers.issue("frame-1", T0);
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(offers.accepts("frame-1", nonce, T0 + 1)).toBe(true);
    expect(
      offers.accepts("frame-1", nonce, T0 + PREVIEW_CHANNEL_OFFER_TTL_MS),
    ).toBe(false);
  });

  it("refuses a nonce it never made, or made for another frame", () => {
    const offers = createPreviewChannelOffers();
    const nonce = offers.issue("frame-1", T0);
    expect(offers.accepts("frame-1", "e".repeat(32), T0)).toBe(false);
    expect(offers.accepts("frame-2", nonce, T0)).toBe(false);
    expect(offers.accepts(null, nonce, T0)).toBe(false);
  });

  it("lets a newer offer on the same frame leave the earlier one alive until it expires", () => {
    const offers = createPreviewChannelOffers();
    const first = offers.issue("frame-1", T0);
    const second = offers.issue("frame-1", T0 + 3000);
    expect(second).not.toBe(first);
    expect(offers.accepts("frame-1", first, T0 + 4000)).toBe(true);
    expect(offers.accepts("frame-1", second, T0 + 4000)).toBe(true);
    expect(
      offers.accepts("frame-1", first, T0 + PREVIEW_CHANNEL_OFFER_TTL_MS + 1),
    ).toBe(false);
  });

  it("forgets every offer of a frame that was replaced or whose session changed", () => {
    const offers = createPreviewChannelOffers();
    const nonce = offers.issue("frame-1", T0);
    offers.clear();
    expect(offers.accepts("frame-1", nonce, T0 + 1)).toBe(false);
  });

  it("builds the message the receiver parses, carrying no secret but the nonce", () => {
    expect(
      channelOfferMessage({
        flowId: FLOW,
        previewSession: SESSION,
        bootstrapNonce: NONCE,
      }),
    ).toEqual({
      type: PREVIEW_CHANNEL_OFFER_MESSAGE,
      flowId: FLOW,
      previewSession: SESSION,
      bootstrapNonce: NONCE,
    });
  });
});

describe("a document restored from the back-forward cache", () => {
  it("is loaded again, so it gets a new identity and the host checks its access again", () => {
    const frame = frameWindow();
    installPreviewDocumentRestoreGuard(frame.win);
    frame.fire("pageshow", { persisted: false });
    expect(frame.reload).not.toHaveBeenCalled();
    frame.fire("pageshow", { persisted: true });
    expect(frame.reload).toHaveBeenCalledTimes(1);
  });
});
