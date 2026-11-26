import { readThemeFileImportTargets } from "./ast/theme-file-move";
import {
  readThemePathAliases,
  resolveThemeBaseUrlImport,
  type ThemePathAliasConfig,
} from "./compiler/theme-path-aliases";
import { buildThemeRouteRegistry } from "./compiler/theme-route-registry";
import { starterThemeWorkspaceFiles } from "./starter-theme-files";
import type { ThemeFrameworkId } from "./theme-framework/theme-framework.types";

/**
 * Which pages may be served as static HTML: decided here, on the server,
 * and nowhere else.
 *
 * A page's `renderPolicy: ssg` is only a request an author (or any client)
 * can write into a Document. Static HTML is shared by every visitor, so it
 * may only be made from code known not to read price, stock, cart or
 * session (render policy decision 1). This first version knows exactly one
 * such page: the shipped Starter home. Its whole render closure, root layout,
 * shared header and footer, sections and loaders included, was read and
 * holds none of those reads; it fetches nothing but `/_morph/content`, which
 * a static build answers from the sealed snapshot.
 *
 * The proof is the bytes, not a flag: a page stays eligible only while every
 * file in its closure is the Starter's, byte for byte. Any edit in the
 * closure — a header that now reads the cart, a section that shows a price —
 * makes the page ineligible, and an SSG claim on it is refused. Authors can
 * always choose SSR for an eligible page.
 */
export type SsgPageAllowListEntry = Readonly<{
  framework: ThemeFrameworkId;
  routePath: string;
  routeFile: string;
}>;

export const SSG_PAGE_ALLOW_LIST: readonly SsgPageAllowListEntry[] = [
  {
    framework: "tanstack-start",
    routePath: "/",
    routeFile: "src/routes/index.tsx",
  },
];

/**
 * Files every TanStack Start page renders through, besides the route files:
 * the router the app is created with. Every file under `src/routes/` is a
 * root as well, see `ssgPageRenderClosure`.
 */
const START_RENDER_ROOTS = ["src/router.tsx"];

const ROUTES_DIRECTORY = "src/routes/";

/**
 * Workspace files that steer how the build resolves and compiles the
 * render closure rather than being part of it: package resolution, path
 * aliases and `baseUrl`, the route generator, and a Theme's own build or
 * Worker config. Each must be the Starter's, or absent where the Starter has
 * none; a `paths` entry could otherwise point `react` at a workspace file
 * the closure never checks.
 */
const BUILD_INPUT_FILES = [
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "tsr.config.json",
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.js",
  "vite.config.mjs",
  "wrangler.json",
  "wrangler.jsonc",
  "wrangler.toml",
];

export type SsgPageEligibility =
  | { eligible: true }
  | {
      eligible: false;
      code:
        | "SSG_PAGE_NOT_LISTED"
        | "SSG_PAGE_SOURCE_NOT_VERIFIED"
        | "SSG_OWN_BUILD_CONFIG";
      detail: string;
    };

type SourceFile = Readonly<{ path: string; content: string }>;

const SCRIPT_FILE = /\.(?:[cm]?[jt]sx?)$/;
const GENERATED_ROUTE_TREE = "./routeTree.gen";

let verifiedStarterSources: ReadonlyMap<string, string> | undefined;

function starterSources(): ReadonlyMap<string, string> {
  verifiedStarterSources ??= new Map(
    starterThemeWorkspaceFiles().map((file) => [file.path, file.content]),
  );
  return verifiedStarterSources;
}

/** Whether a bare specifier would resolve to a workspace file, not a package. */
function bareSpecifierIsAliased(
  specifier: string,
  files: ReadonlyMap<string, { path: string; content: string }>,
  aliases: ThemePathAliasConfig,
): boolean {
  if (
    aliases.aliases.some((alias) =>
      alias.wildcard
        ? specifier === alias.key || specifier.startsWith(`${alias.key}/`) ||
          (alias.key.endsWith("/") && specifier.startsWith(alias.key))
        : specifier === alias.key,
    )
  ) {
    return true;
  }
  return resolveThemeBaseUrlImport(specifier, files, aliases) !== null;
}

/**
 * The workspace files a page's prerender runs: its route, every other file
 * under `src/routes/` (the generated route tree imports every route module,
 * so each one's top level runs while any page is prerendered), the router,
 * and every file those reach through relative imports.
 *
 * Bare specifiers are the platform's pinned packages. One that a Theme path
 * alias or `baseUrl` would send to a workspace file is not, and cannot be
 * verified here; nor can a relative import that reaches no file. Either
 * makes the closure null, as does a file that does not parse.
 */
