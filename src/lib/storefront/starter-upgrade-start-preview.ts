import { parseThemeSourceAst } from "./ast/theme-source-ast";
import type { ThemePreviewRuntime } from "./theme-preview-runtime";

/**
 * Whether a Starter upgrade would write files that preview only on the full
 * Start runtime (R-0), and whether this Theme may take them.
 *
 * Upgrading a Theme's Starter never records or changes its runtime
 * (`defaultPreviewRuntimeForNewTheme`). So a Theme still previewed on the
 * client runtime keeps it, and a Starter file that reads its content on the
 * server (a `createServerFn`, or the platform's `@morph/sdk/start` entry) would
 * leave that Theme with a page its preview cannot render. Such an upgrade is
 * applied only to a Theme that records `start`: the author records it through
 * the editor's preview runtime switch, under its own compare-and-set, and a
 * switch that did not land leaves the Theme refused. Until then neither those
 * files nor the Starter version are applied.
 *
 * Read-only. The write boundary (`applyReviewedStarterUpgrade`) asks this
 * again on the files it is about to write, whatever the review showed.
 */

/** The platform's hosted Start entry; it reads only on the server. */
const SDK_START_ENTRY = "@morph/sdk/start";
const START_MODULE = "@tanstack/react-start";
/** Imports from `@tanstack/react-start` that need a Start server to run. */
const SERVER_ONLY_START_EXPORTS = new Set(["createServerFn"]);
const SCRIPT_FILE = /\.(tsx|jsx|ts|js|mjs|cjs)$/;

export const STARTER_UPGRADE_START_PREVIEW_REQUIRED_MESSAGE =
  "This Starter upgrade includes pages that read their content on the server, which only the full Start preview can show. Switch this Theme's preview to Start first; until then nothing of this upgrade is applied.";

type AnyNode = any;

/**
 * Whether one source file needs the full Start runtime to preview: it imports
 * the hosted SDK entry, or a server function builder, as a value. A script
 * that cannot be parsed is counted as needing it: nothing here can show it
 * does not.
 */
export function sourceRequiresStartPreview(
  path: string,
  content: string,
): boolean {
  if (!SCRIPT_FILE.test(path)) return false;
  const parsed = parseThemeSourceAst({ path, content });
  if (!parsed.ok) return true;
  for (const statement of (parsed.ast as AnyNode)?.program?.body ?? []) {
    if (
      statement?.type !== "ImportDeclaration" ||
      statement.importKind === "type"
    ) {
      continue;
    }
    const source = statement.source?.value;
    if (source === SDK_START_ENTRY) {
      const valueSpecifiers = (statement.specifiers ?? []).filter(
        (specifier: AnyNode) => specifier?.importKind !== "type",
      );
      // A side-effect import still runs the entry.
      if ((statement.specifiers ?? []).length === 0) return true;
      if (valueSpecifiers.length > 0) return true;
      continue;
    }
    if (source !== START_MODULE) continue;
    for (const specifier of statement.specifiers ?? []) {
      if (specifier?.type === "ImportNamespaceSpecifier") return true;
      if (specifier?.type !== "ImportSpecifier") continue;
      if (specifier.importKind === "type") continue;
      const imported = specifier.imported?.name ?? specifier.imported?.value;
      if (SERVER_ONLY_START_EXPORTS.has(imported)) return true;
    }
  }
  return false;
}

/** The planned files that need the full Start runtime, in path order. */
export function starterPlanFilesRequiringStartPreview(
  files: ReadonlyArray<Readonly<{ path: string; content: string }>>,
): string[] {
  return [
    ...new Set(
      files
        .filter((file) => sourceRequiresStartPreview(file.path, file.content))
        .map((file) => file.path),
    ),
  ].sort();
}

export type StarterStartPreviewRequirement = Readonly<{
  /** The planned files that need the full Start runtime. */
  paths: readonly string[];
  /** Whether this Theme may take them: none are planned, or it records `start`. */
  satisfied: boolean;
  /** Why it may not, when it may not. */
  reason: string | null;
}>;

/**
 * Whether a Theme that records `recordedRuntime` (null: none, previewed as the
 * deployment says) may take a plan whose Start-only files are `paths`. Only
 * a recorded `start` is the author's confirmation; a deployment default is
 * not, since it can change under the Theme.
 */
export function starterStartPreviewRequirement(
  paths: readonly string[],
  recordedRuntime: ThemePreviewRuntime | null,
): StarterStartPreviewRequirement {
  const satisfied = paths.length === 0 || recordedRuntime === "start";
  return {
    paths: [...paths],
    satisfied,
    reason: satisfied ? null : STARTER_UPGRADE_START_PREVIEW_REQUIRED_MESSAGE,
  };
}
