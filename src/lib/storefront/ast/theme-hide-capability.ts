import { normalizeThemeSourcePath } from "./theme-content-binding";
import { confirmThemeContentModuleFunctionExport } from "./theme-content-module";
import {
  analyzeB1Route,
  analyzeB1SlotUses,
  reachableThemeModules,
  type B1RouteAnalysis,
  type B1SlotUse,
  type B1SlotUseAnalysis,
  type B1SourceFile,
} from "./theme-content-provenance";
import {
  createThemeSourceAstReader,
  type ThemeSourceAstReader,
} from "./theme-source-ast";
import {
  LEGACY_STARTER_THEME_CONTENT_MODULE_V29_SOURCE,
  STARTER_THEME_CONTENT_MODULE_SOURCE,
} from "../starter-theme-v3-files";
import {
  THEME_CONTENT_MODULE_PATH,
  THEME_SECTION_HIDDEN_HELPER,
} from "../theme-content-slots";

/**
 * M3 Hide, approach B: whether Morph can make one section disappear by
 * omitting its call site at compile time, decided from the source alone and
 * before the section is hidden (content read contract §4.2).
 *
 * A supported section has one or more call sites that a compile-time guard
 * `{hidden ? null : <El …/>}` can wrap, and nothing else in the Theme
 * evaluates its value. While hidden its value is absent from what the page
 * receives, so anything that still read it would show the component's
 * defaults or throw. The guard is Morph's compiled output; the author writes
 * no check and the stored source is never changed.
 *
 * The first version supports only the shapes measured on 2026-10-16 (D104,
 * D107 Q3):
 *
 * - `<El {...content("slot")} />` at a direct position;
 * - per-field member reads of the proven loader's page object at the call
 *   site, `<El a={page.slot.a} b={page.slot.b.c.toUpperCase()} />`, where
 *   `page` is a local holding the whole `Route.useLoaderData()`.
 *
 * Anything else is refused with a reason: a value computed before the page
 * renders the section, an untraced spread, a component that reads content
 * itself, a content module Morph cannot confirm, a legacy shell, and shapes
 * outside the first version (aliases, loader spreads, `morph.pages.get` in a
 * component, conditional or repeated call sites). There is no "probably
 * safe": the classifier never guesses, and it never asks the author to
 * rewrite their code.
 *
 * Pure and read-only. It grants no write permission; the write boundary and
 * the publish check call it with the exact source snapshot they act on.
 */

export type HideRefusalReason =
  | "early-computation"
  | "unsupported-shape"
  | "untraced-spread"
  | "untraced-use"
  | "component-reads-content"
  | "content-module-unconfirmed"
  | "legacy-shell"
  | "no-call-site"
  | "source-unconfirmed";

/** Where Morph's compiled guard goes, for one supported call site. */
export type HideGuardSite = Readonly<{
  file: string;
  /** The JSX element's source range. */
  start: number;
  end: number;
  slot: string;
  root: "content" | "loader";
  /**
   * `child` and `return`/`arrow-body` take different brackets; `guarded` is
   * the Starter's own `!isSectionHidden("slot") && <El/>`, left as it is.
   */
  position: "child" | "return" | "arrow-body" | "guarded";
  /**
   * For a `content` root: the declaration the module imports `content` from
   * (its specifier, and where it ends).
   */
  contentImport: Readonly<{ source: string; end: number }> | null;
  /** For a `loader` root: the local that holds the whole page. */
  pageLocal: string | null;
}>;

export type HideCapability =
  | Readonly<{
      kind: "supported";
      slot: string;
      sites: readonly HideGuardSite[];
    }>
  | Readonly<{
      kind: "unsupported";
      slot: string;
      reason: HideRefusalReason;
      message: string;
      at: Readonly<{ file: string; line: number }> | null;
    }>;

/**
 * `route`: a section of a page or route Document, rendered by one route
 * module. `layout`: a section of the layout Document, which every route
 * renders, so every module in the Theme is checked for other reads.
 */
export type HideCapabilityScope = "route" | "layout";

const PREFIX = "Morph cannot hide this section yet";

