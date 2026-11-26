/**
 * How a preview document that has no channel in its URL gets one.
 *
 * The editor frames a preview with its channel in the query
 * (`?editorOrigin=…&previewSession=…`, read by `documentPreviewRuntimeChannel`).
 * A page that navigates as documents loses it when the author follows a plain
 * link, sends a form or is redirected: the next document has no query, so its
 * bridge says nothing and the editor cannot follow the author to it.
 *
 * That document must not take a channel from whoever frames it. So:
 *
 * 1. The editor, on every load of the frame it opened through the
 *    preview-access exchange, posts an offer
 *    (`{flowId, previewSession, bootstrapNonce}`) to the frame's window,
 *    addressed to the preview's exact origin.
 * 2. A document with no channel takes that offer from its parent window only,
 *    from an exact http(s) origin, once. It asks the preview host, with a
 *    same-origin credentialed request, whether the editor at that origin with
 *    that session opened this frame through the very grant the request
 *    carries (`/__morph/preview-auth/channel`, preview-access.ts). Only an
 *    answer of yes goes on.
 * 3. It then loads itself again with the channel in the address, plus the
 *    nonce. The document that loads has its channel the way every other one
 *    does, and says the nonce in its first ready, once; the editor takes that
 *    ready only for a nonce it offered, within ten seconds
 *    (`createPreviewChannelOffers`), and then the existing ready, ping and pong
 *    confirmation decides the frame's document as always.
 *
 * A document that already has its channel takes no offer. A refused or
 * failed verification leaves the document without one: nothing in the URL
 * stands in for it, and it is not tried again. A document restored from the
 * back-forward cache is loaded again, so it gets a new identity and the host
 * checks its access again (`installPreviewDocumentRestoreGuard`).
 *
 * This file is copied into the preview (generate-preview-bridge-sources.mjs):
 * it has no import from Morph.
 */

export const PREVIEW_CHANNEL_OFFER_MESSAGE = "morph:preview-channel-offer";
export const PREVIEW_CHANNEL_VERIFY_PATH = "/__morph/preview-auth/channel";
export const PREVIEW_CHANNEL_BOOTSTRAP_PARAM = "morphBootstrap";
/** How long an offer's nonce is good for, on the editor's clock. */
export const PREVIEW_CHANNEL_OFFER_TTL_MS = 10_000;

const FLOW_ID = /^[0-9a-f]{32}$/;
const NONCE = /^[0-9a-f]{32}$/;
const SESSION =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_OFFERS = 16;

export type PreviewChannelOfferFields = Readonly<{
  flowId: string;
  previewSession: string;
  bootstrapNonce: string;
}>;

/** The message the editor posts to the frame. It carries no secret but the nonce. */
export function channelOfferMessage(
  fields: PreviewChannelOfferFields,
): PreviewChannelOfferFields & { type: string } {
  return {
    type: PREVIEW_CHANNEL_OFFER_MESSAGE,
    flowId: fields.flowId,
    previewSession: fields.previewSession,
    bootstrapNonce: fields.bootstrapNonce,
  };
}

/**
 * What the editor reports of its preview session when it opens a frame: the
 * SHA-256 of the session, in hex. The session is in the framed address, so
 * the hash hides nothing; it is what the preview host later compares an
 * offer's session with.
 */
