import {
  readThemePathAliases,
  resolveThemeBaseUrlImport,
  resolveThemePathAlias,
} from "../compiler/theme-path-aliases";
import {
  normalizeThemeSourcePath,
  themeImportBase,
} from "./theme-content-binding";
import { confirmThemeContentModuleFunctionExport } from "./theme-content-module";
import {
  analyzeB1Route,
  analyzeB1SlotUses,
  type B1RouteAnalysis,
  type B1SlotUse,
  type B1SlotUseAnalysis,
  type B1SourceFile,
} from "./theme-content-provenance";
import {
  findComponentReferences,
  type ComponentImport,
} from "./theme-hide-component-mounts";
import { isThemeStartConfigPath } from "../compiler/theme-start-toolchain";
import {
  createThemeSourceAstReader,
  type ThemeSourceAstReader,
  parseThemeSourceAst,
} from "./theme-source-ast";
import { deriveThemeDocumentLayoutPath } from "../compiler/theme-route-sections";
import {
  LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE,
  LEGACY_STARTER_THEME_CONTENT_MODULE_V12_SOURCE,
  LEGACY_STARTER_THEME_CONTENT_MODULE_V13_SOURCE,
  LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE,
  LEGACY_STARTER_THEME_CONTENT_MODULE_V29_SOURCE,
  LEGACY_STARTER_THEME_CONTENT_MODULE_V31_SOURCE,
  STARTER_THEME_CONTENT_MODULE_SOURCE,
  STARTER_THEME_ROOT_ROUTE_SOURCE,
} from "../starter-theme-v3-files";
import {
  THEME_CONTENT_CONTEXT_KEY,
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
  | "source-unconfirmed"
  /**
   * The Theme still has an older Starter's content module, whose read turns
   * a failure into empty content: a hidden section could come back with its
   * defaults. Hidden sections ship with Starter 32 (decision 2026-11-26).
   */
  | "starter-upgrade-required"
  /**
   * `src/routes/__root.tsx` is not the Starter's, so the root route's
   * snapshot, which Morph's gate reads the hidden list from, is not known.
   */
  | "root-route-unconfirmed"
  /**
   * The section's component is also rendered somewhere other than as a
   * section (`<Hero />` in another component, `createElement(Hero)`), which
   * would keep showing it, with its defaults, while it is hidden.
   */
  | "unguarded-mount"
  /**
   * The Theme carries a build input Morph's managed Start build does not
   * account for: a root-level tool config or script, a `.morph/` file, a
   * `package.json` under `src/`, a Start entry override, a CSS plugin.
   */
  | "custom-build"
  /**
   * The Theme's recorded framework is not Start. This classifier reads
   * Start source only, so the write boundary refuses such a hide before
   * calling it (until M3 P5).
   */
  | "framework-not-supported";

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
   * (its specifier, where it ends, and whether it ends with a semicolon).
   */
  contentImport: Readonly<{
    source: string;
    end: number;
    semicolon: boolean;
  }> | null;
  /** For a `loader` root: the local that holds the whole page. */
  pageLocal: string | null;
  /**
   * The import the element renders (module and export name), when the
   * proof resolves it. Every other reference to the component it names, by
   * any path, must be a section mount of its own
   * (`theme-hide-component-mounts.ts`).
   */
  component?: ComponentImport | null;
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
  "framework-not-supported": `${PREFIX}: hiding is only supported on TanStack Start pages so far. Edit it in Code mode.`,
  "starter-upgrade-required": `${PREFIX}: this Theme still has an older Starter's ${THEME_CONTENT_MODULE_PATH}, which shows sections with their defaults when the page content cannot be read. Upgrade the Theme to the current Starter, then hide it.`,
  "custom-build": `${PREFIX}: this Theme changes how it is built, so Morph cannot confirm what the live site would run.`,
  "unguarded-mount": `${PREFIX}: the Theme renders this section's component somewhere without its content, so it would still show there, with its defaults.`,
  "root-route-unconfirmed": `${PREFIX}: src/routes/__root.tsx has been changed from the Starter's, so Morph cannot confirm where the page learns which sections are hidden.`,
};

/** The capability-limit wording for a refusal reason. */
export function hideRefusalMessage(reason: HideRefusalReason): string {
  return MESSAGES[reason];
}

/** Every Starter content module whose `morph.pages.get` returns `_hidden`. */
const STARTER_PAGE_MODULE_SOURCES: readonly string[] = [
  STARTER_THEME_CONTENT_MODULE_SOURCE,
];

/**
 * Every Starter root route that loads the raw content into the route context
 * (`loadContentSlots` → `MorphContentProvider`). The root has not changed
 * since the content module was introduced.
 */
const STARTER_ROOT_ROUTE_SOURCES: readonly string[] = [
  STARTER_THEME_ROOT_ROUTE_SOURCE,
];

/**
 * Every Starter content module, whose `content`/`isSectionHidden` and
 * context are the platform's. A content() guard reads the hidden list
 * through them, so they are confirmed as code, not as a function shape: an
 * `isSectionHidden` that answers a constant would pass a shape check.
 */
const STARTER_CONTENT_MODULE_SOURCES: readonly string[] = [
  STARTER_THEME_CONTENT_MODULE_SOURCE,
];

/**
 * Older Starter content modules. Each answers a failed read with empty
 * content somewhere (Starter 31's server read, for one), so a hidden section
 * could come back with its defaults: such a Theme is asked to upgrade.
 */
const LEGACY_STARTER_CONTENT_MODULE_SOURCES: readonly string[] = [
  LEGACY_STARTER_THEME_CONTENT_MODULE_V31_SOURCE,
  LEGACY_STARTER_THEME_CONTENT_MODULE_V29_SOURCE,
  LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE,
  LEGACY_STARTER_THEME_CONTENT_MODULE_V13_SOURCE,
  LEGACY_STARTER_THEME_CONTENT_MODULE_V12_SOURCE,
  LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE,
];

/** AST keys that carry position, comments or raw spelling, never meaning. */
const NON_SEMANTIC_KEYS = new Set([
  "start",
  "end",
  "loc",
  "range",
  "extra",
  "comments",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "tokens",
]);

/**
 * Comments a compiler reads: JSX pragmas (`@jsx`, `@jsxFrag`,
 * `@jsxImportSource`, `@jsxRuntime`), which change what esbuild emits for
 * the module's JSX, and bundler annotations that change what is kept.
 */
