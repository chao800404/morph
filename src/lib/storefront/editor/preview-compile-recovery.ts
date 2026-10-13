/**
 * When a frame whose Theme did not compile may be replaced.
 *
 * A new frame is the only way back for such a page (preview-compile-failure.ts
 * says why), and it is worth loading only when the preview has source the
 * failed page never compiled. So recovery is counted against writes, not
 * against failures: each write this tab lands in the preview buys at most one
 * new frame. A Theme still broken after it fails once more and waits for the
 * next write — there is no failure that can trigger a reload by itself, so
 * there is no loop to bound.
 *
 * "Compiled" is judged per document. A frame records the write sequence when
 * its document started loading; a write that landed after that is source the
 * document may not have seen, even if its failure is reported later. Vite can
 * also reload a document in place (same frame), which starts it again.
 */
export type PreviewCompileRecovery = Readonly<{
  /** A write this tab made has landed in the preview's workspace. */
  noteSourceWritten(): void;
  /** A document of this frame started loading: a new frame, or a reload. */
  noteDocumentStarted(key: string): void;
  /**
   * Whether the frame that failed should be replaced now. True at most once
   * per landed write, and only for source the frame's document had not seen.
   */
  takeReload(key: string): boolean;
}>;

export function createPreviewCompileRecovery(): PreviewCompileRecovery {
  let written = 0;
  let recovered = 0;
  let document: { key: string; sawWrite: number } | null = null;
  return {
    noteSourceWritten() {
      written += 1;
    },
    noteDocumentStarted(key) {
      document = { key, sawWrite: written };
    },
    takeReload(key) {
      const sawWrite = document?.key === key ? document.sawWrite : 0;
      if (written <= sawWrite || written <= recovered) return false;
      recovered = written;
      return true;
    },
  };
}
