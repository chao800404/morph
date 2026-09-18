import fs from "node:fs/promises";
import path from "node:path";
import type { ThemeWorkspaceWriter } from "./theme-sandbox-workspace";

/**
 * A Theme workspace on the local disk, in the shape the sandbox already uses.
 *
 * `materializeThemeSandboxWorkspace` takes a writer, not a container — laying
 * out a workspace is writing files and nothing else — so the local preview needs
 * a writer, not a second materializer. Everything the sandbox version gets from
 * the image, this gets from the directory it is given: path containment, the
 * parent-first ordering, and the reconciliation that removes files an older plan
 * left behind while leaving `node_modules`, `.vite` and symlinks alone.
 *
 * The one translation is the root. The materializer works in the container's
 * absolute terms (`/workspace/src/...`), which cannot exist on a developer's
 * machine, so every path is resolved inside `root` and anything that would
 * escape it is refused.
 */
export type LocalThemeWorkspaceWriterOptions = Readonly<{
  /** Directory the workspace lives in. Created when it is first written to. */
  root: string;
}>;

/** The container path prefix the materializer speaks in. */
const WORKSPACE_ROOT = "/workspace";

export class LocalThemeWorkspaceWriter implements ThemeWorkspaceWriter {
  private readonly root: string;
  private prepared: Promise<void> | null = null;

  constructor(options: LocalThemeWorkspaceWriterOptions) {
    this.root = path.resolve(options.root);
  }

  /**
   * The host path for a workspace path, refusing anything outside the root.
   *
   * The root itself is a legitimate target — the materializer creates it and
   * lists it — so it is answered before the prefix is stripped. Without that,
   * `/workspace` reads as the relative path `workspace` and lands beside the
   * workspace instead of in it, which silently lists an empty directory and
   * skips the reconciliation.
   *
   * Anything else outside the root is refused rather than clamped: a plan that
   * escapes the workspace is a bug upstream, and rewriting it quietly would
   * hide the bug while writing somewhere nobody asked for.
   */
  private resolveInRoot(filePath: string): string {
    if (filePath === WORKSPACE_ROOT) return this.root;
    const relative = filePath.startsWith(`${WORKSPACE_ROOT}/`)
      ? filePath.slice(WORKSPACE_ROOT.length + 1)
      : filePath.startsWith("/")
        ? filePath.slice(1)
        : filePath;
    if (relative === "" || relative.includes("\0")) {
      throw new Error(`Refusing an empty workspace path: ${filePath}`);
    }
    const resolved = path.resolve(this.root, relative);
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new Error(`Refusing a workspace path outside the root: ${filePath}`);
    }
    return resolved;
  }

  private async ready(): Promise<void> {
    this.prepared ??= fs.mkdir(this.root, { recursive: true }).then(() => {});
    await this.prepared;
  }

  async writeFile(filePath: string, content: string | Uint8Array): Promise<void> {
    await this.ready();
    await fs.writeFile(this.resolveInRoot(filePath), content);
  }

  async mkdir(
    dirPath: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    await this.ready();
    await fs.mkdir(this.resolveInRoot(dirPath), {
      recursive: options?.recursive ?? false,
    });
  }

  /**
   * Present because a workspace that persists needs reconciling.
   *
   * `includeHidden` is ignored on purpose: `readdir` reports dotfiles anyway,
   * and dropping them would make a hidden stale file survive every plan.
   */
  async listFiles(
    dirPath: string,
    options?: { recursive?: boolean; includeHidden?: boolean },
  ): Promise<{
    success: boolean;
    files: ReadonlyArray<{
      absolutePath: string;
      type: "file" | "directory" | "symlink" | "other";
    }>;
  }> {
    await this.ready();
    const resolved = this.resolveInRoot(dirPath);
    const entries = await fs.readdir(resolved, {
      recursive: options?.recursive ?? false,
      withFileTypes: true,
    });
    return {
      success: true,
      files: entries.map((entry) => {
        // `parentPath` is the directory it was found in; `path` is the
        // deprecated alias for it, and only one of them is there to read.
        const parent = (entry as { parentPath?: string }).parentPath ?? resolved;
        const absolute = path.join(parent, entry.name);
        return {
          // Reported in the materializer's terms, so both writers describe the
          // same workspace with the same strings.
          absolutePath:
            WORKSPACE_ROOT +
            absolute
              .slice(this.root.length)
              .split(path.sep)
              .join("/"),
          type: entry.isSymbolicLink()
            ? "symlink"
            : entry.isDirectory()
              ? "directory"
              : entry.isFile()
                ? "file"
                : "other",
        };
      }),
    };
  }

  async deleteFile(filePath: string): Promise<void> {
    await fs.rm(this.resolveInRoot(filePath), { force: true });
  }
}
