/**
 * Which preview document a frame→editor message comes from (C5, A1), and
 * which document the editor takes as the frame's (option A).
 *
 * The editor's checks on a frame message — exact origin, the frame's window,
 * the session — say which frame it came from, not which document. A frame's
 * window outlives the document in it: a page that reloads by itself (a Theme
 * source save Vite cannot hot-apply, the diagnostic script's one reload, a
 * full-page link) is a new document in the same window. So every
 * frame→editor message carries the id of the document that sent it
 * (`documentPreviewIdentity`, on the envelope), and this decides what the
 * editor takes.
 *
 * A ready names a document, but a ready can arrive from a document that is
 * no longer in the frame: one never seen, or one past the memory of replaced
 * documents. Its input is then the same as a real new document's. So a ready
 * with an id the editor has not taken is only a candidate. The editor asks
 * the frame who it is, with the existing ping, in an id range of its own
 * (`PREVIEW_DOCUMENT_PROBE_BASE`). A post to the frame's window reaches only
 * the document active in it, so the pong to that ping comes from the active
 * document and names it. The candidate becomes the frame's document only
 * when that pong names it; any other answer refuses it, and so does no
 * answer in time (`expirePreviewDocumentCandidate`). Until then nothing the
 * editor holds of the frame changes, and the candidate's own messages are
 * not taken.
 *
 * Per frame key (a new key is a new iframe, so it starts over):
 *
 * - A ready with the current document's id, or a remembered replaced one's,
 *   is not taken and asks nothing.
 * - Anything else is taken only from the current document. One from a
 *   replaced document, from a document that is not current, or with no id
 *   while a verified document is current, is not taken: absent never equals
 *   present.
 * - A frame on a bridge older than the id sends readies with no id, and its
 *   pongs name nothing, so it can never be confirmed. Its first ready on a
 *   key is taken: nothing can be open or armed then that it could end or
 *   cancel. Any later id-less ready on that key, and one while a verified
 *   document is current, is not taken (`unconfirmable-ready`). Its id-less
 *   messages are taken as before.
 * - Before the frame's first ready there is nothing to compare: messages are
 *   taken as before (the size answer that recovers a ready the editor missed
 *   comes this way), and none makes its document current.
 *
 * Diagnostics and catalog requests are document-independent. The diagnostic
 * script is a classic script outside the module graph and carries no id; a
 * catalog request is a read answered to the window on screen, and the page
 * that asks may well be one whose ready is still to come. Neither changes
 * anything the editor holds of the frame.
 *
 * Theme JavaScript in the active document can post anything, a forged id
 * included; that was out of scope before and still is.
 */

/** Confirmation pings use ids from here on: far above any heartbeat's, which skips them. */
export const PREVIEW_DOCUMENT_PROBE_BASE = 2 ** 40;
/** How long a candidate has to be confirmed. */
export const PREVIEW_DOCUMENT_CONFIRM_TIMEOUT_MS = 5_000;

export type PreviewDocumentState = Readonly<{
  previewKey: string | null;
  /** The document the frame shows, by its id; null when not known. */
  current: string | null;
  /** Documents the frame showed before, most recent last; bounded. */
  replaced: ReadonlySet<string>;
  /** The ready taken last named no document: what the frame shows cannot be checked. */
  unverified: boolean;
  /** A ready has been taken on this key. */
  taken: boolean;
  /** The ready waiting to be confirmed, and the ping that asks. */
  pending: Readonly<{ id: string; probe: number }> | null;
}>;

export type PreviewDocumentInput = Readonly<{
  previewKey: string | null;
  /** The message's type, already parsed. */
  type: string;
  /** The envelope's document id; null when absent or malformed. */
  previewDocument: string | null;
  /** For a ready: the id of the confirmation ping the editor would send. */
  probe?: number;
  /** For a pong: the ping it answers. */
  heartbeatId?: number;
}>;

export type PreviewDocumentRefusal =
  | "duplicate-ready"
  | "replaced-document"
  | "other-document"
  | "no-identity"
  | "not-active"
  | "unconfirmable-ready";

