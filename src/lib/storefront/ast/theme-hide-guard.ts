import { deriveThemeDocumentLayoutPath } from "@/lib/storefront/compiler/theme-route-sections";
import {
  createHideCapabilityAnalyzer,
  type HideGuardSite,
} from "./theme-hide-capability";
import { normalizeThemeSourcePath } from "./theme-content-binding";
import type { B1SourceFile } from "./theme-content-provenance";
import {
  createThemeSourceAstReader,
  type ThemeSourceAstReader,
} from "./theme-source-ast";

/**
 * M3 Hide, approach B: Morph's compiled guard at each call site the
 * capability classifier supports (`theme-hide-capability.ts`).
 *
 *   {hidden ? null : <El …author props…/>}
 *
 * The condition is evaluated before the element, so a hidden section's props
 * are never computed and its component never runs: no defaults, and no read
 * of the value that is no longer there. The hidden state is read from the
 * same object the slot comes from — the content module's `isSectionHidden`
 * for a `content("x")` site, the page's own `_hidden` for a loader site — so
 * server render, dehydrated loader data and client hydration agree. Nothing
 * hidden is ever put back into what the page receives.
 *
 * The same plan is used by the Live Preview (inside `injectPreviewBindings`,
 * on the authored offsets, so every `data-morph-loc` it writes still names
 * the authored position) and by the build (`prepareSourcesForBuild`). The
 * stored source is never changed: the guard exists only in compiled output.
 *
 * Instances the classifier refuses get no guard. They keep what they had:
 * the preview marks a loader slot `data-morph-section-hidden`, and the write
 * boundary and publish refuse to hide them.
 */

export { THEME_HIDE_GUARD_VERSION } from "./theme-hide-guard-version";

export type HideGuardPlan = ReadonlyMap<string, readonly HideGuardSite[]>;

const ROUTE_MODULE = /^src\/routes\/.+\.(tsx|jsx)$/;
const ROOT_ROUTE = /^src\/routes\/__root\.(tsx|jsx)$/;

/**
 * Every call site that gets a guard, per file. Only the modules whose
 * sections a Document describes are guarded: route modules, and the document
 * layout. A site the Starter already guards (`!isSectionHidden("x") && …`)
 * is left exactly as the author has it.
 */
export function planHideGuards(
  sourceFiles: readonly B1SourceFile[],
  options: Readonly<{ reader?: ThemeSourceAstReader }> = {},
): HideGuardPlan {
  const files = sourceFiles.map((file) => ({
    path: normalizeThemeSourcePath(file.path),
    content: file.content,
  }));
  const reader = options.reader ?? createThemeSourceAstReader(files);
  const layoutPath = deriveThemeDocumentLayoutPath(files, reader);
  const analyzer = createHideCapabilityAnalyzer(files, { reader });
  const plan = new Map<string, HideGuardSite[]>();
  for (const file of files) {
    const isLayout = file.path === layoutPath;
    if (
      !isLayout &&
      (!ROUTE_MODULE.test(file.path) || ROOT_ROUTE.test(file.path))
    ) {
      continue;
    }
    for (const slot of analyzer.sectionsIn(file.path)) {
      const capability = analyzer.classify({
        callSitePath: file.path,
        slot,
        scope: isLayout ? "layout" : "route",
      });
      if (capability.kind !== "supported") continue;
      const sites = capability.sites.filter(
        (site) => site.file === file.path && site.position !== "guarded",
      );
      if (sites.length === 0) continue;
      plan.set(file.path, [...(plan.get(file.path) ?? []), ...sites]);
    }
  }
  return plan;
}

export type HideGuardInsertion = Readonly<{
  at: number;
  text: string;
  /** Set on the two halves of a guard: the element range it encloses. */
  wrapper?: Readonly<{ side: "open" | "close"; start: number; end: number }>;
}>;

/**
 * The text one file gains for its guards, at authored offsets. `usedNames`
 * holds every identifier the module already uses; the import's local name is
 * chosen outside it and added to it.
 */
