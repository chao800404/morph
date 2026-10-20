import { describe, expect, it } from "vitest";
import {
  classifyPreviewDocument,
  initialPreviewDocumentState,
  type PreviewDocumentState,
  type PreviewDocumentVerdict,
} from "./preview-document-identity";

const A = "a".repeat(32);
const B = "b".repeat(32);
const C = "c".repeat(32);
const READY = "morph:storefront-preview-ready";
const COMMIT = "morph:storefront-preview-commit-inline-text";
const ROUTE_APPLIED = "morph:storefront-preview-route-applied";
const DIAGNOSTIC = "morph:storefront-preview-diagnostic";
const CATALOG = "morph:storefront-preview-catalog-request";

type Step = Readonly<{
  type: string;
  id: string | null;
  key?: string | null;
}>;

/** Runs the steps on one frame key ("k1" unless a step names another). */
function run(steps: readonly Step[]) {
  let state: PreviewDocumentState = initialPreviewDocumentState("k1");
  const verdicts: PreviewDocumentVerdict[] = [];
  for (const step of steps) {
    const result = classifyPreviewDocument(state, {
      previewKey: step.key === undefined ? "k1" : step.key,
      type: step.type,
      previewDocument: step.id,
    });
    state = result.state;
    verdicts.push(result.verdict);
  }
  return { state, verdicts, last: verdicts.at(-1)! };
}

const ready = (id: string | null, key?: string | null): Step => ({ type: READY, id, key });
const commit = (id: string | null, key?: string | null): Step => ({ type: COMMIT, id, key });

