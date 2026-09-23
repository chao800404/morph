import { isPlatformOwnedThemeBuildPath } from "@/lib/storefront/compiler/theme-start-toolchain";
import {
  parseThemeRouteSourcePath,
  themeRouteIdFromSourcePath,
  themeRoutePathFromSourcePath,
} from "@/lib/storefront/compiler/theme-route-registry";
import { THEME_CONTENT_MODULE_PATH } from "@/lib/storefront/theme-content-slots";
import { safeThemeFilePathSchema } from "@/lib/validations/storefront-theme-file";

/**
 * Extensions a Theme author may create.
 *
 * The TypeScript-first create flow uses these formats. JSX and JavaScript are
 * also supported when copying an existing section, through the copy-specific
 * validator below.
 */
const CREATABLE_EXTENSIONS = [".tsx", ".ts", ".css", ".json"] as const;
const COPYABLE_EXTENSIONS = [...CREATABLE_EXTENSIONS, ".jsx", ".js"] as const;

export type NewThemeFileResult =
  | { ok: true; path: string; content: string; mimeType: string }
  | { ok: false; message: string };

export type CopiedThemeFileResult =
  { ok: true; path: string; mimeType: string } | { ok: false; message: string };

function extensionOf(path: string): string {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(index).toLowerCase();
}

export function themeFileMimeType(path: string): string {
  switch (extensionOf(path)) {
    case ".tsx":
    case ".ts":
      return "text/typescript";
    case ".jsx":
    case ".js":
      return "text/javascript";
    case ".css":
      return "text/css";
    case ".json":
      return "application/json";
    default:
      return "text/plain";
  }
}

function componentNameFrom(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  const cleaned = base.replace(/[^a-zA-Z0-9]/g, " ").trim();
  const pascal = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
  return /^[A-Za-z]/.test(pascal) ? pascal : `Component${pascal}`;
}

function routeComponentNameFrom(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  if (base === "__root") return "RootRoute";
  if (base === "index") return "HomeRoute";
  return `${componentNameFrom(path)}Route`;
}

function routeLabelFromPath(routePath: string): string {
  const label = routePath
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.replace(/^\$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!label) return "Home";
  return label.replace(/\b\w/g, (character) => character.toUpperCase());
}

function scaffoldThemeRouteFile(
  path: string,
  routePath: string,
  routeId: string,
  routeType: string,
): string {
  if (routePath === "/" && path.endsWith("/__root.tsx")) {
    return `import { Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: RootRoute,
});

function RootRoute() {
  return <Outlet />;
}
`;
  }

  const componentName = routeComponentNameFrom(path);
  const label = routeLabelFromPath(routePath);
  const factory =
    routeType === "lazy" ? "createLazyFileRoute" : "createFileRoute";
  if (path.endsWith(".ts") && !path.endsWith(".tsx")) {
    return `import { ${factory} } from "@tanstack/react-router";

export const Route = ${factory}(${JSON.stringify(routeId)})({});
`;
  }
  return `import { ${factory} } from "@tanstack/react-router";

export const Route = ${factory}(${JSON.stringify(routeId)})({
  component: ${componentName},
});

function ${componentName}() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-semibold">${label}</h1>
    </main>
  );
}
`;
}

/**
 * Seed content for a newly created file.
 *
 * Files under `src/routes/` are scaffolded as TanStack file routes. Other TSX
 * files are scaffolded as standalone components with their own `contentFields`
 * declaration so they are editable in the Inspector immediately, without
 * registering them anywhere.
 */
export function scaffoldThemeFile(path: string): string {
  const extension = extensionOf(path);
  if (extension === ".css") return "";
  if (extension === ".json") return "{}\n";

  const routePath = themeRoutePathFromSourcePath(path);
  const routeMetadata = parseThemeRouteSourcePath(path);
  const routeId = themeRouteIdFromSourcePath(path);
  if (routePath && routeMetadata && routeId) {
    return scaffoldThemeRouteFile(
      path,
      routePath,
      routeId,
      routeMetadata.routeType,
    );
  }
  if (extension === ".ts") return "export {};\n";

  const name = componentNameFrom(path);
  // Live Preview injects source locations for selection, while content fields
  // are inferred from the component props. New Theme files therefore do not
  // need hand-written data-morph identity markers.
  return `export const contentFields = {
  heading: { type: "text", label: "Heading" },
} as const;

export type ${name}Props = {
  heading?: string;
};

export default function ${name}({ heading = "${name}" }: ${name}Props) {
  return (
    <section className="px-6 py-16">
      <h2 className="text-2xl font-semibold">
        {heading}
      </h2>
    </section>
  );
}
`;
}

/**
 * Validates a path the author typed before anything is written.
 *
 * Refuses the same shapes the storage boundary refuses, plus platform-owned
 * build files and paths that already exist, so a create can never overwrite
 * existing work or shadow a generated file.
 */
function validateThemeFilePath(
  rawPath: string,
  existingPaths: readonly string[],
  allowedExtensions: readonly string[],
): CopiedThemeFileResult {
  const normalized = (rawPath ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!normalized) {
    return { ok: false, message: "Enter a file path." };
  }

  const parsed = safeThemeFilePathSchema.safeParse(normalized);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid file path.",
    };
  }
  const path = parsed.data;

  if (path.endsWith("/")) {
    return { ok: false, message: "Enter a file path, not a folder." };
  }

  const extension = extensionOf(path);
  if (!allowedExtensions.includes(extension)) {
    return {
      ok: false,
      message: `Only ${allowedExtensions.join(", ")} files can be created.`,
    };
  }

  if (isPlatformOwnedThemeBuildPath(path)) {
    return {
      ok: false,
      message: `"${path}" is generated by the build and cannot be authored.`,
    };
  }

  // Seeded and upgraded by the platform. Unlike build-generated files it does
  // reach the build, so it is refused here rather than at the build boundary.
  if (path === THEME_CONTENT_MODULE_PATH) {
    return {
      ok: false,
      message: `"${path}" is provided by Morph and cannot be replaced.`,
    };
  }

  if (existingPaths.some((existing) => existing.replace(/\\/g, "/") === path)) {
    return { ok: false, message: `"${path}" already exists.` };
  }

  return { ok: true, path, mimeType: themeFileMimeType(path) };
}

export function prepareNewThemeFile(
  rawPath: string,
  existingPaths: readonly string[],
): NewThemeFileResult {
  const validated = validateThemeFilePath(
    rawPath,
    existingPaths,
    CREATABLE_EXTENSIONS,
  );
  return validated.ok
    ? { ...validated, content: scaffoldThemeFile(validated.path) }
    : validated;
}

/** Validates a copy destination while preserving the source's supported format. */
export function prepareCopiedThemeFile(
  rawPath: string,
  existingPaths: readonly string[],
): CopiedThemeFileResult {
  return validateThemeFilePath(rawPath, existingPaths, COPYABLE_EXTENSIONS);
}
