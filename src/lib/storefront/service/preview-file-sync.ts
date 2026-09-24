import {
  stalePreviewSyncPaths,
  type PreviewSyncFile,
  type SavedThemeFile,
} from "../preview-sync-guard";

/**
 * One sync of a tab's files into the shared preview, apart from how the
 * preview is reached.
 *
 * The order is the whole point: the files are checked against what is saved,
 * then prepared, then written. Kept in one place so the handler and its tests
 * run the same sequence, and so the step between the check and the write —
 * the window another request can land in — can be held open in a test.
 */

export type PreviewFileWrite = Readonly<{ path: string; content: string }>;

export type PreviewFileSyncResult =
  | Readonly<{
      ok: true;
      changed: string[];
      unchanged: string[];
      /** Paths the transport generates itself, left as it wrote them. */
      skipped: string[];
    }>
  | Readonly<{ ok: false; stalePaths: string[] }>;

export async function syncPreviewFiles(args: {
  files: readonly PreviewSyncFile[];
  readSaved(paths: string[]): Promise<ReadonlyMap<string, SavedThemeFile>>;
  /** The passes the workspace was laid out with (bindings, hoisting). */
  prepare(
    files: readonly PreviewFileWrite[],
  ): readonly { path: string; content: unknown }[];
  isGenerated(path: string): boolean;
  write(
    files: readonly PreviewFileWrite[],
  ): Promise<{ changed: string[]; unchanged: string[] }>;
}): Promise<PreviewFileSyncResult> {
  // All or nothing. A sync written in part would leave the preview showing
  // neither this tab's edit nor the newer save, and the tab would be told its
  // edit had arrived.
  const stalePaths = stalePreviewSyncPaths(
    args.files,
    await args.readSaved(args.files.map((file) => file.path)),
  );
  if (stalePaths.length > 0) return { ok: false, stalePaths };

  const skipped: string[] = [];
  const writable: PreviewFileWrite[] = [];
  for (const file of args.prepare(
    args.files.map(({ path, content }) => ({ path, content })),
  )) {
    // Left as the transport generated it. Reported apart from "unchanged":
    // one says the workspace already holds what the editor sent, the other
    // that the editor never owned the file here.
    if (args.isGenerated(file.path)) {
      skipped.push(file.path);
      continue;
    }
    writable.push({ path: file.path, content: String(file.content) });
  }

  const { changed, unchanged } = await args.write(writable);
  return { ok: true, changed, unchanged, skipped };
}
