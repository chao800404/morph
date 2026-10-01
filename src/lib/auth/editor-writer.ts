import { createMiddleware } from "@tanstack/react-start";

/**
 * Which account an open editor belongs to, said with every request it makes.
 *
 * Signing another account into this browser — in another tab — refuses
 * nothing by itself: the new account may be allowed to write too. So an
 * editor's unsaved work could be saved as whoever happens to be signed in by
 * the time a debounced save goes out. The editor therefore says whose it is,
 * and the server's auth middlewares refuse a request whose session belongs to
 * someone else (`ACCOUNT_CHANGED`), before anything is written.
 *
 * The claim comes from the browser and is trusted for one thing only: to
 * refuse. It never grants anything — the session still decides who is asking
 * and the role still decides what they may do — so a forged or missing claim
 * can at most make a request fail that would otherwise have run.
 *
 * Set only while an editor is open, in the browser; everywhere else no claim
 * is sent and nothing changes.
 */
let activeEditorWriter: string | null = null;

export function setActiveEditorWriter(userId: string | null): void {
  if (typeof window === "undefined") return;
  activeEditorWriter = userId;
}

export function getActiveEditorWriter(): string | null {
  return activeEditorWriter;
}

/** The header carrying the same claim for the editor's HTTP routes. */
export const EDITOR_WRITER_HEADER = "x-morph-editor-writer";

/**
 * Sends the claim with every server function call. Registered once, in
 * `src/start.ts`, so no call site can forget it.
 */
export const editorWriterMiddleware = createMiddleware({
  type: "function",
}).client(async ({ next }) =>
  // Undefined outside an editor, which the server reads as no claim.
  next({ sendContext: { editorWriter: activeEditorWriter ?? undefined } }),
);

/**
 * Whether a request claimed to be for an account other than `userId`.
 *
 * No claim, or one that is not a string, is no mismatch: requests from
 * outside the editor say nothing, and are judged by the session alone.
 */
export function claimsAnotherWriter(claim: unknown, userId: string): boolean {
  return typeof claim === "string" && claim.length > 0 && claim !== userId;
}

/** The claim a server function's middleware context carries, if any. */
export function editorWriterClaim(context: unknown): unknown {
  return context && typeof context === "object"
    ? (context as { editorWriter?: unknown }).editorWriter
    : undefined;
}