describe("which document a frame message comes from (C5, A1)", () => {
  it("first: the first ready with an id is the frame's document", () => {
    const { last, state } = run([ready(A)]);
    expect(last).toEqual({ kind: "ready", documentId: A });
    expect(state.current).toBe(A);
  });

  it("new: a ready with another id replaces the document; the old one is remembered", () => {
    const { last, state } = run([ready(A), ready(B)]);
    expect(last).toEqual({ kind: "ready", documentId: B });
    expect(state.current).toBe(B);
    expect([...state.replaced]).toEqual([A]);
  });

  it("duplicate: the same id again is not a new document, and is not taken", () => {
    const { last, state } = run([ready(A), ready(A)]);
    expect(last).toEqual({ kind: "refused", why: "duplicate-ready" });
    expect(state.current).toBe(A);
    expect([...state.replaced]).toEqual([]);
  });

  it("late: a ready from a replaced document never comes back as the current one", () => {
    const { last, state } = run([ready(A), ready(B), ready(A)]);
    expect(last).toEqual({ kind: "refused", why: "replaced-document" });
    expect(state.current).toBe(B);
  });

  it("replaced: any message from a replaced document is refused", () => {
    expect(run([ready(A), ready(B), commit(A)]).last).toEqual({
      kind: "refused",
      why: "replaced-document",
    });
    expect(
      run([ready(A), ready(B), { type: ROUTE_APPLIED, id: A }]).last,
    ).toEqual({ kind: "refused", why: "replaced-document" });
  });

  it("current: a message from the current document is taken, verified", () => {
    expect(run([ready(A), commit(A)]).last).toEqual({ kind: "message", verified: true });
    expect(run([ready(A), ready(B), commit(B)]).last).toEqual({
      kind: "message",
      verified: true,
    });
  });

  it("id mismatch: a message from a document that has not said ready is refused", () => {
    expect(run([ready(A), commit(C)]).last).toEqual({
      kind: "refused",
      why: "other-document",
    });
    // And does not become the current one by being seen.
    const { state } = run([ready(A), commit(C)]);
    expect(state.current).toBe(A);
  });

  it("absent id: never equals a present one, so it is refused while a verified document is current", () => {
    expect(run([ready(A), commit(null)]).last).toEqual({
      kind: "refused",
      why: "no-identity",
    });
  });

  it("missing: a ready without an id is a replacement, unverified", () => {
    const { last, state } = run([ready(A), ready(null)]);
    expect(last).toEqual({ kind: "ready", documentId: null });
    expect(state.current).toBeNull();
    expect(state.unverified).toBe(true);
    expect([...state.replaced]).toEqual([A]);
  });

  it("missing: every id-less ready is a replacement; nothing is suppressed as a duplicate", () => {
    const { verdicts } = run([ready(null), ready(null), ready(null)]);
    expect(verdicts).toEqual([
      { kind: "ready", documentId: null },
      { kind: "ready", documentId: null },
      { kind: "ready", documentId: null },
    ]);
  });

  it("missing: while unverified, id-less messages are taken as before, and unverified", () => {
    expect(run([ready(null), commit(null)]).last).toEqual({
      kind: "message",
      verified: false,
    });
  });

  it("missing: while unverified, a message naming some document is not the id-less one on screen", () => {
    expect(run([ready(null), commit(A)]).last).toEqual({
      kind: "refused",
      why: "other-document",
    });
    // Nor one the frame was before.
    expect(run([ready(A), ready(null), commit(A)]).last).toEqual({
      kind: "refused",
      why: "replaced-document",
    });
  });

  it("mixed: verified, then id-less, then verified again", () => {
    const { verdicts, state } = run([ready(A), ready(null), ready(B), commit(B), ready(A)]);
    expect(verdicts).toEqual([
      { kind: "ready", documentId: A },
      { kind: "ready", documentId: null },
      { kind: "ready", documentId: B },
      { kind: "message", verified: true },
      { kind: "refused", why: "replaced-document" },
    ]);
    expect(state.unverified).toBe(false);
  });

  it("before any ready: nothing to compare, so messages are taken as before, unverified", () => {
    // The size answer that recovers a ready the editor missed comes this way.
    expect(run([commit(A)]).last).toEqual({ kind: "message", verified: false });
    expect(run([commit(null)]).last).toEqual({ kind: "message", verified: false });
    // And being seen does not make a document current.
    expect(run([commit(A), commit(B)]).state.current).toBeNull();
  });

  it("a new frame key starts over: another frame, with nothing replaced yet", () => {
    const { verdicts, state } = run([ready(A), ready(B), ready(A, "k2"), commit(A, "k2")]);
    expect(verdicts.slice(2)).toEqual([
      { kind: "ready", documentId: A },
      { kind: "message", verified: true },
    ]);
    expect(state.previewKey).toBe("k2");
    expect([...state.replaced]).toEqual([]);
  });

  it("diagnostics and catalog requests are document-independent: taken from any document", () => {
    // The diagnostic script is a classic script outside the module graph and
    // carries no id; a catalog request is answered to the window on screen
    // and changes nothing the editor holds of the frame.
    for (const type of [DIAGNOSTIC, CATALOG]) {
      expect(run([ready(A), { type, id: null }]).last).toEqual({
        kind: "message",
        verified: false,
      });
      expect(run([ready(A), ready(B), { type, id: A }]).last).toEqual({
        kind: "message",
        verified: false,
      });
      expect(run([ready(A), { type, id: C }]).last).toEqual({
        kind: "message",
        verified: false,
      });
      expect(run([ready(A), { type, id: A }]).last).toEqual({
        kind: "message",
        verified: true,
      });
    }
  });

  it("keeps a bounded memory of replaced documents", () => {
    const ids = Array.from({ length: 100 }, (_, index) =>
      index.toString(16).padStart(32, "0"),
    );
    const { state } = run(ids.map((id) => ready(id)));
    expect(state.current).toBe(ids.at(-1));
    expect(state.replaced.size).toBeLessThanOrEqual(64);
    // The most recent ones are the ones kept.
    expect(state.replaced.has(ids.at(-2)!)).toBe(true);
  });

  it("does not change the state it was given", () => {
    const state = initialPreviewDocumentState("k1");
    const frozen = Object.freeze({ ...state, replaced: new Set<string>() });
    const result = classifyPreviewDocument(frozen, {
      previewKey: "k1",
      type: READY,
      previewDocument: A,
    });
    expect(frozen.current).toBeNull();
    expect(result.state).not.toBe(frozen);
    const next = classifyPreviewDocument(result.state, {
      previewKey: "k1",
      type: READY,
      previewDocument: B,
    });
    expect([...result.state.replaced]).toEqual([]);
    expect([...next.state.replaced]).toEqual([A]);
  });
});

/**
 * KNOWN GAP (2026-10-20): a late ready from an older document whose id the
 * editor never saw, or no longer remembers (past the 64-entry memory).
 *
 * Its input — frame key, type, an id never seen, arrival after the current
 * document's ready — is exactly a genuine new document's, so no rule over the
 * data A1 has can refuse one and take the other: these stay red until the
 * ready carries something that orders documents (see the PR's proposal).
 * They are `it.fails`, so the suite records the gap, and goes red the day it
 * closes, when they should become plain tests.
 */
describe("KNOWN GAP: a late ready from an older document the editor never saw", () => {
  const X = "e".repeat(32);

  it.fails("is not taken (today an unseen id reads as a new document)", () => {
    // X loaded before B; its ready arrives only now, after B's.
    const { last, state } = run([ready(A), ready(B), ready(X)]);
    expect(last).toEqual({ kind: "refused", why: "replaced-document" });
    expect(state.current).toBe(B);
  });

  it.fails("past the memory: a replaced document's late ready is not taken", () => {
    const ids = Array.from({ length: 66 }, (_, index) =>
      index.toString(16).padStart(32, "0"),
    );
    const { last, state } = run([...ids.map((id) => ready(id)), ready(ids[0]!)]);
    expect(last).toEqual({ kind: "refused", why: "replaced-document" });
    expect(state.current).toBe(ids.at(-1));
  });
});
