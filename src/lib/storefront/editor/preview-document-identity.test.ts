import { describe, expect, it } from "vitest";
import {
  classifyPreviewDocument,
  expirePreviewDocumentCandidate,
  initialPreviewDocumentState,
  PREVIEW_DOCUMENT_PROBE_BASE,
  type PreviewDocumentState,
  type PreviewDocumentVerdict,
} from "./preview-document-identity";

const A = "a".repeat(32);
const B = "b".repeat(32);
const C = "c".repeat(32);
const X = "e".repeat(32);
const READY = "morph:storefront-preview-ready";
const PONG = "morph:storefront-preview-pong";
const COMMIT = "morph:storefront-preview-commit-inline-text";
const ROUTE_APPLIED = "morph:storefront-preview-route-applied";
const DIAGNOSTIC = "morph:storefront-preview-diagnostic";
const CATALOG = "morph:storefront-preview-catalog-request";

/**
 * One frame message: `type` from the document `id` (null: no id), on frame
 * key "k1" unless `key` names another. A pong answers `heartbeatId`; left
 * out, it answers the latest confirmation ping the editor sent.
 */
type Step = Readonly<{
  type: string;
  id: string | null;
  key?: string | null;
  heartbeatId?: number;
}>;

/**
 * Runs the steps as the editor would: every ready is given the next
 * confirmation probe id, and a candidate's probe is what a pong step
 * answers by default.
 */
function run(steps: readonly Step[], initial?: PreviewDocumentState) {
  let state: PreviewDocumentState = initial ?? initialPreviewDocumentState("k1");
  let nextProbe = PREVIEW_DOCUMENT_PROBE_BASE;
  let lastProbe: number | null = null;
  const verdicts: PreviewDocumentVerdict[] = [];
  for (const step of steps) {
    const probe = (nextProbe += 1);
    const result = classifyPreviewDocument(state, {
      previewKey: step.key === undefined ? "k1" : step.key,
      type: step.type,
      previewDocument: step.id,
      probe,
      heartbeatId:
        step.type === PONG ? (step.heartbeatId ?? lastProbe ?? 0) : undefined,
    });
    state = result.state;
    if (result.verdict.kind === "candidate") lastProbe = result.verdict.probe;
    verdicts.push(result.verdict);
  }
  return { state, verdicts, last: verdicts.at(-1)! };
}

const ready = (id: string | null, key?: string | null): Step => ({ type: READY, id, key });
/** The active document `id` answers the latest confirmation ping. */
const answer = (id: string | null, key?: string | null): Step => ({ type: PONG, id, key });
/** Document `id` says it is ready and, being the active one, confirms it. */
const up = (id: string, key?: string | null): Step[] => [ready(id, key), answer(id, key)];
const commit = (id: string | null, key?: string | null): Step => ({ type: COMMIT, id, key });

