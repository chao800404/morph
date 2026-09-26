import {
  stalePreviewSyncPaths,
  type PreviewSyncFile,
  type SavedThemeFile,
} from "../preview-sync-guard";
import { fenceFor } from "../compiler/preview-write-fence";

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

/**
 * A file as the transport writes it: with the version it is, or was edited
 * from. The transport refuses it if the preview has already been written
 * with a newer one — see `preview-write-fence.ts`.
 */
export type FencedPreviewFileWrite = PreviewFileWrite &
  Readonly<{ fence: number }>;

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
  /**
   * The saved files, with the source generation they were read at — one
   * snapshot (`readAtSourceGeneration`). That generation is what the write
   * is stamped with, so it must describe these files and nothing later.
   */
  readSaved(paths: string[]): Promise<{
    files: ReadonlyMap<string, SavedThemeFile>;
    generation: number | null;
  }>;
  /** The passes the workspace was laid out with (bindings, hoisting). */
  prepare(
    files: readonly PreviewFileWrite[],
  ): readonly { path: string; content: unknown }[];
  isGenerated(path: string): boolean;
  write(
    files: readonly FencedPreviewFileWrite[],
    /** The generation `readSaved` returned with the files checked here. */
    generation: number | null,
  ): Promise<{
    changed: string[];
    unchanged: string[];
    /** Refused by the fence; nothing was written when this is non-empty. */
    refused?: string[];
  }>;
}): Promise<PreviewFileSyncResult> {
  // All or nothing. A sync written in part would leave the preview showing
  // neither this tab's edit nor the newer save, and the tab would be told its
  // edit had arrived.
  const { files: saved, generation } = await args.readSaved(
    args.files.map((file) => file.path),
  );
  const stalePaths = stalePreviewSyncPaths(args.files, saved);
  if (stalePaths.length > 0) return { ok: false, stalePaths };

  // Worked out from the files as sent, before the preview passes rewrite
  // them: the fence says which saved version the content is, and the passes
  // change bytes, not versions.
  const fences = new Map(
    args.files.map((file) => [file.path, fenceFor(file, saved.get(file.path))]),
  );

  const skipped: string[] = [];
  const writable: FencedPreviewFileWrite[] = [];
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
    writable.push({
      path: file.path,
      content: String(file.content),
      fence: fences.get(file.path) ?? 0,
    });
  }

  // The check above is against the database when it was read; the fence is
  // against every write the preview has taken since, including any that
  // landed after that read. Either refusal means the same to the tab.
  const {
    changed,
    unchanged,
    refused = [],
  } = await args.write(writable, generation);
  if (refused.length > 0) return { ok: false, stalePaths: refused };
  return { ok: true, changed, unchanged, skipped };
}
