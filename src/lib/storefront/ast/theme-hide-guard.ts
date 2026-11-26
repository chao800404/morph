import { deriveThemeDocumentLayoutPath } from "@/lib/storefront/compiler/theme-route-sections";
import { THEME_SECTION_GATE_MODULE } from "@/lib/storefront/compiler/theme-section-gate";
import {
  createHideCapabilityAnalyzer,
  isHideGuardedModule,
  type HideGuardSite,
} from "./theme-hide-capability";
import { normalizeThemeSourcePath } from "./theme-content-binding";
import type { B1SourceFile } from "./theme-content-provenance";
import {
  createThemeSourceAstReader,
  type ThemeSourceAstReader,
} from "./theme-source-ast";

/**
 * M3 Hide, approach E: Morph's compiled guard at each call site the
 * capability classifier supports (`theme-hide-capability.ts`).
 *
 *   <__MorphSectionGate slot={"x"} render={() => (<El …author props…/>)} />
 *
 * The gate (`@morph/sdk/section-gate`, theme-section-gate.ts) reads the
 * hidden list once, at its own top level, from the root route's snapshot
 * (`content("x")` sites) or from the page object the slot came from (loader
 * sites, `MorphPageSectionGate`). A hidden section's `render` is never
 * called, so its props are never computed and its component never runs: no
 * defaults, and no read of the value that is no longer there. A visible one
 * is rendered by a body the gate mounts, so a hook its props call runs at a
 * stable place. A missing or malformed hidden list throws rather than
 * showing the section.
 *
 * Every supported site gets the gate, the Starter's own
 * `!isSectionHidden("x") && <El/>` included: there the gate goes around the
 * element, inside the author's check, so the Starter's `content()` is no
 * longer called conditionally in the route's render.
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

/**
 * Every call site that gets a guard, per file. Only the modules whose
 * sections a Document describes are guarded: route modules, and the document
 * layout.
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
    if (!isHideGuardedModule(file.path, layoutPath)) continue;
    for (const slot of analyzer.sectionsIn(file.path)) {
      const capability = analyzer.classify({
        callSitePath: file.path,
        slot,
        scope: isLayout ? "layout" : "route",
      });
      if (capability.kind !== "supported") continue;
      const sites = capability.sites.filter((site) => site.file === file.path);
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
 * Where the gate's import goes: at the end of the module's first import
 * declaration, on its own line, so no later line moves. A Theme written
 * without semicolons ends the import at its specifier, so the statement is
 * closed first.
 */
export type HideGuardImportAnchor = Readonly<{
  end: number;
  semicolon: boolean;
}>;

/** The first import declaration of a parsed module, as an anchor. */
export function hideGuardImportAnchor(
  ast: { program?: { body?: readonly unknown[] } } | null | undefined,
  source: string,
): HideGuardImportAnchor | null {
  const first = (ast?.program?.body ?? []).find(
    (statement) =>
      (statement as { type?: string }).type === "ImportDeclaration",
  ) as { end?: number } | undefined;
  if (typeof first?.end !== "number") return null;
  return { end: first.end, semicolon: source[first.end - 1] === ";" };
}

/** A list item's key, repeated on its gate (the classifier admits only a repeatable one). */
function keyAttribute(site: HideGuardSite): string {
  return site.key ? ` key={${site.key}}` : "";
}

function freshName(base: string, usedNames: Set<string>): string {
  let name = base;
  for (let suffix = 0; usedNames.has(name); suffix += 1) {
    name = `${base}${suffix}`;
  }
  usedNames.add(name);
  return name;
}

/**
 * The text one file gains for its guards, at authored offsets. `usedNames`
 * holds every identifier the module already uses; the gates' local names
 * are chosen outside it and added to it. With no import to anchor to, no
 * guard is written (a module that renders a section imports what it
 * renders).
 */
export function hideGuardInsertions(
  sites: readonly HideGuardSite[],
  usedNames: Set<string>,
  importAnchor: HideGuardImportAnchor | null,
): HideGuardInsertion[] {
  if (!importAnchor) return [];
  const insertions: HideGuardInsertion[] = [];
  let contentGate: string | null = null;
  let pageGate: string | null = null;
  const imports: string[] = [];
  for (const site of sites) {
    let open: string;
    if (site.root === "content") {
      if (contentGate === null) {
        contentGate = freshName("__MorphSectionGate", usedNames);
        imports.push(`MorphSectionGate as ${contentGate}`);
      }
      open = `<${contentGate}${keyAttribute(site)} slot={${JSON.stringify(site.slot)}} render={() => (`;
    } else {
      if (!site.pageLocal) continue;
      if (pageGate === null) {
        pageGate = freshName("__MorphPageSectionGate", usedNames);
        imports.push(`MorphPageSectionGate as ${pageGate}`);
      }
      open = `<${pageGate}${keyAttribute(site)} slot={${JSON.stringify(site.slot)}} hidden={${site.pageLocal}?._hidden} render={() => (`;
    }
    const start = site.wrap?.start ?? site.start;
    const end = site.wrap?.end ?? site.end;
    insertions.push({
      at: start,
      text: open,
      wrapper: { side: "open", start, end },
    });
    insertions.push({
      at: end,
      text: ")} />",
      wrapper: { side: "close", start, end },
    });
  }
  if (imports.length > 0) {
    insertions.unshift({
      at: importAnchor.end,
      text: `${importAnchor.semicolon ? "" : ";"} ${imports
        .map(
          (specifier) =>
            `import { ${specifier} } from ${JSON.stringify(THEME_SECTION_GATE_MODULE)};`,
        )
        .join(" ")}`,
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
  const reader = createThemeSourceAstReader(
    files.map((file) => ({
      path: normalizeThemeSourcePath(file.path),
      content: file.content,
    })),
  );
  const plan = planHideGuards(files, { reader });
  const guarded: Record<string, string[]> = {};
  const out = files.map((file) => {
    const path = normalizeThemeSourcePath(file.path);
    const sites = plan.get(path);
    if (!sites || sites.length === 0) return file;
    const anchor = hideGuardImportAnchor(
      reader.ast(path, file.content) as never,
      file.content,
    );
    const insertions = hideGuardInsertions(
      sites,
      identifierNames(file.content),
      anchor,
    )
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