export function hideGuardInsertions(
  sites: readonly HideGuardSite[],
  usedNames: Set<string>,
): HideGuardInsertion[] {
  const insertions: HideGuardInsertion[] = [];
  let hiddenLocal: string | null = null;
  for (const site of sites) {
    let condition: string;
    if (site.root === "content") {
      if (!site.contentImport) continue;
      if (hiddenLocal === null) {
        hiddenLocal = "__morphSectionHidden";
        for (let suffix = 0; usedNames.has(hiddenLocal); suffix += 1) {
          hiddenLocal = `__morphSectionHidden${suffix}`;
        }
        usedNames.add(hiddenLocal);
        // On the import's own line, so no later line moves. A Theme written
        // without semicolons ends the import at its specifier, so the
        // statement is closed first: two imports on one line need one.
        insertions.push({
          at: site.contentImport.end,
          text: `${site.contentImport.semicolon ? "" : ";"} import { isSectionHidden as ${hiddenLocal} } from ${JSON.stringify(site.contentImport.source)};`,
        });
      }
      condition = `${hiddenLocal}(${JSON.stringify(site.slot)})`;
    } else {
      if (!site.pageLocal) continue;
      const page = site.pageLocal;
      condition = `(Array.isArray(${page}?._hidden) && ${page}._hidden.includes(${JSON.stringify(site.slot)}))`;
    }
    const child = site.position === "child";
    insertions.push({
      at: site.start,
      text: child ? `{${condition} ? null : ` : `(${condition} ? null : `,
      wrapper: { side: "open", start: site.start, end: site.end },
    });
    insertions.push({
      at: site.end,
      text: child ? "}" : ")",
      wrapper: { side: "close", start: site.start, end: site.end },
    });
  }
  return insertions;
}

/** Left-to-right order at one offset: closings (innermost first), plain text, openings (outermost first). */
function compareGuardInsertions(
  a: HideGuardInsertion & { order: number },
  b: HideGuardInsertion & { order: number },
): number {
  if (a.at !== b.at) return a.at - b.at;
  const rank = (insertion: HideGuardInsertion) =>
    insertion.wrapper?.side === "close"
      ? 0
      : insertion.wrapper?.side === "open"
        ? 2
        : 1;
  const byRank = rank(a) - rank(b);
  if (byRank !== 0 || !a.wrapper || !b.wrapper)
    return byRank || a.order - b.order;
  const outerFirst =
    b.wrapper.end - a.wrapper.end || a.wrapper.start - b.wrapper.start;
  return a.wrapper.side === "open" ? outerFirst : -outerFirst;
}

function identifierNames(source: string): Set<string> {
  return new Set(source.match(/[A-Za-z_$][\w$]*/g) ?? []);
}

export type HideGuardResult = Readonly<{
  files: ReadonlyArray<{ path: string; content: string }>;
  /** Slot ids guarded, per file. */
  guarded: Readonly<Record<string, readonly string[]>>;
}>;

/**
 * Applies the guards to whole files, for a build. Every offset refers to the
 * file as given, which is the file analysed.
 */
export function applyHideGuards(
  files: readonly { path: string; content: string }[],
): HideGuardResult {
  const plan = planHideGuards(files);
  const guarded: Record<string, string[]> = {};
  const out = files.map((file) => {
    const sites = plan.get(normalizeThemeSourcePath(file.path));
    if (!sites || sites.length === 0) return file;
    const insertions = hideGuardInsertions(sites, identifierNames(file.content))
      .map((insertion, order) => ({ ...insertion, order }))
      .sort(compareGuardInsertions);
    if (insertions.length === 0) return file;
    guarded[file.path] = [...new Set(sites.map((site) => site.slot))];
    let content = "";
    let copied = 0;
    for (const insertion of insertions) {
      content += file.content.slice(copied, insertion.at) + insertion.text;
      copied = insertion.at;
    }
    content += file.content.slice(copied);
    return { path: file.path, content };
  });
  return { files: out, guarded };
}
