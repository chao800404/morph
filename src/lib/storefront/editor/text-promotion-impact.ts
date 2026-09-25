import {
  readThemeFileImportTargets,
  resolveSpecifierToFile,
} from "../ast/theme-file-move";
import { listSectionTemplateSourcePaths } from "./page-section-copy";
import { parseSource, type AnyNode } from "./text-promotion";

/**
 * Everywhere besides this section instance that promoting text in a
 * component would reach.
 *
 * The source edit is render-safe for every other user — the new prop defaults
 * to the text they already show — but it still changes a component they
 * share: each of them gains a field, and the section library would hand it to
 * every section added later. So the author confirms this list before a shared
 * component is changed, and an empty list is the only thing that lets the
 * change through unconfirmed. What cannot be read is counted, never assumed
 * away.
 */

export type TextPromotionImpactInput = Readonly<{
  files: readonly Readonly<{ path: string; content: string }>[];
  componentSourcePath: string;
  /** The route or layout file rendering this instance. */
  callSitePath: string;
  templateId: string;
  slotId: string;
  /** Every stored document of the Theme. */
  documents: readonly Readonly<{
    templateId: string;
    label: string;
    sections: readonly Readonly<{ id: string; componentRef?: string | null }>[];
  }>[];
}>;

const SCRIPT = /\.(?:tsx|ts|jsx|js)$/;

/** How many elements a file renders from the bindings it imports the component as. */
function renderCount(content: string, importedAs: ReadonlySet<string>) {
  const ast = parseSource(content);
  if (!ast) return null;
  let count = 0;
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const current = node as AnyNode;
    if (
      current.type === "JSXOpeningElement" &&
      current.name?.type === "JSXIdentifier" &&
      importedAs.has(current.name.name)
    ) {
      count += 1;
    }
    for (const [key, value] of Object.entries(current)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      if (value && typeof value === "object") visit(value);
    }
  };
  visit(ast.program);
  return count;
}

/** Local names a file binds the component's module to. */
function importedNames(
  content: string,
  importerPath: string,
  componentSourcePath: string,
  paths: ReadonlySet<string>,
): Set<string> {
  const names = new Set<string>();
  const ast = parseSource(content);
  for (const statement of ast?.program.body ?? []) {
    if (statement?.type !== "ImportDeclaration") continue;
    if (
      resolveSpecifierToFile(importerPath, statement.source.value, paths) !==
      componentSourcePath
    ) {
      continue;
    }
    for (const specifier of statement.specifiers ?? []) {
      if (specifier.local?.name) names.add(specifier.local.name);
    }
  }
  return names;
}

export function textPromotionSharedImpact(
  input: TextPromotionImpactInput,
): string[] {
  const impact = new Set<string>();
  const paths = new Set(input.files.map((file) => file.path));

  if (
    listSectionTemplateSourcePaths(input.files).has(input.componentSourcePath)
  ) {
    impact.add(
      `Section library: every section added from ${input.componentSourcePath} from now on`,
    );
  }

  for (const file of input.files) {
    if (file.path === input.componentSourcePath || !SCRIPT.test(file.path)) {
      continue;
    }
    const targets = readThemeFileImportTargets(file.path, file.content, paths);
    if (targets === null) {
      impact.add(`${file.path} (could not be read)`);
      continue;
    }
    if (
      !targets.some(
        (target) => target.resolvedPath === input.componentSourcePath,
      )
    ) {
      continue;
    }
    if (file.path !== input.callSitePath) {
      impact.add(file.path);
      continue;
    }
    // The page rendering this instance may render the component again.
    const count = renderCount(
      file.content,
      importedNames(file.content, file.path, input.componentSourcePath, paths),
    );
    if (count === null || count !== 1) {
      impact.add(
        count === null
          ? `${file.path} (could not be read)`
          : `${file.path} (renders it ${count} times)`,
      );
    }
  }

  for (const document of input.documents) {
    for (const section of document.sections) {
      if (
        section.componentRef !== input.componentSourcePath ||
        (document.templateId === input.templateId &&
          section.id === input.slotId)
      ) {
        continue;
      }
      impact.add(`${document.label}: section "${section.id}"`);
    }
  }

  return [...impact].sort();
}

/** Whether what the author confirmed is exactly what the change would reach. */
export function confirmsTextPromotionImpact(
  impact: readonly string[],
  confirmed: readonly string[] | undefined,
): boolean {
  if (impact.length === 0) return true;
  if (!confirmed) return false;
  const expected = [...impact].sort();
  const given = [...new Set(confirmed)].sort();
  return (
    expected.length === given.length &&
    expected.every((item, index) => item === given[index])
  );
}