export async function previewSessionHash(
  previewSession: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(previewSession),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * The editor's book of offers, per frame key. A nonce is good for the frame
 * it was made for, for ten seconds. Several may be alive at once: the document
 * an offer produced loads the frame once more, and that load is offered to
 * too, before the first document's ready has been read.
 */
export function createPreviewChannelOffers() {
  let offers: Array<{ key: string; nonce: string; at: number }> = [];
  const prune = (now: number) => {
    offers = offers
      .filter((offer) => now - offer.at < PREVIEW_CHANNEL_OFFER_TTL_MS)
      .slice(-MAX_OFFERS);
  };
  return {
    issue(previewKey: string, now: number): string {
      prune(now);
      const nonce = Array.from(
        crypto.getRandomValues(new Uint8Array(16)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      offers.push({ key: previewKey, nonce, at: now });
      return nonce;
    },
    accepts(previewKey: string | null, nonce: string, now: number): boolean {
      if (previewKey === null) return false;
      return offers.some(
        (offer) =>
          offer.key === previewKey &&
          offer.nonce === nonce &&
          now - offer.at < PREVIEW_CHANNEL_OFFER_TTL_MS,
      );
    },
    /** A replaced frame or a changed session: nothing offered before counts. */
    clear() {
      offers = [];
    },
  };
}

/** What the receiver needs of the window; the real one satisfies it. */
export type PreviewChannelWindow = {
  readonly parent: unknown;
  readonly location: {
    readonly href: string;
    readonly origin: string;
    replace(url: string): void;
    reload(): void;
  };
  readonly history: {
    replaceState(state: unknown, unused: string, url?: string | null): void;
  };
  addEventListener(type: string, listener: (event: any) => void): void;
};

export type PreviewChannelBootstrapEnvironment = Readonly<{
  window: PreviewChannelWindow;
  fetch: (
    input: string,
    init: {
      method: string;
      credentials: "same-origin";
      cache: "no-store";
      headers: Record<string, string>;
      body: string;
    },
  ) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
}>;

function isExactHttpOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

function hasUrlChannel(href: string): boolean {
  try {
    const url = new URL(href);
    return (
      isExactHttpOrigin(url.searchParams.get("editorOrigin")) &&
      SESSION.test(url.searchParams.get("previewSession") ?? "")
    );
  } catch {
    return false;
  }
}

function readOffer(data: unknown): PreviewChannelOfferFields | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  if (
    record.type !== PREVIEW_CHANNEL_OFFER_MESSAGE ||
    typeof record.flowId !== "string" ||
    !FLOW_ID.test(record.flowId) ||
    typeof record.previewSession !== "string" ||
    !SESSION.test(record.previewSession) ||
    typeof record.bootstrapNonce !== "string" ||
    !NONCE.test(record.bootstrapNonce)
  ) {
    return null;
  }
  return {
    flowId: record.flowId,
    previewSession: record.previewSession,
    bootstrapNonce: record.bootstrapNonce,
  };
}

const installed = new WeakSet<object>();
const nonceTaken = new WeakSet<object>();

/**
 * The receiver, for a document that has no channel in its URL. A document that
 * has one installs nothing. One verification at most is made per document.
 */
export function installPreviewChannelBootstrap(
  environment: PreviewChannelBootstrapEnvironment,
): void {
  const { window: win } = environment;
  if (installed.has(win)) return;
  installed.add(win);
  if (hasUrlChannel(win.location.href)) return;
  let attempted = false;
  win.addEventListener("message", (event: MessageEvent) => {
    if (attempted) return;
    if (win.parent === win || !win.parent) return;
    if (event.source !== win.parent) return;
    if (!isExactHttpOrigin(event.origin)) return;
    const offer = readOffer(event.data);
    if (!offer) return;
    attempted = true;
    const editorOrigin = event.origin;
    void (async () => {
      try {
        const response = await environment.fetch(PREVIEW_CHANNEL_VERIFY_PATH, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            flowId: offer.flowId,
            editorOrigin,
            previewSession: offer.previewSession,
          }),
        });
        if (!response.ok) return;
        const answer = (await response.json()) as { ok?: unknown } | null;
        if (!answer || answer.ok !== true) return;
        const next = new URL(win.location.href);
        next.searchParams.set("editorOrigin", editorOrigin);
        next.searchParams.set("previewSession", offer.previewSession);
        next.searchParams.set(
          PREVIEW_CHANNEL_BOOTSTRAP_PARAM,
          offer.bootstrapNonce,
        );
        win.location.replace(next.href);
      } catch {
        // No verification, no channel: the document stays as it is.
      }
    })();
  });
}

/**
 * The nonce this document was loaded with, once. It is taken out of the
 * address at the same time, so a reload of this document carries none.
 */
export function takeBootstrapNonce(win: PreviewChannelWindow): string | null {
  if (nonceTaken.has(win)) return null;
  nonceTaken.add(win);
  try {
    const url = new URL(win.location.href);
    const value = url.searchParams.get(PREVIEW_CHANNEL_BOOTSTRAP_PARAM);
    if (value === null) return null;
    url.searchParams.delete(PREVIEW_CHANNEL_BOOTSTRAP_PARAM);
    win.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    return NONCE.test(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * A document restored from the back-forward cache is the one the editor saw
 * before, with its identity and its access as they were. It is loaded again.
 */
export function installPreviewDocumentRestoreGuard(
  win: PreviewChannelWindow,
): void {
  win.addEventListener("pageshow", (event: { persisted?: boolean }) => {
    if (event.persisted) win.location.reload();
  });
}
