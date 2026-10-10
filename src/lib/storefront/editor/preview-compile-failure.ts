import { parse } from "@babel/parser";
import {
  readThemeFileImportTargets,
  resolveSpecifierToFile,
} from "@/lib/storefront/ast/theme-file-move";
import { THEME_PREVIEW_SERVER_BASE_PATH } from "@/lib/storefront/compiler/theme-preview-dev-server";
import { PREVIEW_RUNTIME_INTERRUPTED_STATUS } from "@/lib/storefront/service/preview-runtime-interruption";
import type { PreviewResourceFailure } from "./preview-protocol";

/**
 * A Theme that stops compiling in the Live Preview, as the editor tells it.
 *
 * Vite answers a module it cannot compile with a 500. A module that fails to
 * load stops its whole graph, so the preview's entry never runs, the bridge
 * never announces itself, and Vite's own error overlay — part of the same
 * graph — never appears: the canvas is an empty frame. The only witness is
 * the page's first script, which reports the failed requests.
 *
 * That report comes from a frame running Theme JavaScript, so it is a claim,
 * and it is taken for no more than it can already cause. All it is allowed to
 * say is *which* of the Theme's own files failed: a path that is not a file
 * in the preview's workspace is dropped. Why it failed is read here, from the
 * source the editor already holds — never from text the frame sends. A forged
 * report can at most make the editor point at one of the Theme's own files
 * and say what it finds in it, which is less than the frame can already do by
 * rendering whatever it likes in the canvas.
 *
 * The source read is the preview's, not the editor's draft. The author can be
 * ahead of the frame — typing, or a save still on its way — and a reason read
 * from a version the frame never compiled would be a guess presented as a
 * finding. So the preview's copy of each failed file is captured when the
 * failure is reported, reasons come only from it, and a draft that differs is
 * said to be not in the preview yet.
 *
 * A 500 is also not proof of a compile error. When nothing here confirms one
 * (a missing import, a syntax error), the cause is reported as unconfirmed,
 * and the frame keeps whatever the server said about it.
 *
 * Vite's own message is shown inside the frame (theme-preview-diagnostic-
 * script), where it stays the frame's to show.
 */

export type PreviewCompileFailure = Readonly<{
  /** Workspace files Vite refused to serve, in the order the page asked. */
  files: readonly string[];
  /**
   * The preview's copy of each of those files when the failure was reported,
   * or null where the editor does not know what the preview holds.
   */
  source: Readonly<Record<string, string | null>>;
  /** Every path the preview's workspace held then. */
  paths: readonly string[];
}>;

/** What the editor knows the preview's workspace holds. */
export type PreviewSourceCopy = Readonly<{
  paths: ReadonlySet<string>;
  contentOf(path: string): string | null;
}>;

export type PreviewCompileFailureCause =
  | Readonly<{
      kind: "missing-import";
      /** The relative specifier exactly as the file writes it. */
      specifier: string;
    }>
  | Readonly<{
      kind: "syntax";
      message: string;
      line: number;
      column: number;
    }>;

/** Most files one report may name, so a broken page cannot fill the editor. */
const MAX_FILES = 5;

/**
 * The workspace path a failed request was for, or null when it was not one
 * of the Theme's files.
 */
function workspacePathOf(
  requestPath: string,
  workspacePaths: ReadonlySet<string>,
): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  const relative = pathname.startsWith(THEME_PREVIEW_SERVER_BASE_PATH)
    ? pathname.slice(THEME_PREVIEW_SERVER_BASE_PATH.length)
    : pathname.replace(/^\/+/, "");
  return workspacePaths.has(relative) ? relative : null;
}

/** Whether a status is Vite refusing to compile, not the runtime failing. */
function isCompileStatus(status: number): boolean {
  return (
    status >= 500 &&
    status <= 599 &&
    // The proxy's interruption has its own recovery and is never the Theme's.
    status !== PREVIEW_RUNTIME_INTERRUPTED_STATUS
  );
}

/**
 * The Theme files a page could not load because Vite would not compile them,
 * or null when the report does not describe that.
 *
 * Both halves are needed, as for an interruption: a failed script says the
 * page cannot come up in this document, and a server error on one of the
 * Theme's own files says why.
 */
export function readPreviewCompileFailure(
  report: Readonly<{
    failedScripts: readonly string[];
    failures: readonly PreviewResourceFailure[];
  }>,
  preview: PreviewSourceCopy,
): PreviewCompileFailure | null {
  if (report.failedScripts.length === 0) return null;
  const files: string[] = [];
  for (const failure of report.failures) {
    if (!isCompileStatus(failure.status)) continue;
    const path = workspacePathOf(failure.path, preview.paths);
    if (!path || files.includes(path)) continue;
    files.push(path);
    if (files.length >= MAX_FILES) break;
  }
  if (files.length === 0) return null;
  return {
    files,
    source: Object.fromEntries(
      files.map((path) => [path, preview.contentOf(path)]),
    ),
    paths: [...preview.paths],
  };
}

/** Whether two reports describe the same files in the same source. */
export function samePreviewCompileFailure(
  left: PreviewCompileFailure,
  right: PreviewCompileFailure,
): boolean {
  return (
    left.files.length === right.files.length &&
    left.files.every(
      (path, index) =>
        path === right.files[index] && left.source[path] === right.source[path],
    )
  );
}

