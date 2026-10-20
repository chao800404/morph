/**
 * Which preview document a frame→editor message comes from (C5, A1).
 *
 * The editor's checks on a frame message — exact origin, the frame's window,
 * the session — say which frame it came from, not which document. A frame's
 * window outlives the document in it: a page that reloads by itself (a Theme
 * source save Vite cannot hot-apply, the diagnostic script's one reload, a
 * full-page link) is a new document in the same window, and a message the
 * old one posted before it went can arrive after the new one is up. So every
 * frame→editor message carries the id of the document that sent it
 * (`documentPreviewIdentity`, on the envelope), and this decides, from that
 * id alone, what the editor takes.
 *
 * Per frame key (a new key is a new iframe, so it starts over):
 *
 * - A ready with an id the editor has not seen is a new document: the one
 *   before it is remembered as replaced.
 * - A ready with the current document's id is the same document announcing
 *   itself again (the built-in route's effect re-run, a StrictMode remount):
 *   not taken.
 * - A ready, or anything else, from a replaced document is not taken.
 * - Anything else is taken only from the current document. One from a
 *   document that has not said it is ready, or with no id while a verified
 *   document is current, is not taken: absent never equals present.
 * - A ready with no id (an older bridge) is a replacement too, and makes the
 *   frame unverified: its id-less messages are taken as before, since
 *   nothing could be checked, and none of its readies is suppressed.
 * - Before the frame's first ready there is nothing to compare: messages are
 *   taken as before (the size answer that recovers a ready the editor missed
 *   comes this way), and none makes its document current.
 *
 * Diagnostics and catalog requests are document-independent. The diagnostic
 * script is a classic script outside the module graph and carries no id; a
 * catalog request is a read answered to the window on screen, and the page
 * that asks may well be one whose ready is still to come. Neither changes
 * anything the editor holds of the frame.
 */

export type PreviewDocumentState = Readonly<{
  previewKey: string | null;
  /** The document the frame shows, by its id; null when not known. */
  current: string | null;
  /** Documents the frame showed before, most recent last; bounded. */
  replaced: ReadonlySet<string>;
  /** The latest ready named no document: what the frame shows cannot be checked. */
  unverified: boolean;
}>;

export type PreviewDocumentInput = Readonly<{
  previewKey: string | null;
  /** The message's type, already parsed. */
  type: string;
  /** The envelope's document id; null when absent or malformed. */
  previewDocument: string | null;
}>;

export type PreviewDocumentRefusal =
  | "duplicate-ready"
  | "replaced-document"
  | "other-document"
  | "no-identity";

export type PreviewDocumentVerdict =
  /** A new document came up; `documentId` null when its ready named none. */
  | Readonly<{ kind: "ready"; documentId: string | null }>
  /** Taken; `verified` when it named the current document. */
  | Readonly<{ kind: "message"; verified: boolean }>
  /** Not the current document's: not taken. */
  | Readonly<{ kind: "refused"; why: PreviewDocumentRefusal }>;

const READY = "morph:storefront-preview-ready";
const DOCUMENT_INDEPENDENT = new Set([
  "morph:storefront-preview-diagnostic",
  "morph:storefront-preview-catalog-request",
]);
/** More than any frame reloads in a session; a bound against a page that mints ids. */
const MAX_REPLACED = 64;

export function initialPreviewDocumentState(
  previewKey: string | null,
): PreviewDocumentState {
  return { previewKey, current: null, replaced: new Set(), unverified: false };
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
  };
}

const refused = (why: PreviewDocumentRefusal): PreviewDocumentVerdict => ({
  kind: "refused",
  why,
});

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
      return {
        state: replacing(state, null),
        verdict: { kind: "ready", documentId: null },
      };
    }
    if (id === state.current) return { state, verdict: refused("duplicate-ready") };
    if (state.replaced.has(id)) {
      return { state, verdict: refused("replaced-document") };
    }
    return {
      state: replacing(state, id),
      verdict: { kind: "ready", documentId: id },
    };
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
  // said it is ready yet.
  if (state.unverified && id !== null) {
    return { state, verdict: refused("other-document") };
  }
  return { state, verdict: { kind: "message", verified: false } };
}
