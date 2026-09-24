import {
  runWithConcurrency,
  unplannedWorkspaceFiles,
  type ThemeWorkspacePlanFile,
} from "./theme-sandbox-workspace";
import {
  workspaceFileDigests,
  type WorkspaceFileDigests,
} from "./preview-server-observation";

/**
 * What a workspace marked `dirty` actually holds, read from the disk.
 *
 * `dirty` means an incremental sync (or a failed start) wrote to the workspace
 * after its last complete write, so neither the marker nor the manifest can
 * say what is there. Before this, a start answered by rewriting everything
 * and restarting Vite — taking down every page served from it, although the
 * sync had usually left the disk exactly as the next plan wanted it.
 *
 * So the disk is read instead of trusted. Every planned file is read back and
 * digested, and the workspace is listed for files no plan accounts for. What
 * comes back describes the disk as it was read, file by file: a write that
 * stopped halfway shows up as a file whose content differs, and a file that
 * could not be read is simply absent, which counts as different. It is only
 * as current as the moment it was read, which is why a start re-reads the
 * marker before committing anything on the strength of it.
 */

export type WorkspaceVerification =
  | Readonly<{
      ok: true;
      /** Digests of the planned files as read; unreadable ones are absent. */
      onDisk: WorkspaceFileDigests;
      read: number;
    }>
  | Readonly<{
      ok: false;
      reason: "no-reader" | "binary-file" | "unlistable" | "unplanned-files";
    }>;

export type WorkspaceReader = Readonly<{
  readFile?(
    path: string,
    options?: { encoding?: string },
  ): Promise<{ content?: unknown } | string>;
  listFiles?(
    path: string,
    options?: { recursive?: boolean; includeHidden?: boolean },
  ): Promise<{
    success: boolean;
    files: ReadonlyArray<{ absolutePath: string; type: string }>;
  }>;
}>;

const VERIFY_READ_CONCURRENCY = 8;

export async function verifyWorkspaceOnDisk(
  reader: WorkspaceReader,
  plannedFiles: readonly ThemeWorkspacePlanFile[],
): Promise<WorkspaceVerification> {
  if (!reader.readFile || !reader.listFiles) {
    return { ok: false, reason: "no-reader" };
  }
  // Bytes cannot be compared through a text read; such a workspace is
  // rewritten rather than guessed at.
  if (plannedFiles.some((file) => typeof file.content !== "string")) {
    return { ok: false, reason: "binary-file" };
  }

  let listed;
  try {
    listed = await reader.listFiles("/workspace", {
      recursive: true,
      includeHidden: true,
    });
  } catch {
    return { ok: false, reason: "unlistable" };
  }
  if (!listed.success) return { ok: false, reason: "unlistable" };
  // A file the plan does not know about can still be imported, and only a
  // full write removes it.
  if (unplannedWorkspaceFiles(listed.files, plannedFiles).length > 0) {
    return { ok: false, reason: "unplanned-files" };
  }

  const onDisk: Record<string, string> = {};
  await runWithConcurrency(
    plannedFiles,
    VERIFY_READ_CONCURRENCY,
    async (file) => {
      try {
        const value = await reader.readFile!(file.path, { encoding: "utf-8" });
        const content =
          typeof value === "string"
            ? value
            : typeof value.content === "string"
              ? value.content
              : null;
        if (content === null) return;
        Object.assign(
          onDisk,
          workspaceFileDigests([{ path: file.path, content }]),
        );
      } catch {
        // Missing or unreadable: left out, so it counts as different.
      }
    },
  );
  return { ok: true, onDisk, read: plannedFiles.length };
}