export function ssgPageRenderClosure(
  files: ReadonlyArray<SourceFile>,
  routeFile: string,
): string[] | null {
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const fileMap = new Map(files.map((file) => [file.path, file]));
  const paths = new Set(byPath.keys());
  const aliases = readThemePathAliases(files.map((file) => ({ ...file })));
  const closure: string[] = [];
  const seen = new Set<string>();
  const routeFiles = [...paths]
    .filter((path) => path.startsWith(ROUTES_DIRECTORY))
    .sort();
  const queue = [routeFile, ...routeFiles, ...START_RENDER_ROOTS];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    closure.push(path);
    const content = byPath.get(path);
    // A missing file stays in the closure, so the byte check refuses it.
    if (content === undefined) continue;
    if (!SCRIPT_FILE.test(path)) {
      // A stylesheet is checked by its bytes; one that pulls in another
      // workspace file would need that file checked too, which this reader
      // does not do, so it is not verifiable.
      if (/@import\s+(?:url\()?\s*["']\.{1,2}\//.test(content)) return null;
      continue;
    }
    const targets = readThemeFileImportTargets(path, content, paths);
    if (!targets) return null;
    for (const target of targets) {
      if (target.resolvedPath) {
        queue.push(target.resolvedPath);
        continue;
      }
      // The route tree is generated by the platform build from the route
      // files, which are all in the closure already.
      if (path === "src/router.tsx" && target.specifier === GENERATED_ROUTE_TREE)
        continue;
      // A relative import that reaches no workspace file cannot be verified.
      if (target.specifier.startsWith(".") || target.specifier.startsWith("/"))
        return null;
      if (bareSpecifierIsAliased(target.specifier, fileMap, aliases)) return null;
    }
  }
  return closure;
}

function notVerified(routePath: string, detail: string): SsgPageEligibility {
  return {
    eligible: false,
    code: "SSG_PAGE_SOURCE_NOT_VERIFIED",
    detail: `"${routePath}": ${detail}`,
  };
}

/**
 * Whether the build's immutable source may serve `routePath` as static
 * HTML. Every input is the server's own: the build's framework and mode, and
 * the files of its immutable source revision.
 *
 * The whole render input must be the Starter's: the build input files, the
 * exact set of route files (no companion, no added route), the route the
 * registry assigns to the page, and every file the prerender loads.
 */
export function resolveSsgPageEligibility(input: {
  framework: ThemeFrameworkId | undefined;
  buildMode?: "native";
  files: ReadonlyArray<SourceFile>;
  routePath: string;
}): SsgPageEligibility {
  const framework = input.framework ?? "tanstack-start";
  const entry = SSG_PAGE_ALLOW_LIST.find(
    (candidate) =>
      candidate.framework === framework &&
      candidate.routePath === input.routePath,
  );
  if (!entry) {
    return {
      eligible: false,
      code: "SSG_PAGE_NOT_LISTED",
      detail: `"${input.routePath}" is not a page the server allows as static HTML.`,
    };
  }
  // A Theme built with its own Vite config is a separate track (decision 6):
  // its build is not the platform's, so its output is not what was verified.
  if (input.buildMode === "native") {
    return {
      eligible: false,
      code: "SSG_OWN_BUILD_CONFIG",
      detail: "A Theme built with its own build configuration cannot serve static HTML yet.",
    };
  }
  const byPath = new Map(input.files.map((file) => [file.path, file.content]));
  const verified = starterSources();

  for (const path of BUILD_INPUT_FILES) {
    if (byPath.get(path) !== verified.get(path)) {
      return notVerified(
        input.routePath,
        `"${path}" is not the verified Starter's${verified.has(path) ? "" : " (the Starter has none)"}.`,
      );
    }
  }

  const routeFiles = (paths: Iterable<string>) =>
    [...paths].filter((path) => path.startsWith(ROUTES_DIRECTORY)).sort();
  const actualRoutes = routeFiles(byPath.keys());
  const starterRoutes = routeFiles(verified.keys());
  if (
    actualRoutes.length !== starterRoutes.length ||
    actualRoutes.some((path, index) => path !== starterRoutes[index])
  ) {
    return notVerified(
      input.routePath,
      "the route files are not exactly the verified Starter's.",
    );
  }

  const registry = buildThemeRouteRegistry(input.files);
  const route = registry.valid
    ? registry.routes.find(
        (candidate) =>
          candidate.kind === "route" && candidate.path === entry.routePath,
      )
    : undefined;
  if (
    !route ||
    route.sourcePath !== entry.routeFile ||
    Object.keys(route.routePieces ?? {}).length > 0
  ) {
    return notVerified(
      input.routePath,
      `the route registry does not answer it with "${entry.routeFile}" alone.`,
    );
  }

  const closure = ssgPageRenderClosure(input.files, entry.routeFile);
  if (!closure) {
    return notVerified(input.routePath, "the source it renders through cannot be read.");
  }
  for (const path of closure) {
    const expected = verified.get(path);
    if (expected === undefined || byPath.get(path) !== expected) {
      return notVerified(
        input.routePath,
        `"${path}", which it renders through, is not the verified Starter source.`,
      );
    }
  }
  return { eligible: true };
}