/** Capability-limit wording: what Morph cannot do yet, not what the author did wrong. */
const MESSAGES: Readonly<Record<HideRefusalReason, string>> = {
  "early-computation": `${PREFIX}: the page uses its content before rendering the section, and that would still run while the section is hidden.`,
  "unsupported-shape": `${PREFIX}: the page reads its content in a way hiding does not support yet.`,
  "untraced-spread": `${PREFIX}: the section also receives props from a spread Morph cannot trace.`,
  "untraced-use": `${PREFIX}: the page's content is passed somewhere Morph cannot follow.`,
  "component-reads-content": `${PREFIX}: another part of the Theme reads this section's content itself.`,
  "content-module-unconfirmed": `${PREFIX}: Morph cannot confirm that ${THEME_CONTENT_MODULE_PATH} is compatible with hiding, so hiding might not take effect.`,
  "legacy-shell": `${PREFIX}: this part of the Theme does not read its sections from the page content, so hiding would have no effect.`,
  "no-call-site": `${PREFIX}: Morph could not find where the page renders it.`,
  "source-unconfirmed": `${PREFIX}: the Theme source has errors Morph cannot analyse.`,
};

/** Every Starter content module whose `morph.pages.get` returns `_hidden`. */
const STARTER_PAGE_MODULE_SOURCES: readonly string[] = [
  STARTER_THEME_CONTENT_MODULE_SOURCE,
  LEGACY_STARTER_THEME_CONTENT_MODULE_V29_SOURCE,
];

const SCRIPT_FILE = /\.(tsx|jsx|ts|js|mjs|cjs)$/;

function refuse(
  slot: string,
  reason: HideRefusalReason,
  at: Readonly<{ file: string; line: number }> | null = null,
  detail?: string,
): HideCapability {
  return {
    kind: "unsupported",
    slot,
    reason,
    message: detail ? `${MESSAGES[reason]} ${detail}` : MESSAGES[reason],
    at,
  };
}

export type HideCapabilityAnalyzer = Readonly<{
  /** The sections B1 identifies in one module, in source order. */
  sectionsIn(path: string): readonly string[];
  classify(args: {
    callSitePath: string | null;
    slot: string;
    scope: HideCapabilityScope;
  }): HideCapability;
}>;

/**
 * One analyzer per source snapshot, so classifying every section of a Theme
 * parses and analyses each module once.
 */