export type PreviewCompileFailureReading = Readonly<{
  path: string;
  /** Read from the preview's copy; empty when nothing was confirmed. */
  causes: readonly PreviewCompileFailureCause[];
  /** The editor's draft of the file is not what the preview compiled. */
  draftAhead: boolean;
}>;

/**
 * What can be said about each failed file: reasons from the preview's copy
 * only, and whether the author's draft has moved past it.
 */
export function readPreviewCompileFailureCauses(
  failure: PreviewCompileFailure,
  draftContentOf: (path: string) => string | null,
): readonly PreviewCompileFailureReading[] {
  const paths = new Set(failure.paths);
  return failure.files.map((path) => {
    const compiled = failure.source[path] ?? null;
    return {
      path,
      causes:
        compiled === null
          ? []
          : explainPreviewCompileFailure(path, compiled, paths),
      draftAhead: compiled !== null && draftContentOf(path) !== compiled,
    };
  });
}

/**
 * The only module a Theme imports that is not in its workspace: the route
 * tree is generated in the preview's own workspace (§6.0.1), so its absence
 * here says nothing.
 */
function isGeneratedModule(importerPath: string, specifier: string): boolean {
  const resolved = resolveSpecifierToFile(
    importerPath,
    specifier,
    new Set([
      "src/routeTree.gen.ts",
      "src/routeTree.gen.tsx",
      "routeTree.gen.ts",
    ]),
  );
  return resolved !== null;
}

function parserPluginsFor(path: string): ("jsx" | "typescript")[] {
  if (/\.[cm]?ts$/.test(path)) return ["typescript"];
  if (/\.[cm]?jsx?$/.test(path)) return ["jsx"];
  return ["jsx", "typescript"];
}

function readSyntaxError(
  path: string,
  content: string,
): PreviewCompileFailureCause | null {
  try {
    parse(content, {
      sourceType: "module",
      plugins: parserPluginsFor(path),
    });
    return null;
  } catch (error) {
    const located = error as {
      message?: unknown;
      loc?: { line?: unknown; column?: unknown };
    };
    const line = Number(located.loc?.line);
    const column = Number(located.loc?.column);
    return {
      kind: "syntax",
      // Babel appends "(line:column)", which the location already says.
      message: String(located.message ?? "Syntax error").replace(
        / \(\d+:\d+\)$/,
        "",
      ),
      line: Number.isInteger(line) && line > 0 ? line : 1,
      column: Number.isInteger(column) && column >= 0 ? column + 1 : 1,
    };
  }
}

/**
 * What the editor can see wrong with a file Vite refused, from its own copy.
 *
 * Covers what an author most often does to break a page — a relative import
 * of a file that is not there, and a syntax error. Anything else (a package
 * the Theme may not use, a plugin's refusal) comes back as no cause, and the
 * editor says only which file failed; Vite's message is in the canvas.
 */
export function explainPreviewCompileFailure(
  path: string,
  content: string,
  workspacePaths: ReadonlySet<string>,
): readonly PreviewCompileFailureCause[] {
  const syntax = readSyntaxError(path, content);
  if (syntax) return [syntax];
  const targets = readThemeFileImportTargets(path, content, workspacePaths);
  if (!targets) return [];
  const causes: PreviewCompileFailureCause[] = [];
  for (const { specifier, resolvedPath } of targets) {
    if (resolvedPath || !specifier.startsWith(".")) continue;
    // `./icon.svg?url` names `./icon.svg`; the query is for the bundler.
    const file = specifier.replace(/[?#].*$/, "");
    if (resolveSpecifierToFile(path, file, workspacePaths)) continue;
    if (isGeneratedModule(path, file)) continue;
    if (
      causes.some(
        (cause) =>
          cause.kind === "missing-import" && cause.specifier === specifier,
      )
    ) {
      continue;
    }
    causes.push({ kind: "missing-import", specifier });
  }
  return causes;
}

/** One sentence for a cause, naming the file it was found in. */
export function describePreviewCompileFailureCause(
  path: string,
  cause: PreviewCompileFailureCause,
): string {
  switch (cause.kind) {
    case "missing-import":
      return `${path} imports "${cause.specifier}", which is not a file in this Theme.`;
    case "syntax":
      return `${path} has a syntax error at line ${cause.line}, column ${cause.column}: ${cause.message}`;
  }
}

/**
 * The component file a section names by path, when that file is not in the
 * Theme.
 *
 * Such a section is not CMS-only: its route still renders that component and
 * cannot, because the file was deleted or moved. Read from the editor's own
 * copy of the workspace, so it holds whether or not the preview said anything.
 * One answer for the tree and the Inspector, which must not disagree.
 */
export function missingSectionComponentPath(
  componentRef: string | null | undefined,
  workspacePaths: ReadonlySet<string> | undefined,
): string | null {
  const ref = componentRef?.replace(/\\/g, "/");
  if (!ref?.startsWith("src/") || !workspacePaths) return null;
  return workspacePaths.has(ref) ? null : ref;
}