describe("which document a frame message comes from (C5, A1)", () => {
  it("a ready with an unseen id is only a candidate, and the editor asks the frame who is active", () => {
    const { last, state } = run([ready(A)]);
    expect(last).toEqual({
      kind: "candidate",
      documentId: A,
      probe: PREVIEW_DOCUMENT_PROBE_BASE + 1,
    });
    expect(state.current).toBeNull();
  });

  it("first: the candidate becomes the frame's document when the active document's pong names it", () => {
    const { last, state } = run(up(A));
    expect(last).toEqual({ kind: "ready", documentId: A });
    expect(state.current).toBe(A);
  });

  it("test 1, same-iframe reload: B is taken once it answers, and A's later messages are refused", () => {
    const { verdicts, state } = run([
      ...up(A),
      ...up(B),
      commit(A),
      { type: ROUTE_APPLIED, id: A },
      ready(A),
      commit(B),
    ]);
    expect(verdicts.slice(2)).toEqual([
      { kind: "candidate", documentId: B, probe: PREVIEW_DOCUMENT_PROBE_BASE + 3 },
      { kind: "ready", documentId: B },
      { kind: "refused", why: "replaced-document" },
      { kind: "refused", why: "replaced-document" },
      { kind: "refused", why: "replaced-document" },
      { kind: "message", verified: true },
    ]);
    expect(state.current).toBe(B);
    expect([...state.replaced]).toEqual([A]);
  });

  it("test 2, an old document's first ready arriving late: the active document answers, so it is not taken", () => {
    // X loaded before A and was replaced before its ready reached the editor.
    const { verdicts, state } = run([...up(A), ready(X), answer(A), commit(A)]);
    expect(verdicts.slice(2)).toEqual([
      { kind: "candidate", documentId: X, probe: PREVIEW_DOCUMENT_PROBE_BASE + 3 },
      { kind: "refused", why: "not-active" },
      { kind: "message", verified: true },
    ]);
    expect(state.current).toBe(A);
    expect(state.pending).toBeNull();
    expect([...state.replaced]).toEqual([]);
  });

  it("test 3, an old id back after the memory cap: not taken, by the same question", () => {
    const ids = Array.from({ length: 66 }, (_, index) =>
      index.toString(16).padStart(32, "0"),
    );
    const established = run(ids.flatMap((id) => up(id)));
    expect(established.state.current).toBe(ids.at(-1));
    expect(established.state.replaced.has(ids[0]!)).toBe(false);
    const { verdicts, state } = run([ready(ids[0]!), answer(ids.at(-1)!)], established.state);
    expect(verdicts.map((verdict) => verdict.kind)).toEqual(["candidate", "refused"]);
    expect(verdicts[1]).toEqual({ kind: "refused", why: "not-active" });
    expect(state.current).toBe(ids.at(-1));
  });

  it("a candidate's own messages are not taken before it is confirmed", () => {
    const { verdicts, state } = run([...up(A), ready(B), commit(B), commit(A)]);
    expect(verdicts.slice(3)).toEqual([
      { kind: "refused", why: "other-document" },
      { kind: "message", verified: true },
    ]);
    expect(state.current).toBe(A);
    // Also for the frame's first candidate, when no document is current yet.
    expect(run([ready(A), commit(A)]).last).toEqual({
      kind: "refused",
      why: "other-document",
    });
  });

  it("only the pong to the candidate's own probe confirms it", () => {
    // A heartbeat pong, or one for another probe, is an ordinary message.
    const heartbeat = run([...up(A), ready(B), { type: PONG, id: B, heartbeatId: 7 }]);
    expect(heartbeat.last).toEqual({ kind: "refused", why: "other-document" });
    expect(heartbeat.state.pending?.id).toBe(B);
    const other = run([
      ...up(A),
      ready(B),
      { type: PONG, id: B, heartbeatId: PREVIEW_DOCUMENT_PROBE_BASE + 99 },
    ]);
    expect(other.state.current).toBe(A);
    expect(other.state.pending?.id).toBe(B);
  });

  it("a second candidate replaces the first; the first's probe then confirms nothing", () => {
    const { verdicts, state } = run([
      ...up(A),
      ready(B),
      ready(C),
      { type: PONG, id: B, heartbeatId: PREVIEW_DOCUMENT_PROBE_BASE + 3 },
      answer(C),
    ]);
    expect(verdicts.slice(2).map((verdict) => verdict.kind)).toEqual([
      "candidate",
      "candidate",
      "refused",
      "ready",
    ]);
    expect(state.current).toBe(C);
  });

  it("a candidate not confirmed in time is dropped, and nothing else changes", () => {
    const { state, last } = run([...up(A), ready(B)]);
    expect(last.kind).toBe("candidate");
    const probe = (last as { probe: number }).probe;
    // An expiry for another probe changes nothing.
    expect(expirePreviewDocumentCandidate(state, probe + 1)).toBe(state);
    const expired = expirePreviewDocumentCandidate(state, probe);
    expect(expired.pending).toBeNull();
    expect(expired.current).toBe(A);
    expect([...expired.replaced]).toEqual([]);
    // Its late answer confirms nothing.
    expect(
      run([{ type: PONG, id: B, heartbeatId: probe }], expired).state.current,
    ).toBe(A);
  });

  it("duplicate: the current document's ready again is not taken, and asks nothing", () => {
    const { last, state } = run([...up(A), ready(A)]);
    expect(last).toEqual({ kind: "refused", why: "duplicate-ready" });
    expect(state.pending).toBeNull();
  });

  it("late: a ready from a remembered replaced document is not taken, and asks nothing", () => {
    const { last, state } = run([...up(A), ...up(B), ready(A)]);
    expect(last).toEqual({ kind: "refused", why: "replaced-document" });
    expect(state.pending).toBeNull();
  });

  it("id mismatch: a message from a document that is not current is refused", () => {
    expect(run([...up(A), commit(C)]).last).toEqual({
      kind: "refused",
      why: "other-document",
    });
  });

  it("absent id: never equals a present one, so it is refused while a verified document is current", () => {
    expect(run([...up(A), commit(null)]).last).toEqual({
      kind: "refused",
      why: "no-identity",
    });
  });

  it("before any ready: nothing to compare, so messages are taken as before, unverified", () => {
    // The size answer that recovers a ready the editor missed comes this way.
    expect(run([commit(A)]).last).toEqual({ kind: "message", verified: false });
    expect(run([commit(null)]).last).toEqual({ kind: "message", verified: false });
    expect(run([commit(A), commit(B)]).state.current).toBeNull();
  });

  it("a new frame key starts over: another frame, with nothing replaced yet", () => {
    const { verdicts, state } = run([...up(A), ...up(B), ...up(A, "k2"), commit(A, "k2")]);
    expect(verdicts.slice(4)).toEqual([
      { kind: "candidate", documentId: A, probe: PREVIEW_DOCUMENT_PROBE_BASE + 5 },
      { kind: "ready", documentId: A },
      { kind: "message", verified: true },
    ]);
    expect(state.previewKey).toBe("k2");
    expect([...state.replaced]).toEqual([]);
  });

  it("diagnostics and catalog requests are document-independent: taken from any document", () => {
    for (const type of [DIAGNOSTIC, CATALOG]) {
      expect(run([...up(A), { type, id: null }]).last).toEqual({
        kind: "message",
        verified: false,
      });
      expect(run([...up(A), ...up(B), { type, id: A }]).last).toEqual({
        kind: "message",
        verified: false,
      });
      expect(run([...up(A), { type, id: A }]).last).toEqual({
        kind: "message",
        verified: true,
      });
    }
  });

  it("keeps a bounded memory of replaced documents (a shortcut only: the question decides)", () => {
    const ids = Array.from({ length: 100 }, (_, index) =>
      index.toString(16).padStart(32, "0"),
    );
    const { state } = run(ids.flatMap((id) => up(id)));
    expect(state.current).toBe(ids.at(-1));
    expect(state.replaced.size).toBeLessThanOrEqual(64);
    expect(state.replaced.has(ids.at(-2)!)).toBe(true);
  });

  it("does not change the state it was given", () => {
    const state = initialPreviewDocumentState("k1");
    const frozen = Object.freeze({ ...state, replaced: new Set<string>() });
    const result = classifyPreviewDocument(frozen, {
      previewKey: "k1",
      type: READY,
      previewDocument: A,
      probe: PREVIEW_DOCUMENT_PROBE_BASE + 1,
    });
    expect(frozen.pending).toBeNull();
    expect(result.state).not.toBe(frozen);
  });
});