export function createHideCapabilityAnalyzer(
  sourceFiles: readonly B1SourceFile[],
  options: Readonly<{
    /** The operation's shared parse, so no module is parsed twice. */
    reader?: ThemeSourceAstReader;
  }> = {},
): HideCapabilityAnalyzer {
  const files = sourceFiles.map((file) => ({
    path: normalizeThemeSourcePath(file.path),
    content: file.content,
  }));
  const reader = options.reader ?? createThemeSourceAstReader(files);
  const routeAnalyses = new Map<string, B1RouteAnalysis>();
  const slotUseAnalyses = new Map<string, B1SlotUseAnalysis>();
  const routeAnalysis = (path: string) => {
    let analysis = routeAnalyses.get(path);
    if (!analysis) {
      analysis = analyzeB1Route(files, path, undefined, undefined, reader.read);
      routeAnalyses.set(path, analysis);
    }
    return analysis;
  };
  const slotUses = (path: string) => {
    let analysis = slotUseAnalyses.get(path);
    if (!analysis) {
      analysis = analyzeB1SlotUses(files, path, {
        sharedSourceParser: reader.read,
      });
      slotUseAnalyses.set(path, analysis);
    }
    return analysis;
  };
  const contentModule = files.find(
    (file) => file.path === THEME_CONTENT_MODULE_PATH,
  );
  // Asked only when a content() site needs it, from the shared parse.
  let sectionHiddenConfirmed: boolean | null = null;
  const sectionHiddenOk = () => {
    sectionHiddenConfirmed ??= confirmThemeContentModuleFunctionExport(
      files,
      THEME_SECTION_HIDDEN_HELPER,
      "hide this section",
      contentModule
        ? (reader.ast(contentModule.path, contentModule.content) ?? undefined)
        : undefined,
    ).ok;
    return sectionHiddenConfirmed;
  };
  const pageModuleConfirmed =
    contentModule !== undefined &&
    STARTER_PAGE_MODULE_SOURCES.includes(contentModule.content);
  let reachableCache: Map<string, ReadonlySet<string> | null> | null = null;
  const otherModules = (
    callSitePath: string,
    scope: HideCapabilityScope,
  ): readonly string[] => {
    const candidates =
      scope === "layout"
        ? files
            .map((file) => file.path)
            .filter((path) => path.startsWith("src/") && SCRIPT_FILE.test(path))
        : (() => {
            reachableCache ??= new Map();
            let paths = reachableCache.get(callSitePath);
            if (paths === undefined) {
              const reachable = reachableThemeModules(
                callSitePath,
                files,
                undefined,
                reader.read,
              );
              paths =
                reachable.unboundedDynamicImport || reachable.unparseable
                  ? null
                  : reachable.paths;
              reachableCache.set(callSitePath, paths);
            }
            return paths === null ? null : [...paths];
          })();
    if (candidates === null) return ["*"];
    return candidates.filter(
      (path) =>
        path !== callSitePath &&
        path !== THEME_CONTENT_MODULE_PATH &&
        SCRIPT_FILE.test(path) &&
        files.some((file) => file.path === path),
    );
  };

  const classify: HideCapabilityAnalyzer["classify"] = ({
    callSitePath,
    slot,
    scope,
  }) => {
    if (callSitePath === null) return refuse(slot, "legacy-shell");
    const path = normalizeThemeSourcePath(callSitePath);
    const at = (line: number) => ({ file: path, line });
    const b1 = routeAnalysis(path);
    const uses = slotUses(path);
    if (b1.diagnostics.length > 0 || uses.diagnostics.length > 0) {
      return refuse(
        slot,
        "source-unconfirmed",
        null,
        b1.diagnostics[0] ?? uses.diagnostics[0],
      );
    }

    // A root handed whole to code Morph cannot follow may read this section
    // anywhere.
    const escape = uses.escapes.find(
      (candidate) =>
        (candidate.slot === slot || candidate.slot === null) &&
        (candidate.root !== "loader" || uses.loaderOrigin),
    );
    if (escape) return refuse(slot, "untraced-use", at(escape.line));

    // Every other module that can render with this section's content.
    for (const other of otherModules(path, scope)) {
      if (other === "*") {
        return refuse(
          slot,
          "untraced-use",
          null,
          "Part of the Theme is loaded in a way Morph cannot follow.",
        );
      }
      const otherUses = slotUses(other);
      if (otherUses.diagnostics.length > 0) {
        return refuse(
          slot,
          "source-unconfirmed",
          { file: other, line: 0 },
          otherUses.diagnostics[0],
        );
      }
      const read = otherUses.uses.find((use) => use.slot === slot);
      if (read) {
        return refuse(slot, "component-reads-content", {
          file: other,
          line: read.line,
        });
      }
      const otherEscape = otherUses.escapes.find(
        (candidate) =>
          (candidate.slot === slot || candidate.slot === null) &&
          (candidate.root !== "loader" || otherUses.loaderOrigin),
      );
      if (otherEscape) {
        return refuse(slot, "component-reads-content", {
          file: other,
          line: otherEscape.line,
        });
      }
    }
    const slotUsesHere = uses.uses.filter((use) => use.slot === slot);

    // Candidate call sites: B1-proven section instances of this slot.
    const sites: HideGuardSite[] = [];
    let siteRefusal: HideCapability | null = null;
    for (const instance of b1.instances) {
      if (instance.section !== slot || !instance.componentPath) continue;
      const element = uses.elements.get(instance.start);
      const inside = slotUsesHere.filter(
        (use) => use.start >= instance.start && use.end <= instance.end,
      );
      const line =
        inside[0]?.line ??
        slotUsesHere.find((use) => use.start >= instance.start)?.line ??
        0;
      if (instance.hasUntracedSpread) {
        siteRefusal ??= refuse(slot, "untraced-spread", at(line));
        continue;
      }
      const position =
        element?.position === "guarded" && element.guardSlot !== slot
          ? "other"
          : (element?.position ?? "other");
      if (position === "other") {
        siteRefusal ??= refuse(
          slot,
          "unsupported-shape",
          at(line),
          "It is rendered inside a condition or a loop.",
        );
        continue;
      }
      const contentSite =
        instance.sourceRoots.length === 1 &&
        instance.sourceRoots[0] === "content" &&
        instance.sourceSlots.length === 1 &&
        instance.sourceSlots[0] === slot &&
        inside.length > 0 &&
        inside.every(
          (use) =>
            use.root === "content" &&
            (use.via === "content-call" || use.via === "spread"),
        ) &&
        inside.some((use) => use.via === "spread");
      const pageLocals = new Set(inside.map((use) => use.pageLocal));
      const loaderSite =
        !contentSite &&
        uses.loaderOrigin &&
        instance.sourceSlots.length === 0 &&
        inside.length > 0 &&
        inside.every(
          (use: B1SlotUse) =>
            use.root === "loader" &&
            (use.via === "page-member" || use.via === "member") &&
            use.pageLocal !== null,
        ) &&
        pageLocals.size === 1;
      if (!contentSite && !loaderSite) {
        siteRefusal ??= refuse(slot, "unsupported-shape", at(line));
        continue;
      }
      sites.push({
        file: path,
        start: instance.start,
        end: instance.end,
        slot,
        root: contentSite ? "content" : "loader",
        position,
        contentImport: contentSite ? uses.contentImport : null,
        pageLocal: loaderSite ? [...pageLocals][0]! : null,
      });
    }

    // Every read of the section in this module sits inside a guarded site.
    // A value computed before the page renders the section is named first:
    // it is the reason the call site itself may look untraced too.
    const uncoveredUses = slotUsesHere
      .filter(
        (use) =>
          !sites.some((site) => use.start >= site.start && use.end <= site.end),
      )
      .sort((a, b) => a.start - b.start);
    const early = uncoveredUses.find(
      (use) => !use.inJsx && use.via !== "binding",
    );
    if (early) return refuse(slot, "early-computation", at(early.line));
    if (siteRefusal) return siteRefusal;
    const uncovered = uncoveredUses[0];
    if (uncovered) {
      return refuse(slot, "unsupported-shape", at(uncovered.line));
    }

    // Modules that can reach this route's loader data some other way.
    if (
      sites.some((site) => site.root === "loader") &&
      b1.taints.includes("loader:*")
    ) {
      return refuse(slot, "untraced-use");
    }
    if (b1.taints.includes("content:*") || b1.taints.includes("page:*")) {
      return refuse(slot, "untraced-use");
    }

    if (sites.length === 0) return refuse(slot, "no-call-site");

    // A6: the guard reads the hidden list from the author's content module.
    if (sites.some((site) => site.root === "content") && !sectionHiddenOk()) {
      return refuse(slot, "content-module-unconfirmed", {
        file: THEME_CONTENT_MODULE_PATH,
        line: 0,
      });
    }
    if (sites.some((site) => site.root === "loader") && !pageModuleConfirmed) {
      return refuse(slot, "content-module-unconfirmed", {
        file: THEME_CONTENT_MODULE_PATH,
        line: 0,
      });
    }
    return { kind: "supported", slot, sites };
  };

  const sectionsIn: HideCapabilityAnalyzer["sectionsIn"] = (path) => [
    ...new Set(
      routeAnalysis(normalizeThemeSourcePath(path))
        .instances.map((instance) => instance.section)
        .filter((section): section is string => section !== null),
    ),
  ];

  return { classify, sectionsIn };
}

/** One section, one snapshot; see `createHideCapabilityAnalyzer`. */
export function classifyHideCapability(args: {
  files: readonly B1SourceFile[];
  callSitePath: string | null;
  slot: string;
  scope: HideCapabilityScope;
}): HideCapability {
  return createHideCapabilityAnalyzer(args.files).classify(args);
}