const COMPILER_COMMENT = /[@#]\s*(jsx\w*|__PURE__|__NO_SIDE_EFFECTS__|vite-ignore)\b/;

/**
 * A module's code with comments, whitespace and spelling of literals left
 * out: two sources with the same key are the same program. Null when the
 * source does not parse. Directives (`"use client"`) are part of the
 * program; the comments a compiler reads are kept beside it, in order, so a
 * pragma added to a pinned file changes its key.
 */
function codeKey(path: string, content: string): string | null {
  const parsed = parseThemeSourceAst({ path, content });
  if (!parsed.ok) return null;
  const comments = ((parsed.ast as { comments?: Array<{ value?: string }> }).comments ?? [])
    .map((comment) => String(comment.value ?? ""))
    .filter((value) => COMPILER_COMMENT.test(value))
    .map((value) => value.replace(/\s+/g, " ").trim());
  return JSON.stringify({
    program: JSON.parse(
      JSON.stringify(parsed.ast.program, (key, value) =>
        NON_SEMANTIC_KEYS.has(key) ? undefined : value,
      ),
    ),
    compilerComments: comments,
  });
}

const knownCodeKeys = new Map<readonly string[], ReadonlySet<string>>();
/** Whether `content` is, as code, one of `sources`. */
function isKnownCode(
  sources: readonly string[],
  path: string,
  content: string,
): boolean {
  if (sources.includes(content)) return true;
  let keys = knownCodeKeys.get(sources);
  if (!keys) {
    keys = new Set(
      sources
        .map((source) => codeKey(path, source))
        .filter((key): key is string => key !== null),
    );
    knownCodeKeys.set(sources, keys);
  }
  const key = codeKey(path, content);
  return key !== null && keys.has(key);
}

const SCRIPT_FILE = /\.(tsx|jsx|ts|js|mjs|cjs)$/;

const ROUTE_MODULE = /^src\/routes\/.+\.(tsx|jsx)$/;
const ROOT_ROUTE = /^src\/routes\/__root\.(tsx|jsx)$/;

/**
 * The modules whose supported call sites Morph's build guards
 * (`planHideGuards`): every route module but the root, and the document
 * layout. Elsewhere a call site is never wrapped, so a read there is a
 * reader the guard does not cover.
 */
export function isHideGuardedModule(
  path: string,
  layoutPath: string | null,
): boolean {
  return (
    path === layoutPath || (ROUTE_MODULE.test(path) && !ROOT_ROUTE.test(path))
  );
}

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

/**
 * For a route (or the layout) whose own JSX does not render a section:
 * `not-rendered` only when the source proves nothing in its scope reads the
 * section; otherwise the classifier's verdict (the route reads it after all)
 * or why it cannot be proven. "Cannot analyse" is never "not rendered".
 */
export type HideNotRenderedProof =
  | Readonly<{ kind: "not-rendered"; slot: string }>
  | HideCapability;

export type HideCapabilityAnalyzer = Readonly<{
  /** The sections B1 identifies in one module, in source order. */
  sectionsIn(path: string): readonly string[];
  classify(args: {
    callSitePath: string | null;
    slot: string;
    scope: HideCapabilityScope;
  }): HideCapability;
  /**
   * Whether `slot` is proven unread by the route (or layout) at
   * `sourcePath` and by every module of the Theme: runtime picks a document
   * by the requested URL, and the route tree runs modules no import edge
   * reaches, so the proof is a whole-Theme proof for either scope. Read with
   * the same slot-use analysis the classifier uses, so the two cannot
   * disagree about what a read is.
   */
  proveNotRendered(args: {
    sourcePath: string;
    slot: string;
    scope: HideCapabilityScope;
  }): HideNotRenderedProof;
  /**
   * For a section no route is found to serve: `not-rendered` only when no
   * module of the Theme reads `slot` by any root, every module parses, and
   * nothing reaches content in a way the analysis cannot follow.
   */
  proveUnread(args: { slot: string }): HideNotRenderedProof;
}>;

// Babel nodes are read structurally here, as in the other AST readers.
type AnyNode = any;

/** `content`/`morph` come from here; reached any other way, B1 cannot follow. */
const SDK_SPECIFIER = /^@morph\/sdk(\/|$)/;
/**
 * Theme files only a Vite plugin (or another loader) can execute, which the
 * slot-use analysis cannot read. Anywhere under `src/` they defeat the
 * whole-Theme proof; imported, they are refused where they are imported.
 */
const UNANALYSED_SOURCE = /\.(mts|cts|mdx|vue|svelte|astro)$/;
/** Imports that evaluate no Theme code: styles, data and media. */
const INERT_MODULE =
  /\.(css|scss|sass|less|json|svg|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|txt|mp4|webm|mp3)$/i;
/** A Theme's own Vite config: aliases and plugins Morph cannot follow. */
const VITE_CONFIG = /^vite\.config\.(ts|js|mjs|cjs|mts|cts)$/;
/**
 * What an extensionless relative import may name: Morph's own order and
 * Vite's default `resolve.extensions` together. More than one existing
 * candidate means the analysis and Vite may pick different files.
 */
const RESOLVE_SUFFIXES = [
  "",
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mjs",
  ".mts",
  ".cjs",
  ".cts",
  ".json",
  "/index.tsx",
  "/index.ts",
  "/index.jsx",
  "/index.js",
  "/index.mjs",
  "/index.mts",
  "/index.json",
] as const;
/** The route tree the build generates; it imports only `src/routes/` files. */
const GENERATED_ROUTE_TREE = "src/routeTree.gen";
const ROOT_ROUTE_PATH = "src/routes/__root.tsx";
/** Where a Starter page answer carries its hidden slots (`_hidden`). */
const HIDDEN_LIST_KEY = "_hidden";
/** What a module may import from the content module, by name. */
const CONTENT_MODULE_READERS = new Set(["content", "isSectionHidden", "morph"]);
/**
 * Router APIs that hand out match objects, the route context or another
 * route's loader data: any of them can read the raw content the Starter
 * root route puts in the route context.
 */
const ROUTER_CONTEXT_APIS = new Set([
  "useRouteContext",
  "useMatch",
  "useMatches",
  "useParentMatches",
  "useChildMatches",
  "useRouterState",
  "useRouter",
  "getRouteApi",
  "useLoaderDeps",
]);
/** Route options TanStack calls with the route context. */
const ROUTE_CONTEXT_OPTIONS = new Set([
  "loader",
  "beforeLoad",
  "loaderDeps",
  "context",
  "head",
  "headers",
  "scripts",
  "links",
  "onEnter",
  "onStay",
  "onLeave",
  "shouldReload",
]);

type ModuleAccessProblem = Readonly<{
  reason: HideRefusalReason;
  line: number;
  detail: string;
}>;

type ModuleAccess = Readonly<{
  /** Reaches content in a way the slot-use analysis cannot follow. */
  problem: ModuleAccessProblem | null;
  /**
   * Reads of the hidden flag itself other than the exact Starter guard
   * `!isSectionHidden("slot") && <El/>`: the slot read, or null when it
   * cannot be named. Hiding changes what such code does.
   */
  /**
   * Every `isSectionHidden` read but the Starter's exact check. A check
   * that is exact in shape is kept with the element it omits (`omits`),
   * still to be proven that section's own mount (`accessRefusal`).
   */
  hiddenFlagReads: readonly Readonly<{
    slot: string | null;
    line: number;
    omits?: number;
  }>[];
}>;

/** How one import specifier resolves, decided exactly or not at all. */
type ResolvedSpecifier =
  | Readonly<{ kind: "module"; target: string; alias: boolean }>
  | Readonly<{ kind: "asset" }>
  | Readonly<{ kind: "package" }>
  | Readonly<{ kind: "refused"; detail: string }>;

/**
 * The plugins a Theme's own Vite config may use while Morph can still prove
 * a hide: Start, React and Cloudflare's own, called as Morph's Starter and
 * native template call them. `args: "none"` takes no options at all
 * (`tanstackStart({ srcDirectory })` or a React Babel plugin would change
 * what runs); `"literal"` takes plain data only.
 */
const PLAIN_VITE_PLUGINS: Readonly<
  Record<string, Readonly<{ name: string; args: "none" | "literal" }>>
> = {
  "@cloudflare/vite-plugin": { name: "cloudflare", args: "literal" },
  "@tanstack/react-start/plugin/vite": { name: "tanstackStart", args: "none" },
  "@vitejs/plugin-react": { name: "default", args: "none" },
};

function isLiteralValue(node: AnyNode): boolean {
  switch (node?.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
      return true;
    case "ArrayExpression":
      return (node.elements ?? []).every(isLiteralValue);
    case "ObjectExpression":
      return (node.properties ?? []).every(
        (property: AnyNode) =>
          property.type === "ObjectProperty" &&
          !property.computed &&
          (property.key?.type === "Identifier" ||
            property.key?.type === "StringLiteral") &&
          isLiteralValue(property.value),
      );
    default:
      return false;
  }
}

/**
 * Whether a Theme's Vite config is exactly `export default defineConfig({
 * plugins: [...] })` over the plain plugins above: no aliases, no other
 * plugin, no option that changes which modules run or how. Anything else can
 * resolve or transform a module in a way the proof cannot follow.
 */
function isPlainStartViteConfig(
  file: B1SourceFile,
  reader: ThemeSourceAstReader,
): boolean {
  const parsed = reader.read(file.path, file.content);
  if (!parsed.ok) return false;
  const locals = new Map<string, string>();
  let config: AnyNode = null;
  for (const statement of parsed.ast.program.body ?? []) {
    if (statement.type === "ImportDeclaration") {
      if (statement.importKind === "type") continue;
      const source = statement.source?.value;
      for (const specifier of statement.specifiers ?? []) {
        const imported =
          specifier.type === "ImportDefaultSpecifier"
            ? "default"
            : specifier.type === "ImportSpecifier"
              ? specifier.imported?.type === "Identifier"
                ? specifier.imported.name
                : specifier.imported?.value
              : null;
        if (source === "vite" && imported === "defineConfig") {
          locals.set(specifier.local.name, "defineConfig");
        } else if (PLAIN_VITE_PLUGINS[source]?.name === imported) {
          locals.set(specifier.local.name, source);
        } else {
          return false;
        }
      }
      if ((statement.specifiers ?? []).length === 0) return false;
    } else if (statement.type === "ExportDefaultDeclaration" && !config) {
      config = statement.declaration;
    } else {
      return false;
    }
  }
  if (
    config?.type !== "CallExpression" ||
    config.callee?.type !== "Identifier" ||
    locals.get(config.callee.name) !== "defineConfig" ||
    (config.arguments ?? []).length !== 1
  ) {
    return false;
  }
  const options = config.arguments[0];
  if (options?.type !== "ObjectExpression") return false;
  return (options.properties ?? []).every((property: AnyNode) => {
    if (
      property.type !== "ObjectProperty" ||
      property.computed ||
      property.key?.type !== "Identifier" ||
      property.key.name !== "plugins" ||
      property.value?.type !== "ArrayExpression"
    ) {
      return false;
    }
    return (property.value.elements ?? []).every((element: AnyNode) => {
      if (
        element?.type !== "CallExpression" ||
        element.callee?.type !== "Identifier"
      ) {
        return false;
      }
      const plugin = PLAIN_VITE_PLUGINS[locals.get(element.callee.name) ?? ""];
      if (!plugin) return false;
      const args = element.arguments ?? [];
      return plugin.args === "none"
        ? args.length === 0
        : args.length <= 1 && args.every(isLiteralValue);
    });
  });
}

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
    sectionHiddenConfirmed ??=
      contentModule !== undefined &&
      isKnownCode(
        STARTER_CONTENT_MODULE_SOURCES,
        contentModule.path,
        contentModule.content,
      ) &&
      confirmThemeContentModuleFunctionExport(
        files,
        THEME_SECTION_HIDDEN_HELPER,
        "hide this section",
        reader.ast(contentModule.path, contentModule.content) ?? undefined,
      ).ok;
    return sectionHiddenConfirmed;
  };
  const pageModuleConfirmed =
    contentModule !== undefined &&
    isKnownCode(
      STARTER_PAGE_MODULE_SOURCES,
      contentModule.path,
      contentModule.content,
    );
  // The Starter root route loads the raw content (`loadContentSlots`) and
  // puts it in the route context for `MorphContentProvider`. Only that exact
  // module may import those helpers; with it present, every other module
  // that can read the route context is a reader Morph cannot follow.
  const rootConfirmed = files.some(
    (file) =>
      file.path === ROOT_ROUTE_PATH &&
      isKnownCode(STARTER_ROOT_ROUTE_SOURCES, file.path, file.content),
  );

  // How each module reaches other modules, read from the shared parse. The
  // slot-use analysis recognises `content`/`morph` only as a named import
  // of the content module by a relative path. Every specifier is resolved
  // exactly as Vite would, or refused: a module the analysis cannot name is
  // never read as "nothing reads this".
  const filePaths = new Set(files.map((file) => file.path));
  let aliasLookup: {
    byPath: ReadonlyMap<string, { path: string; content: string }>;
    config: ReturnType<typeof readThemePathAliases>;
  } | null = null;
  const candidatesOf = (base: string) =>
    RESOLVE_SUFFIXES.map((suffix) => `${base}${suffix}`).filter((path) =>
      filePaths.has(path),
    );
  const resolveSpecifier = (
    from: string,
    specifier: string,
  ): ResolvedSpecifier => {
    if (specifier.includes("?") || specifier.includes("#")) {
      return {
        kind: "refused",
        detail: `imports "${specifier}", with a query or hash Vite may load differently`,
      };
    }
    if (specifier.startsWith("/")) {
      return {
        kind: "refused",
        detail: `imports "${specifier}" by an absolute path, which Morph does not follow`,
      };
    }
    if (
      /^[a-z][a-z0-9+.-]*:/i.test(specifier) &&
      !specifier.startsWith("node:")
    ) {
      return {
        kind: "refused",
        detail: `imports "${specifier}", a URL or virtual module Morph cannot read`,
      };
    }
    if (specifier.startsWith(".")) {
      const base = themeImportBase(from, specifier);
      if (!base) {
        return {
          kind: "refused",
          detail: `imports "${specifier}", outside src/, which Morph does not analyse`,
        };
      }
      if (filePaths.has(base)) return { kind: "module", target: base, alias: false };
      if (filePaths.has(`${base}/package.json`)) {
        // Vite resolves a directory through its package.json entry first.
        return {
          kind: "refused",
          detail: `imports "${specifier}", a directory whose package.json Vite may resolve to another file`,
        };
      }
      const candidates = candidatesOf(base);
      if (candidates.length === 1) {
        return { kind: "module", target: candidates[0]!, alias: false };
      }
      if (candidates.length === 0 && base === GENERATED_ROUTE_TREE) {
        return { kind: "asset" };
      }
      if (candidates.length === 0 && INERT_MODULE.test(base)) {
        // A stylesheet or image Morph has no text for: it runs no code.
        return { kind: "asset" };
      }
      return {
        kind: "refused",
        detail:
          candidates.length === 0
            ? `imports "${specifier}", which no Theme file Morph can read answers`
            : `imports "${specifier}", which more than one file could answer (${candidates.join(", ")})`,
      };
    }
    aliasLookup ??= {
      byPath: new Map(files.map((file) => [file.path, file])),
      config: readThemePathAliases(files),
    };
    const resolved =
      resolveThemePathAlias(specifier, aliasLookup.byPath, aliasLookup.config) ??
      resolveThemeBaseUrlImport(
        specifier,
        aliasLookup.byPath,
        aliasLookup.config,
      );
    if (resolved) {
      const target = normalizeThemeSourcePath(resolved);
      const base = target.replace(/(\/index)?\.(tsx|ts|jsx|js|mjs|cjs)$/, "");
      if (target !== base && candidatesOf(base).length > 1 && !specifier.endsWith(target.slice(target.lastIndexOf(".")))) {
        return {
          kind: "refused",
          detail: `imports "${specifier}", which more than one file could answer (${candidatesOf(base).join(", ")})`,
        };
      }
      const directory = target.match(/^(.*)\/index\.[a-z]+$/)?.[1];
      if (directory && filePaths.has(`${directory}/package.json`)) {
        return {
          kind: "refused",
          detail: `imports "${specifier}", a directory whose package.json Vite may resolve to another file`,
        };
      }
      return { kind: "module", target, alias: true };
    }
    // A specifier a path alias (or baseUrl) claims but no Theme file answers:
    // Vite may still find something there that Morph cannot read.
    const { config } = aliasLookup;
    const claimed =
      config.aliases.some((alias) =>
        alias.wildcard
          ? specifier === alias.key || specifier.startsWith(`${alias.key}/`)
          : specifier === alias.key,
      ) ||
      (config.baseUrl !== "" &&
        (() => {
          const root = normalizeThemeSourcePath(`${config.baseUrl}/${specifier}`);
          return [...filePaths].some(
            (path) => path === root || path.startsWith(`${root}.`) || path.startsWith(`${root}/`),
          );
        })());
    if (claimed) {
      return {
        kind: "refused",
        detail: `imports "${specifier}" through a path alias no Theme file Morph can read answers`,
      };
    }
    return { kind: "package" };
  };

  // A Vite config of the Theme's own, or a file only a plugin can execute,
  // defeats the whole-Theme proof for every section.
  const themeProblem: (ModuleAccessProblem & { file: string }) | null =
    (() => {
      const config = files.find(
        (file) =>
          VITE_CONFIG.test(file.path) && !isPlainStartViteConfig(file, reader),
      );
      if (config) {
        return {
          file: config.path,
          reason: "source-unconfirmed",
          line: 0,
          detail: `${config.path} configures Vite itself; Morph cannot confirm how it resolves and transforms the Theme's modules.`,
        };
      }
      const unanalysed = files.find(
        (file) => file.path.startsWith("src/") && UNANALYSED_SOURCE.test(file.path),
      );
      if (unanalysed) {
        return {
          file: unanalysed.path,
          reason: "source-unconfirmed",
          line: 0,
          detail: `${unanalysed.path} is a kind of module Morph cannot analyse.`,
        };
      }
      return null;
    })();

  const accessCache = new Map<string, ModuleAccess>();
  const moduleAccess = (path: string): ModuleAccess => {
    const cached = accessCache.get(path);
    if (cached) return cached;
    const file = files.find((candidate) => candidate.path === path);
    const parsed = file ? reader.read(file.path, file.content) : null;
    let problem: ModuleAccessProblem | null = null;
    const hiddenFlagReads: { slot: string | null; line: number; omits?: number }[] = [];
    const flag = (reason: HideRefusalReason, node: AnyNode, detail: string) => {
      problem ??= { reason, line: node?.loc?.start.line ?? 0, detail };
    };
    const isConfirmedRoot = rootConfirmed && path === ROOT_ROUTE_PATH;
    const readsRouteContext = rootConfirmed && !isConfirmedRoot;
    if (!parsed || !parsed.ok) {
      problem = {
        reason: "source-unconfirmed",
        line: 0,
        detail: parsed && !parsed.ok ? parsed.message : `${path} could not be read.`,
      };
    } else {
      const reach = (
        node: AnyNode,
        specifier: unknown,
        how: string,
        names: readonly string[] = [],
      ) => {
        if (typeof specifier !== "string") {
          return flag(
            "untraced-use",
            node,
            `${path} loads a module Morph cannot name (${how}).`,
          );
        }
        if (SDK_SPECIFIER.test(specifier)) {
          return flag(
            "untraced-use",
            node,
            `${path} reads Morph content through ${specifier} directly, which Morph does not follow yet.`,
          );
        }
        const resolved = resolveSpecifier(path, specifier);
        if (resolved.kind === "refused") {
          return flag("untraced-use", node, `${path} ${resolved.detail}.`);
        }
        if (resolved.kind !== "module") return;
        const { target, alias } = resolved;
        if (target === THEME_CONTENT_MODULE_PATH) {
          if (how !== "named import" || alias) {
            return flag(
              "untraced-use",
              node,
              `${path} reaches ${THEME_CONTENT_MODULE_PATH} through ${alias ? `the path alias "${specifier}"` : `a ${how}`}, which Morph does not follow yet.`,
            );
          }
          const other = names.find((name) => !CONTENT_MODULE_READERS.has(name));
          if (other !== undefined && !isConfirmedRoot) {
            return flag(
              "untraced-use",
              node,
              `${path} imports ${other} from ${THEME_CONTENT_MODULE_PATH}, which can read content in a way Morph does not follow.`,
            );
          }
          return;
        }
        if (SCRIPT_FILE.test(target)) {
          if (!target.startsWith("src/")) {
            return flag(
              "untraced-use",
              node,
              `${path} imports ${target}, outside src/, which Morph does not analyse.`,
            );
          }
          return;
        }
        if (INERT_MODULE.test(target)) return;
        return flag(
          "source-unconfirmed",
          node,
          `${path} imports ${target}, a kind of module Morph cannot analyse.`,
        );
      };
      const keyName = (key: AnyNode): string | null =>
        key?.type === "Identifier"
          ? key.name
          : key?.type === "StringLiteral"
            ? key.value
            : null;
      const visit = (node: AnyNode): void => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(visit);
        if (node.type === "ImportDeclaration") {
          const values = (node.specifiers ?? []).filter(
            (specifier: AnyNode) => specifier.importKind !== "type",
          );
          if (node.importKind !== "type" && (values.length > 0 || (node.specifiers ?? []).length === 0)) {
            const opaque = values.some(
              (specifier: AnyNode) => specifier.type !== "ImportSpecifier",
            );
            reach(
              node,
              node.source?.value,
              opaque ? "namespace or default import" : "named import",
              values.map(
                (specifier: AnyNode) => keyName(specifier.imported) ?? "",
              ),
            );
          }
        } else if (
          (node.type === "ExportNamedDeclaration" ||
            node.type === "ExportAllDeclaration") &&
          node.source
        ) {
          if (node.exportKind !== "type") {
            reach(node, node.source.value, "re-export");
          }
        } else if (node.type === "ImportExpression") {
          reach(
            node,
            node.source?.type === "StringLiteral" ? node.source.value : null,
            "dynamic import",
          );
        } else if (
          node.type === "CallExpression" &&
          (node.callee?.type === "Import" ||
            (node.callee?.type === "Identifier" &&
              node.callee.name === "require"))
        ) {
          const source = node.arguments?.[0];
          reach(
            node,
            source?.type === "StringLiteral" ? source.value : null,
            node.callee.type === "Import" ? "dynamic import" : "require",
          );
        } else if (
          node.type === "MemberExpression" &&
          node.object?.type === "MetaProperty" &&
          node.object.meta?.name === "import" &&
          !node.computed &&
          typeof node.property?.name === "string" &&
          node.property.name.startsWith("glob")
        ) {
          reach(node, null, "import.meta.glob");
        } else if (
          node.type === "NewExpression" &&
          node.callee?.type === "Identifier"
        ) {
          const [first, second] = node.arguments ?? [];
          if (
            node.callee.name === "URL" &&
            second?.type === "MemberExpression" &&
            second.object?.type === "MetaProperty" &&
            second.property?.name === "url"
          ) {
            // A worker or asset Vite emits from this module.
            reach(
              node,
              first?.type === "StringLiteral" ? first.value : null,
              "new URL(…, import.meta.url)",
            );
          } else if (
            (node.callee.name === "Worker" ||
              node.callee.name === "SharedWorker") &&
            !(
              first?.type === "NewExpression" &&
              first.callee?.type === "Identifier" &&
              first.callee.name === "URL"
            )
          ) {
            flag(
              "untraced-use",
              node,
              `${path} starts a worker Morph cannot name.`,
            );
          }
        } else if (
          (node.type === "StringLiteral" &&
            node.value.includes("/_morph/")) ||
          (node.type === "TemplateElement" &&
            String(node.value?.raw ?? "").includes("/_morph/"))
        ) {
          flag(
            "untraced-use",
            node,
            `${path} names Morph's content endpoint itself, which Morph does not follow.`,
          );
        }
        if (readsRouteContext) {
          // The route context carries the raw content (`morphContent`).
          const name =
            node.type === "Identifier"
              ? node.name
              : (node.type === "MemberExpression" ||
                    node.type === "OptionalMemberExpression") &&
                  (!node.computed || node.property?.type === "StringLiteral")
                ? keyName(node.property)
                : node.type === "StringLiteral"
                  ? node.value
                  : null;
          if (
            name !== null &&
            (ROUTER_CONTEXT_APIS.has(name) ||
              name === THEME_CONTENT_CONTEXT_KEY ||
              (name === "context" && node.type !== "Identifier"))
          ) {
            flag(
              "untraced-use",
              node,
              `${path} can read the route context, where the root route keeps the page's content.`,
            );
          }
          if (node.type === "ObjectPattern") {
            for (const property of node.properties ?? []) {
              if (
                property.type === "ObjectProperty" &&
                !property.computed &&
                keyName(property.key) === "context"
              ) {
                flag(
                  "untraced-use",
                  property,
                  `${path} can read the route context, where the root route keeps the page's content.`,
                );
              }
            }
          }
          // `createFileRoute("/x")({ … })`, `createRootRoute({ … })`, …: the
          // options TanStack calls with the route context.
          const factory =
            node.type === "CallExpression"
              ? node.callee?.type === "CallExpression"
                ? node.callee.callee
                : node.callee
              : null;
          const routeOptions =
            factory?.type === "Identifier" &&
            /^create\w*Route\w*$/.test(factory.name) &&
            node.arguments?.[0]?.type === "ObjectExpression"
              ? node.arguments[0].properties
              : [];
          for (const option of routeOptions) {
            if (
              (option.type !== "ObjectProperty" &&
                option.type !== "ObjectMethod") ||
              option.computed ||
              !ROUTE_CONTEXT_OPTIONS.has(keyName(option.key) ?? "")
            ) {
              continue;
            }
            // Only a function whose first parameter is absent or destructured
            // (without `context`, checked above) is followed.
            const fn = option.type === "ObjectMethod" ? option : option.value;
            const isFunction =
              fn?.type === "ArrowFunctionExpression" ||
              fn?.type === "FunctionExpression" ||
              fn?.type === "ObjectMethod";
            const first = isFunction ? fn.params?.[0] : undefined;
            if (
              !isFunction ||
              (first !== undefined && first.type !== "ObjectPattern") ||
              (first?.type === "ObjectPattern" &&
                (first.properties ?? []).some(
                  (property: AnyNode) => property.type === "RestElement",
                ))
            ) {
              flag(
                "untraced-use",
                option,
                `${path} hands the route context to code Morph does not follow.`,
              );
            }
          }
        }
        for (const [key, value] of Object.entries(node)) {
          if (
            key === "loc" ||
            key === "leadingComments" ||
            key === "trailingComments" ||
            key === "innerComments"
          ) {
            continue;
          }
          if (value && typeof value === "object") visit(value);
        }
      };
      visit(parsed.ast.program);

      // Names this module binds to the hidden flag and to route objects.
      const hiddenLocals = new Set<string>();
      const routeLocals = new Set<string>();
      for (const statement of parsed.ast.program.body ?? []) {
        if (statement.type === "ImportDeclaration") {
          const source = statement.source?.value;
          const resolved =
            typeof source === "string" && !SDK_SPECIFIER.test(source)
              ? resolveSpecifier(path, source)
              : null;
          if (
            resolved?.kind === "module" &&
            resolved.target === THEME_CONTENT_MODULE_PATH
          ) {
            for (const specifier of statement.specifiers ?? []) {
              if (
                specifier.type === "ImportSpecifier" &&
                keyName(specifier.imported) === THEME_SECTION_HIDDEN_HELPER
              ) {
                hiddenLocals.add(specifier.local.name);
              }
            }
          }
          if (
            readsRouteContext &&
            typeof source === "string" &&
            source.startsWith("@tanstack/") &&
            (statement.specifiers ?? []).some(
              (specifier: AnyNode) => specifier.type !== "ImportSpecifier",
            )
          ) {
            flag(
              "untraced-use",
              statement,
              `${path} imports the whole of ${source}, which can read the route context.`,
            );
          }
        }
      }
      const routeFactory = (init: AnyNode): boolean => {
        const callee =
          init?.type === "CallExpression"
            ? init.callee?.type === "CallExpression"
              ? init.callee.callee
              : init.callee
            : null;
        return (
          callee?.type === "Identifier" && /^create\w*Route\w*$/.test(callee.name)
        );
      };
      const declarators = (node: AnyNode): void => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(declarators);
        if (
          node.type === "VariableDeclarator" &&
          node.id?.type === "Identifier" &&
          routeFactory(node.init)
        ) {
          routeLocals.add(node.id.name);
        }
        for (const [key, value] of Object.entries(node)) {
          if (NON_SEMANTIC_KEYS.has(key)) continue;
          if (value && typeof value === "object") declarators(value);
        }
      };
      if (readsRouteContext) declarators(parsed.ast.program);

      // Every reference, with its ancestors.
      const walk = (node: AnyNode, ancestors: AnyNode[]): void => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          for (const item of node) walk(item, ancestors);
          return;
        }
        const [parent, grand, great, container, holder] = [
          ancestors[ancestors.length - 1],
          ancestors[ancestors.length - 2],
          ancestors[ancestors.length - 3],
          ancestors[ancestors.length - 4],
          ancestors[ancestors.length - 5],
        ];
        if (
          node.type === "Identifier" &&
          parent?.type !== "ImportSpecifier" &&
          !(
            (parent?.type === "MemberExpression" ||
              parent?.type === "OptionalMemberExpression") &&
            parent.property === node &&
            !parent.computed
          ) &&
          !(parent?.type === "ObjectProperty" && parent.key === node && !parent.computed)
        ) {
          if (hiddenLocals.has(node.name)) {
            const call =
              (parent?.type === "CallExpression" ||
                parent?.type === "OptionalCallExpression") &&
              parent.callee === node
                ? parent
                : null;
            const literal =
              call &&
              call.arguments?.length === 1 &&
              call.arguments[0]?.type === "StringLiteral"
                ? (call.arguments[0].value as string)
                : null;
            const exactGuard =
              literal !== null &&
              grand?.type === "UnaryExpression" &&
              grand.operator === "!" &&
              grand.argument === call &&
              great?.type === "LogicalExpression" &&
              great.operator === "&&" &&
              great.left === grand &&
              great.right?.type === "JSXElement" &&
              // Used only to omit: the check is a JSX child of its own,
              // never kept, combined (`||`) or returned.
              container?.type === "JSXExpressionContainer" &&
              container.expression === great &&
              (holder?.type === "JSXElement" || holder?.type === "JSXFragment");
            hiddenFlagReads.push({
              slot: literal,
              line: node.loc?.start.line ?? 0,
              ...(exactGuard ? { omits: great.right.start as number } : {}),
            });
          }
          if (
            routeLocals.has(node.name) &&
            !(parent?.type === "VariableDeclarator" && parent.id === node) &&
            parent?.type !== "ExportSpecifier" &&
            !(
              (parent?.type === "MemberExpression" ||
                parent?.type === "OptionalMemberExpression") &&
              parent.object === node &&
              !parent.computed
            )
          ) {
            flag(
              "untraced-use",
              node,
              `${path} uses its route object in a way Morph cannot follow, which can read the route context.`,
            );
          }
        }
        const next = [...ancestors, node];
        for (const [key, value] of Object.entries(node)) {
          if (NON_SEMANTIC_KEYS.has(key)) continue;
          if (value && typeof value === "object") walk(value, next);
        }
      };
      if (hiddenLocals.size > 0 || routeLocals.size > 0) {
        walk(parsed.ast.program, []);
      }
    }
    const access: ModuleAccess = { problem, hiddenFlagReads };
    accessCache.set(path, access);
    return access;
  };
  const accessRefusal = (path: string, slot: string): HideCapability | null => {
    const { problem, hiddenFlagReads } = moduleAccess(path);
    if (problem) {
      return refuse(
        slot,
        problem.reason,
        { file: path, line: problem.line },
        problem.detail,
      );
    }
    // The hidden state itself. A guard is sound only while it reads the
    // effective hidden list: a module that writes, aliases or reads the
    // page's `_hidden`, or asks `isSectionHidden` for this section other
    // than as the exact guard, changes what hiding does.
    // The exact check counts as omitting only the mount of its own section.
    const flagRead = hiddenFlagReads.find(
      (read) =>
        (read.slot === slot || read.slot === null) &&
        !(
          read.omits !== undefined &&
          read.slot === slot &&
          routeAnalysis(path).instances.some(
            (instance) => instance.start === read.omits && instance.section === slot,
          )
        ),
    );
    if (flagRead) {
      return refuse(
        slot,
        "untraced-use",
        { file: path, line: flagRead.line },
        `${path} asks whether this section is hidden other than to omit it.`,
      );
    }
    const uses = slotUses(path);
    const hiddenList =
      uses.uses.find((use) => use.slot === HIDDEN_LIST_KEY) ??
      uses.escapes.find((escape) => escape.slot === HIDDEN_LIST_KEY);
    if (hiddenList) {
      return refuse(
        slot,
        "untraced-use",
        { file: path, line: hiddenList.line },
        `${path} touches the page's hidden list, which Morph's guard reads.`,
      );
    }
    return null;
  };

  /**
   * Every module the proof reads besides the call site: the whole Theme.
   * Runtime picks a document by the requested URL, and the generated route
   * tree runs parents, layouts, companions and catch-alls no import edge
   * reaches, so a reader anywhere under `src/` may run while the section is
   * hidden. The content module is the platform's own and is judged apart
   * (`sectionHiddenOk`, `pageModuleConfirmed`, the import allow-list).
   */
  const themeModules = files
    .map((file) => file.path)
    .filter((path) => path.startsWith("src/") && SCRIPT_FILE.test(path))
    .filter((path) => path !== THEME_CONTENT_MODULE_PATH);

  /**
   * A build input the managed Start build does not account for. The
   * Theme's own Vite and Wrangler config are judged by the proof itself
   * (a native project), and so is a directory import a package.json could
   * redirect; this names what is left.
   */
  let buildInputChecked = false;
  let buildInput: { file: string; detail: string } | null = null;
  const buildInputProblem = () => {
    if (buildInputChecked) return buildInput;
    buildInputChecked = true;
    for (const file of files) {
      const path = file.path;
      const name = path.slice(path.lastIndexOf("/") + 1);
      if (!path.includes("/")) {
        if (isThemeStartConfigPath(path)) continue;
        if (
          SCRIPT_FILE.test(path) ||
          (/config/i.test(name) && name !== "tsconfig.json" && name !== "jsconfig.json") ||
          /^\.(postcssrc|babelrc)/.test(name)
        ) {
          buildInput = { file: path, detail: `${path} configures the build.` };
          return buildInput;
        }
        continue;
      }
      if (path.startsWith(".morph/")) {
        buildInput = { file: path, detail: `${path} is the platform's place for its own build files.` };
        return buildInput;
      }
      if (!path.startsWith("src/")) continue;
      if (name === "package.json") {
        buildInput = { file: path, detail: `${path} can change how its directory's imports resolve.` };
        return buildInput;
      }
      if (/^src\/(server|client|start|ssr|global-middleware)\.(tsx|ts|jsx|js|mjs)$/.test(path)) {
        buildInput = { file: path, detail: `${path} replaces a Start entry point.` };
        return buildInput;
      }
      if (/\.css$/i.test(path) && /@(plugin|config)\b/.test(file.content)) {
        buildInput = { file: path, detail: `${path} loads a build plugin or config from CSS.` };
        return buildInput;
      }
    }
    return null;
  };

  const referenceCache = new Map<string, ReturnType<typeof findComponentReferences>>();
  const componentReferences = (component: ComponentImport) => {
    const key = `${component.path}#${component.exportName}`;
    let found = referenceCache.get(key);
    if (!found) {
      found = findComponentReferences({
        modules: themeModules.map((path) => {
          const file = files.find((entry) => entry.path === path)!;
          return { path, ast: reader.ast(path, file.content) };
        }),
        resolve: (from, specifier) => {
          const resolved = resolveSpecifier(from, specifier);
          return resolved.kind === "module" ? resolved.target : null;
        },
        component,
      });
      referenceCache.set(key, found);
    }
    return found;
  };

  // The modules whose supported call sites the build guards
  // (`planHideGuards`): every route module but the root, and the layout.
  let layoutPath: string | null | undefined;
  const isGuardedModule = (path: string) => {
    if (layoutPath === undefined) {
      layoutPath = deriveThemeDocumentLayoutPath(files, reader);
    }
    return isHideGuardedModule(path, layoutPath);
  };

  type OtherModules =
    | Readonly<{ refusal: HideCapability }>
    | Readonly<{ sites: readonly HideGuardSite[] }>;

  /**
   * Every module but `path` that may read `slot` while it is hidden: a
   * refusal, or the guarded call sites they render it through. Another
   * module that renders the section is acceptable only where the build
   * compiles a guard into it and every read there sits inside that guard,
   * which reads the hidden state from the same content the slot comes from,
   * whichever document that is. Shared by the classifier and the
   * not-rendered proofs, so all of them mean the same thing by "reads it".
   */
  const otherModules = (path: string | null, slot: string): OtherModules => {
    if (themeProblem) {
      return {
        refusal: refuse(
          slot,
          themeProblem.reason,
          { file: themeProblem.file, line: themeProblem.line },
          themeProblem.detail,
        ),
      };
    }
    const sites: HideGuardSite[] = [];
    for (const other of themeModules) {
      if (other === path) continue;
      const otherUses = slotUses(other);
      if (otherUses.diagnostics.length > 0) {
        return {
          refusal: refuse(
            slot,
            "source-unconfirmed",
            { file: other, line: 0 },
            otherUses.diagnostics[0],
          ),
        };
      }
      const read = otherUses.uses.find((use) => use.slot === slot);
      if (read) {
        // Another module that renders the section as a call site of its own
        // is judged as one; a module that only reads it is a reader.
        if (
          isGuardedModule(other) &&
          routeAnalysis(other).instances.some(
            (instance) => instance.section === slot,
          )
        ) {
          const local = localClassify(other, slot, () => null);
          if (local.kind === "unsupported") return { refusal: local };
          sites.push(...local.sites);
          continue;
        }
        return {
          refusal: refuse(slot, "component-reads-content", {
            file: other,
            line: read.line,
          }),
        };
      }
      const otherEscape = otherUses.escapes.find(
        (candidate) =>
          (candidate.slot === slot || candidate.slot === null) &&
          (candidate.root !== "loader" || otherUses.loaderOrigin),
      );
      if (otherEscape) {
        return {
          refusal: refuse(slot, "component-reads-content", {
            file: other,
            line: otherEscape.line,
          }),
        };
      }
      const access = accessRefusal(other, slot);
      if (access) return { refusal: access };
    }
    return { sites };
  };

  /**
   * One module's own verdict for `slot`, as a call site. `others` runs where
   * the rest of the Theme is judged, so a reason found earlier in this
   * module is still named first.
   */
  const localClassify = (
    path: string,
    slot: string,
    others: () => HideCapability | null,
  ): HideCapability => {
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
    // The call site's own module may also read content some other way (a
    // second SDK import, a raw content helper, the route context).
    const own = accessRefusal(path, slot);
    if (own) return own;

    // A root handed whole to code Morph cannot follow may read this section
    // anywhere.
    const escape = uses.escapes.find(
      (candidate) =>
        (candidate.slot === slot || candidate.slot === null) &&
        (candidate.root !== "loader" || uses.loaderOrigin),
    );
    if (escape) return refuse(slot, "untraced-use", at(escape.line));

    // Every other module that can render with this section's content.
    const otherRefusal = others();
    if (otherRefusal) return otherRefusal;
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
        component: instance.componentPath
          ? {
              path: instance.componentPath,
              exportName: instance.componentExport ?? "default",
            }
          : null,
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

  // `scope` no longer narrows what is read: a route's section and the
  // layout's are both proven against the whole Theme (`themeModules`).
  const classify: HideCapabilityAnalyzer["classify"] = ({
    callSitePath,
    slot,
  }) => {
    if (callSitePath === null) return refuse(slot, "legacy-shell");
    // The platform files every guard relies on, before anything else: the
    // fail-closed Starter 32 content module, and the Starter root whose
    // snapshot the gate reads the hidden list from.
    if (!contentModule || !pageModuleConfirmed) {
      const legacy =
        contentModule !== undefined &&
        isKnownCode(
          LEGACY_STARTER_CONTENT_MODULE_SOURCES,
          contentModule.path,
          contentModule.content,
        );
      return refuse(
        slot,
        legacy ? "starter-upgrade-required" : "content-module-unconfirmed",
        { file: THEME_CONTENT_MODULE_PATH, line: 0 },
      );
    }
    if (!rootConfirmed) {
      return refuse(slot, "root-route-unconfirmed", {
        file: ROOT_ROUTE_PATH,
        line: 0,
      });
    }
    const path = normalizeThemeSourcePath(callSitePath);
    let elsewhere: readonly HideGuardSite[] = [];
    const local = localClassify(path, slot, () => {
      const verdict = otherModules(path, slot);
      if ("refusal" in verdict) return verdict.refusal;
      elsewhere = verdict.sites;
      return null;
    });
    const verdict =
      local.kind === "supported" && elsewhere.length > 0
        ? { ...local, sites: [...local.sites, ...elsewhere] }
        : local;
    if (verdict.kind !== "supported") return verdict;
    const build = buildInputProblem();
    if (build) {
      return refuse(slot, "custom-build", { file: build.file, line: 0 }, build.detail);
    }
    // The component a supported mount renders is rendered nowhere else
    // except as a section mount of its own.
    const components = new Map<string, ComponentImport>();
    for (const site of verdict.sites) {
      if (site.component) {
        components.set(`${site.component.path}#${site.component.exportName}`, site.component);
      }
    }
    for (const component of components.values()) {
      const stray = componentReferences(component).find(
        (reference) =>
          reference.elementStart === null ||
          !routeAnalysis(reference.file).instances.some(
            (instance) =>
              instance.start === reference.elementStart &&
              instance.section !== null,
          ),
      );
      if (stray) {
        return refuse(
          slot,
          "unguarded-mount",
          { file: stray.file, line: stray.line },
          stray.detail ??
            `${stray.file}:${stray.line} renders ${component.path} without a section's content.`,
        );
      }
    }
    return verdict;
  };

  const proveNotRendered: HideCapabilityAnalyzer["proveNotRendered"] = ({
    sourcePath,
    slot,
    scope,
  }) => {
    const path = normalizeThemeSourcePath(sourcePath);
    const b1 = routeAnalysis(path);
    const uses = slotUses(path);
    if (b1.diagnostics.length > 0 || uses.diagnostics.length > 0) {
      return refuse(
        slot,
        "source-unconfirmed",
        { file: path, line: 0 },
        b1.diagnostics[0] ?? uses.diagnostics[0],
      );
    }
    const own = accessRefusal(path, slot);
    if (own) return own;
    // The module reads the section after all, just not as a section its
    // JSX names: that is the classifier's question, with this call site.
    if (uses.uses.some((use) => use.slot === slot)) {
      return classify({ callSitePath: path, slot, scope });
    }
    const escape = uses.escapes.find(
      (candidate) =>
        (candidate.slot === slot || candidate.slot === null) &&
        (candidate.root !== "loader" || uses.loaderOrigin),
    );
    if (escape) {
      return refuse(
        slot,
        "untraced-use",
        { file: path, line: escape.line },
        `${path}: ${escape.reason}.`,
      );
    }
    const others = otherModules(path, slot);
    if ("refusal" in others) return others.refusal;
    if (
      b1.taints.includes("content:*") ||
      b1.taints.includes("page:*") ||
      (uses.loaderOrigin && b1.taints.includes("loader:*"))
    ) {
      return refuse(slot, "untraced-use", { file: path, line: 0 });
    }
    return renderedElsewhere(slot, others.sites);
  };

  /** Not rendered, unless guarded call sites elsewhere render it. */
  const renderedElsewhere = (
    slot: string,
    sites: readonly HideGuardSite[],
  ): HideNotRenderedProof =>
    sites.length > 0
      ? { kind: "supported", slot, sites }
      : { kind: "not-rendered", slot };

  const proveUnread: HideCapabilityAnalyzer["proveUnread"] = ({ slot }) => {
    const others = otherModules(null, slot);
    return "refusal" in others
      ? others.refusal
      : renderedElsewhere(slot, others.sites);
  };

  const sectionsIn: HideCapabilityAnalyzer["sectionsIn"] = (path) => [
    ...new Set(
      routeAnalysis(normalizeThemeSourcePath(path))
        .instances.map((instance) => instance.section)
        .filter((section): section is string => section !== null),
    ),
  ];

  return { classify, sectionsIn, proveNotRendered, proveUnread };
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
