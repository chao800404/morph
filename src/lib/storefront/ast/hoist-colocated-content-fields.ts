import { parse } from "@babel/parser";
import { COLOCATED_CONTENT_FIELDS_EXPORT } from "./theme-content-fields-source";

/**
 * Removes the `contentFields` export from a component module for the Live
 * Preview dev server, without moving a single byte of the file.
 *
 * React Fast Refresh only treats a module as a boundary when everything it
 * exports is a component. A co-located `contentFields` is a plain object, so
 * every component that declares its fields — which is every component worth
 * editing — falls out of Fast Refresh and its edits become a full page
 * reload. Measured on the starter theme: opening a `useState` menu and then
 * changing one line closes the menu again, which is exactly the interactivity
 * the real-React preview exists to provide.
 *
 * Dropping the export is safe because `contentFields` has no runtime role at
 * all. The editor reads it by parsing the source, and only accepts a static
 * object literal, so nothing the preview runs can depend on its value. The
 * binding stays, so any reference inside the same module still resolves.
 *
 * Applied to the preview dev server only. A build keeps the export, so the
 * Theme's own source, the Build Preview and production are unchanged.
 */

/** What one module declares, and where its `export` keyword sits. */
type ExportKeywordSpan = Readonly<{ start: number; end: number }>;

export type ContentFieldsHoistSkip = Readonly<{
  path: string;
  reason: string;
}>;

export type ContentFieldsHoistResult = Readonly<{
  files: ReadonlyArray<{ path: string; content: string }>;
  /** Modules whose export was removed, so Fast Refresh can hold them. */
  hoisted: readonly string[];
  /** Modules deliberately left alone, and why. */
  skipped: readonly ContentFieldsHoistSkip[];
}>;

type ThemeFile = Readonly<{ path: string; content: string }>;

const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs"];

function parseModule(source: string) {
  return parse(source, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
}

/**
 * Resolves a relative specifier against the file that wrote it, using only the
 * paths present in the Theme. Import resolution inside the container is Vite's
 * job; here the question is narrower — which of these files did the author
 * mean — so extension and index lookup are enough.
 */
function resolveRelative(
  fromPath: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith(".")) return null;
  const segments = fromPath.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  const base = segments.join("/");
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => known.has(candidate)) ?? null;
}

/**
 * Locates the `export` keyword in front of a `contentFields` declaration.
 *
 * Returns `null` when the module declares nothing, and throws nothing: a file
 * this cannot read confidently is left exactly as the author wrote it.
 */
function findExportKeyword(
  source: string,
): ExportKeywordSpan | "unsupported" | null {
  let ast: any;
  try {
    ast = parseModule(source);
  } catch {
    // Unparseable source is the editor's problem to report, not this pass's
    // to guess at. Leaving it untouched keeps the error the author sees the
    // one their own file produces.
    return "unsupported";
  }

  for (const node of ast.program.body) {
    if (node.type !== "ExportNamedDeclaration") continue;

    const declaration = node.declaration;
    if (declaration?.type === "VariableDeclaration") {
      const declaresFields = declaration.declarations.some(
        (entry: any) =>
          entry.id?.type === "Identifier" &&
          entry.id.name === COLOCATED_CONTENT_FIELDS_EXPORT,
      );
      if (!declaresFields) continue;
      if (declaration.declarations.length > 1) {
        // `export const contentFields = {}, other = 1` would lose `other` too.
        return "unsupported";
      }
      return { start: node.start, end: declaration.start };
    }

    const specifiers = node.specifiers ?? [];
    const exportsFields = specifiers.some(
      (specifier: any) =>
        specifier.exported?.name === COLOCATED_CONTENT_FIELDS_EXPORT,
    );
    if (!exportsFields) continue;
    if (specifiers.length > 1 || node.source) {
      // A shared export list, or a re-export from elsewhere. Rewriting either
      // would change what the module exports beyond this one name.
      return "unsupported";
    }
    return { start: node.start, end: node.end };
  }

  return null;
}

/** Every module that imports `contentFields` from another module here. */
function collectCrossModuleConsumers(
  files: readonly ThemeFile[],
): ReadonlySet<string> {
  const known = new Set(files.map((file) => file.path));
  const consumed = new Set<string>();

  for (const file of files) {
    if (!file.content.includes(COLOCATED_CONTENT_FIELDS_EXPORT)) continue;
    let ast: any;
    try {
      ast = parseModule(file.content);
    } catch {
      continue;
    }
    for (const node of ast.program.body) {
      const isImport = node.type === "ImportDeclaration";
      const isReExport =
        node.type === "ExportNamedDeclaration" && Boolean(node.source);
      if (!isImport && !isReExport) continue;

      const wantsFields = (node.specifiers ?? []).some((specifier: any) =>
        isImport
          ? specifier.imported?.name === COLOCATED_CONTENT_FIELDS_EXPORT
          : specifier.local?.name === COLOCATED_CONTENT_FIELDS_EXPORT,
      );
      if (!wantsFields) continue;

      const target = resolveRelative(file.path, node.source.value, known);
      if (target) consumed.add(target);
    }
  }

  return consumed;
}

/**
 * Blanks a span rather than cutting it.
 *
 * Every JSX element's editor identity is its authored source position, so a
 * transform that shifted offsets would silently point the editor at the wrong
 * node. Replacing the keyword with spaces keeps every line, column and byte
 * offset in the file identical to the source the author saved.
 */
function blank(source: string, span: ExportKeywordSpan): string {
  return (
    source.slice(0, span.start) +
    " ".repeat(span.end - span.start) +
    source.slice(span.end)
  );
}

export function hoistColocatedContentFieldsForPreview(
  files: readonly ThemeFile[],
): ContentFieldsHoistResult {
  const consumed = collectCrossModuleConsumers(files);
  const hoisted: string[] = [];
  const skipped: ContentFieldsHoistSkip[] = [];

  const transformed = files.map((file) => {
    if (!file.content.includes(COLOCATED_CONTENT_FIELDS_EXPORT)) return file;

    const span = findExportKeyword(file.content);
    if (span === null) return file;
    if (span === "unsupported") {
      skipped.push({
        path: file.path,
        reason:
          "The declaration is not a lone `contentFields` export, so removing it would change what else the module exports.",
      });
      return file;
    }
    if (consumed.has(file.path)) {
      // Another module imports this declaration. Fast Refresh matters less
      // than that module continuing to resolve.
      skipped.push({
        path: file.path,
        reason: `Another module imports "${COLOCATED_CONTENT_FIELDS_EXPORT}" from it.`,
      });
      return file;
    }

    hoisted.push(file.path);
    return { path: file.path, content: blank(file.content, span) };
  });

  return { files: transformed, hoisted, skipped };
}
