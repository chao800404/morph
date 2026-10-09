import { isThemeAuthoringRefusedPath } from "@/lib/storefront/compiler/theme-start-toolchain";
import {
  parseThemeRouteSourcePath,
  themeRouteIdFromSourcePath,
  themeRoutePathFromSourcePath,
} from "@/lib/storefront/compiler/theme-route-registry";
import { contentFieldsSidecarPath } from "@/lib/storefront/ast/theme-content-fields-declaration";
import { THEME_CONTENT_MODULE_PATH } from "@/lib/storefront/theme-content-slots";
import { RESTORE_THEME_CONTENT_MODULE_COMMAND } from "@/lib/storefront/ast/theme-content-module";
import { safeThemeFilePathSchema } from "@/lib/validations/storefront-theme-file";
import {
  checkThemePublicPath,
  describeThemePublicProblem,
  isThemePublicPath,
  themePublicTextMimeType,
} from "../theme-public-files";

/**
 * Extensions a Theme author may create.
 *
 * The TypeScript-first create flow uses these formats. JSX and JavaScript are
 * also supported when copying an existing section, through the copy-specific
 * validator below.
 */
const CREATABLE_EXTENSIONS = [
  ".tsx",
  ".ts",
  ".css",
  ".json",
  ".jsonc",
] as const;
const COPYABLE_EXTENSIONS = [...CREATABLE_EXTENSIONS, ".jsx", ".js"] as const;

export type NewThemeFile = { path: string; content: string; mimeType: string };

/**
 * A create the author asked for. `companions` are files the same create
 * writes alongside `path` — a new component's `<Name>.fields.ts` — and must be
 * saved in the same batch, each refused if it already exists.
 */
export type NewThemeFileResult =
  | ({ ok: true; companions: readonly NewThemeFile[] } & NewThemeFile)
  | { ok: false; message: string };

export type CopiedThemeFileResult =
  { ok: true; path: string; mimeType: string } | { ok: false; message: string };

function extensionOf(path: string): string {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(index).toLowerCase();
}

export function themeFileMimeType(path: string): string {
  if (isThemePublicPath(path))
    return themePublicTextMimeType(path) ?? "text/plain";
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
    case ".jsonc":
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

function scaffoldContentFieldsDeclaration(): string {
  return `export const contentFields = {
  heading: { type: "text", label: "Heading" },
} as const;
`;
}

/**
 * Where a new component at `path` declares its fields: its sibling
 * `<Name>.fields.ts`, or `null` for routes, non-component files and components
 * the sidecar rule does not cover.
 */
function newComponentSidecarPath(path: string): string | null {
  if (isThemePublicPath(path) || extensionOf(path) !== ".tsx") return null;
  if (themeRoutePathFromSourcePath(path)) return null;
  return contentFieldsSidecarPath(path);
}

/**
 * Seed content for a newly created file.
 *
 * Files under `src/routes/` are scaffolded as TanStack file routes. Other TSX
 * files are scaffolded as standalone components. A component whose fields can
 * live in a sibling `<Name>.fields.ts` gets them there (see
 * `scaffoldThemeFileCompanions`), so it is editable in the Inspector
 * immediately and only one file declares them; any other component keeps the
 * declaration in its own source.
 */
export function scaffoldThemeFile(path: string): string {
  const extension = extensionOf(path);
  if (isThemePublicPath(path)) {
    if (extension === ".json" || extension === ".webmanifest") return "{}\n";
    if (extension === ".xml")
      return '<?xml version="1.0" encoding="UTF-8"?>\n<root />\n';
    return "";
  }
  if (extension === ".css") return "";
  if (extension === ".json" || extension === ".jsonc") return "{}\n";

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
  const declaration = newComponentSidecarPath(path)
    ? ""
    : `${scaffoldContentFieldsDeclaration()}\n`;
  // Live Preview injects source locations for selection, while content fields
  // are inferred from the component props. New Theme files therefore do not
  // need hand-written data-morph identity markers.
  return `${declaration}export type ${name}Props = {
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

/** Files created together with a new file at `path`: a component's sidecar. */
export function scaffoldThemeFileCompanions(path: string): NewThemeFile[] {
  const sidecarPath = newComponentSidecarPath(path);
  if (!sidecarPath) return [];
  return [
    {
      path: sidecarPath,
      content: scaffoldContentFieldsDeclaration(),
      mimeType: themeFileMimeType(sidecarPath),
    },
  ];
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
  if (isThemePublicPath(path)) {
    const check = checkThemePublicPath(path);
    if (!check.ok)
      return { ok: false, message: describeThemePublicProblem(check.reason) };
    if (!themePublicTextMimeType(path))
      return {
        ok: false,
        message: "Upload images and fonts instead of creating them as text.",
      };
  } else if (!allowedExtensions.includes(extension)) {
    return {
      ok: false,
      message: `Only ${allowedExtensions.join(", ")} files can be created.`,
    };
  }

  if (isThemeAuthoringRefusedPath(path)) {
    return {
      ok: false,
      message: `"${path}" is generated by the build and cannot be authored.`,
    };
  }

  // The author's file once it exists; this only runs while it does not. Morph
  // seeds it, so bringing it back is the explicit restore command, which
  // writes the Starter module rather than an empty one Design cannot use.
  if (path === THEME_CONTENT_MODULE_PATH) {
    return {
      ok: false,
      message: `"${path}" is the Starter content module. Restore it with "${RESTORE_THEME_CONTENT_MODULE_COMMAND}" from the Command Palette.`,
    };
  }

  if (existingPaths.some((existing) => existing.replace(/\\/g, "/") === path)) {
    return { ok: false, message: `"${path}" already exists.` };
  }

  return { ok: true, path, mimeType: themeFileMimeType(path) };
}

/** Validates a path for a new file without choosing its content. */
export function prepareNewThemeFilePath(
  rawPath: string,
  existingPaths: readonly string[],
): CopiedThemeFileResult {
  return validateThemeFilePath(rawPath, existingPaths, CREATABLE_EXTENSIONS);
}

/**
 * Validates and seeds a new file and the files created with it.
 *
 * A companion that already exists refuses the whole create: overwriting it
 * would replace the author's declaration, and keeping it would leave the new
 * component bound to fields it was not created with.
 */
export function prepareNewThemeFile(
  rawPath: string,
  existingPaths: readonly string[],
): NewThemeFileResult {
  const validated = prepareNewThemeFilePath(rawPath, existingPaths);
  if (!validated.ok) return validated;
  const companions = scaffoldThemeFileCompanions(validated.path);
  for (const companion of companions) {
    const checked = prepareNewThemeFilePath(companion.path, existingPaths);
    if (!checked.ok) {
      return {
        ok: false,
        message: `Cannot create ${validated.path}: ${checked.message}`,
      };
    }
  }
  return {
    ...validated,
    content: scaffoldThemeFile(validated.path),
    companions,
  };
}

/** Validates a copy destination while preserving the source's supported format. */
export function prepareCopiedThemeFile(
  rawPath: string,
  existingPaths: readonly string[],
): CopiedThemeFileResult {
  return validateThemeFilePath(rawPath, existingPaths, COPYABLE_EXTENSIONS);
}
