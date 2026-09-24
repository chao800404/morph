import type { PreviewSyncFile } from "@/lib/storefront/preview-sync-guard";
import type { ThemeWorkspaceFileState } from "@/lib/storefront/store/theme-workspace-store";

/**
 * Which files a tab sends to the shared preview, and from which version.
 *
 * Most syncs hand over the tab's whole file set — the first sync after a
 * preview starts, every keystroke in Code mode, and most Design edits. But the
 * preview already holds everything saved (a start writes it from the
 * database), and other tabs write into it too. So a tab sends only the files
 * that are its to write: ones it has changed from its saved copy, and ones it
 * has put something else into the preview for and now has to put back. A file
 * it never touched is left alone; its copy may be older than what another tab
 * has saved since.
 *
 * Each file carries the saved version this tab holds. It is not advanced for
 * a save still in flight: that save may yet lose to another tab that took the
 * same version number, and claiming it early let this tab's older copy pass
 * as the newer one. A tab whose own save has landed but not yet returned is
 * refused for a moment instead, and sends again once it has (see
 * `awaitsOwnSave`).
 */
export function planPreviewSync(
  files: readonly { path: string; content: string }[],
  workspace: Readonly<Record<string, ThemeWorkspaceFileState>>,
  /** What this tab last wrote into the preview, by path. */
  written: ReadonlyMap<string, string>,
): PreviewSyncFile[] {
  const planned: PreviewSyncFile[] = [];
  for (const file of files) {
    const state = workspace[file.path];
    const lastWritten = written.get(file.path);
    const untouched =
      state !== undefined &&
      file.content === state.serverContent &&
      (lastWritten === undefined || lastWritten === file.content);
    if (untouched) continue;
    planned.push({
      path: file.path,
      content: file.content,
      baseVersion: state?.serverExists ? state.serverVersion : null,
    });
  }
  return planned;
}

/**
 * Whether a refused sync may only be waiting on this tab's own save.
 *
 * True when every refused file is being saved by this tab right now: its save
 * may already have landed, making the version it holds look old. Worth one
 * more attempt once the save returns — if it lost to another tab, that attempt
 * is refused as well, and that answer is the real one.
 */
export function awaitsOwnSave(
  stalePaths: readonly string[],
  workspace: Readonly<Record<string, ThemeWorkspaceFileState>>,
): boolean {
  return (
    stalePaths.length > 0 &&
    stalePaths.every((path) => workspace[path]?.saveState === "saving")
  );
}

/** Resolves once none of `paths` is being saved, or after `timeoutMs`. */
export function waitForOwnSaves(
  readWorkspace: () => Readonly<Record<string, ThemeWorkspaceFileState>>,
  paths: readonly string[],
  { intervalMs = 100, timeoutMs = 10_000 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const check = () => {
      const workspace = readWorkspace();
      const saving = paths.some(
        (path) => workspace[path]?.saveState === "saving",
      );
      if (!saving || Date.now() >= deadline) resolve();
      else setTimeout(check, intervalMs);
    };
    check();
  });
}