describe("a frame whose bridge sends no id (an older bridge)", () => {
  it("its first ready on a frame key is taken, unverified", () => {
    const { last, state } = run([ready(null)]);
    expect(last).toEqual({ kind: "ready", documentId: null });
    expect(state.unverified).toBe(true);
  });

  it("its id-less messages are then taken as before", () => {
    expect(run([ready(null), commit(null)]).last).toEqual({
      kind: "message",
      verified: false,
    });
  });

  it("a later id-less ready on the same key is not taken: it cannot be confirmed", () => {
    const { last, state } = run([ready(null), ready(null)]);
    expect(last).toEqual({ kind: "refused", why: "unconfirmable-ready" });
    expect(state.unverified).toBe(true);
    // Its frame's messages are still taken as before.
    expect(run([ready(null), ready(null), commit(null)]).last).toEqual({
      kind: "message",
      verified: false,
    });
  });

  it("an id-less ready while a verified document is current is not taken", () => {
    const { last, state } = run([...up(A), ready(null)]);
    expect(last).toEqual({ kind: "refused", why: "unconfirmable-ready" });
    expect(state.current).toBe(A);
    expect(state.unverified).toBe(false);
  });

  it("a pong with no id never confirms a candidate", () => {
    const { last, state } = run([...up(A), ready(B), answer(null)]);
    expect(last).toEqual({ kind: "refused", why: "not-active" });
    expect(state.current).toBe(A);
  });

  it("while unverified, a message naming some document is not the id-less one on screen", () => {
    expect(run([ready(null), commit(A)]).last).toEqual({
      kind: "refused",
      why: "other-document",
    });
  });

  it("a new bridge on the same key after an id-less one still has to be confirmed", () => {
    const { verdicts, state } = run([ready(null), ...up(B), commit(B)]);
    expect(verdicts.map((verdict) => verdict.kind)).toEqual([
      "ready",
      "candidate",
      "ready",
      "message",
    ]);
    expect(state.unverified).toBe(false);
    expect(state.current).toBe(B);
  });
});
