import {
  parseThemeRouteSourcePath,
  themeRoutePathFromSourcePath,
} from "./theme-route-registry";
import { refuseThemeWorkspacePath } from "./theme-workspace-path";

/**
 * Turning a route path an author typed into the file that serves it.
 *
 * A Theme's routes are read from its files — nothing registers them, and no
 * generated artifact has to be written back — so creating a page is creating
 * one source file. That makes the whole question "is this path a file this
 * Theme can hold, and does it already hold one", which is what this answers
 * before anything is written.
 */
export type NewThemePagePlan =
  | Readonly<{
      ok: true;
      /** Where the file goes. */
      sourcePath: string;
      /** The address it will answer on, as the router will report it. */
      routePath: string;
      componentName: string;
      content: string;
    }>
  | Readonly<{ ok: false; reason: string }>;

function normalizeRequestedPath(requested: string): string | null {
  const collapsed = requested.trim().replace(/\/{2,}/g, "/");
  if (!collapsed) return null;
  const withLeading = collapsed.startsWith("/") ? collapsed : `/${collapsed}`;
  if (withLeading === "/") return "/";
  const withoutTrailing = withLeading.replace(/\/+$/, "");
  return withoutTrailing || "/";
}

/**
 * The file a route path is served from.
 *
 * Nested directories rather than the flat dotted spelling, because that is
 * the form an author reading their own source can predict from the address.
 */
function sourcePathForRoute(routePath: string): string {
  if (routePath === "/") return "src/routes/index.tsx";
  return `src/routes${routePath}.tsx`;
}

function componentNameForRoute(routePath: string): string {
  const words = routePath
    .split("/")
    .filter(Boolean)
    // `$slug` names a parameter; the `$` cannot survive into an identifier.
    .flatMap((segment) => segment.replace(/^\$/, "").split(/[^A-Za-z0-9]+/))
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`);
  const base = words.join("");
  // A leading digit is legal in a path and illegal in an identifier.
  const safe = /^[A-Za-z]/.test(base) ? base : `Page${base}`;
  return `${safe || "Index"}Route`;
}

/**
 * The page an author gets before they add anything to it.
 *
 * `<main></main>` rather than `<main />`: adding a section looks for the
 * closing tag to insert before, so a self-closing container would be a page
 * nothing could be added to.
 */
function pageSource(routeId: string, componentName: string): string {
  return `import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("${routeId}")({ component: ${componentName} });

function ${componentName}() {
  return (
    <main></main>
  );
}
`;
}

export function planNewThemePage(input: {
  requestedPath: string;
  existingPaths: readonly string[];
}): NewThemePagePlan {
  const routePath = normalizeRequestedPath(input.requestedPath);
  if (!routePath) {
    return { ok: false, reason: "Enter a path for the new page." };
  }

  const sourcePath = sourcePathForRoute(routePath);
  const refusal = refuseThemeWorkspacePath(sourcePath);
  if (refusal) {
    return {
      ok: false,
      reason: `"${routePath}" is not a path a Theme can own.`,
    };
  }

  const parsed = parseThemeRouteSourcePath(sourcePath);
  if (!parsed) {
    return {
      ok: false,
      reason: `"${routePath}" is not a route path this Theme can serve.`,
    };
  }
  if (parsed.invalidEscapeCharacter) {
    return {
      ok: false,
      reason: `"${routePath}" contains a character a route cannot escape.`,
    };
  }

  const existing = input.existingPaths.map((path) => path.replace(/\\/g, "/"));
  if (existing.includes(sourcePath)) {
    return { ok: false, reason: `${sourcePath} already exists.` };
  }
  // A route can be spelled more than one way — `blog/post.tsx` and
  // `blog.post.tsx` answer the same address — so the address is what is
  // checked for a collision, not the filename.
  const taken = existing.find(
    (path) => themeRoutePathFromSourcePath(path) === parsed.fullPath,
  );
  if (taken) {
    return { ok: false, reason: `${routePath} is already served by ${taken}.` };
  }

  const componentName = componentNameForRoute(routePath);
  return {
    ok: true,
    sourcePath,
    routePath: parsed.fullPath,
    componentName,
    content: pageSource(parsed.fullPath, componentName),
  };
}