export type PreviewDocumentVerdict =
  /** The frame's document now; `documentId` null for an older bridge's first ready. */
  | Readonly<{ kind: "ready"; documentId: string | null }>
  /** Not taken yet: the editor asks with a ping of id `probe`. */
  | Readonly<{ kind: "candidate"; documentId: string; probe: number }>
  /** Taken; `verified` when it named the current document. */
  | Readonly<{ kind: "message"; verified: boolean }>
  /** Not the current document's: not taken. */
  | Readonly<{ kind: "refused"; why: PreviewDocumentRefusal }>;

const READY = "morph:storefront-preview-ready";
const PONG = "morph:storefront-preview-pong";
const DOCUMENT_INDEPENDENT = new Set([
  "morph:storefront-preview-diagnostic",
  "morph:storefront-preview-catalog-request",
]);
/** A shortcut only: the confirmation decides; this saves a round trip. */
const MAX_REPLACED = 64;

export function initialPreviewDocumentState(
  previewKey: string | null,
): PreviewDocumentState {
  return {
    previewKey,
    current: null,
    replaced: new Set(),
    unverified: false,
    taken: false,
    pending: null,
  };
}

function replacing(
  state: PreviewDocumentState,
  current: string | null,
): PreviewDocumentState {
  const replaced = [...state.replaced];
  if (state.current !== null) replaced.push(state.current);
  return {
    previewKey: state.previewKey,
    current,
    replaced: new Set(replaced.slice(-MAX_REPLACED)),
    unverified: current === null,
    taken: true,
    pending: null,
  };
}

const refused = (why: PreviewDocumentRefusal): PreviewDocumentVerdict => ({
  kind: "refused",
  why,
});

/** Drops the candidate the ping `probe` asked about, if it still waits. */
export function expirePreviewDocumentCandidate(
  state: PreviewDocumentState,
  probe: number,
): PreviewDocumentState {
  return state.pending?.probe === probe ? { ...state, pending: null } : state;
}

/** What one message is, given what the frame has said so far. Pure. */
export function classifyPreviewDocument(
  given: PreviewDocumentState,
  input: PreviewDocumentInput,
): { state: PreviewDocumentState; verdict: PreviewDocumentVerdict } {
  const state =
    given.previewKey === input.previewKey
      ? given
      : initialPreviewDocumentState(input.previewKey);
  const id = input.previewDocument;

  if (input.type === READY) {
    if (id === null) {
      // An older bridge: confirmable never, so taken only as the key's first.
      if (state.taken) return { state, verdict: refused("unconfirmable-ready") };
      return {
        state: replacing(state, null),
        verdict: { kind: "ready", documentId: null },
      };
    }
    if (id === state.current) return { state, verdict: refused("duplicate-ready") };
    if (state.replaced.has(id)) {
      return { state, verdict: refused("replaced-document") };
    }
    if (id === state.pending?.id) {
      return { state, verdict: refused("duplicate-ready") };
    }
    const probe = input.probe ?? PREVIEW_DOCUMENT_PROBE_BASE;
    return {
      state: { ...state, pending: { id, probe } },
      verdict: { kind: "candidate", documentId: id, probe },
    };
  }

  // The answer to the confirmation ping: from the active document.
  if (
    input.type === PONG &&
    state.pending !== null &&
    input.heartbeatId === state.pending.probe
  ) {
    if (id === state.pending.id) {
      return {
        state: replacing(state, id),
        verdict: { kind: "ready", documentId: id },
      };
    }
    return { state: { ...state, pending: null }, verdict: refused("not-active") };
  }

  if (DOCUMENT_INDEPENDENT.has(input.type)) {
    return {
      state,
      verdict: { kind: "message", verified: id !== null && id === state.current },
    };
  }
  if (id !== null && state.replaced.has(id)) {
    return { state, verdict: refused("replaced-document") };
  }
  if (state.current !== null) {
    if (id === state.current) {
      return { state, verdict: { kind: "message", verified: true } };
    }
    return {
      state,
      verdict: refused(id === null ? "no-identity" : "other-document"),
    };
  }
  // No verified document is current: the frame is unverified, or has not
  // said it is ready yet. A candidate is not current either.
  if (id !== null && (state.unverified || id === state.pending?.id)) {
    return { state, verdict: refused("other-document") };
  }
  return { state, verdict: { kind: "message", verified: false } };
}
