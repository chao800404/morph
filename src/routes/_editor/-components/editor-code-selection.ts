import type { StorefrontThemeFileDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import type { EditorSelectionDescriptor } from "@/lib/storefront/editor/selection-taxonomy";
import {
  getComponentFilePath,
  parseComponentSource,
  type ComponentElementMeta,
  type ParsedComponentMeta,
} from "@/lib/storefront/ast/theme-ast-transformer";
type SectionSourceDescriptor = {
  id?: string;
  type: string;
  componentRef?: string | null;
};

export type CodeSelectionTarget = {
  filePath: string;
  line?: number;
  column?: number;
};

function resolveElementMeta(
  parsed: ParsedComponentMeta,
  selection: EditorSelectionDescriptor | null,
): ComponentElementMeta | undefined {
  if (!selection) {
    return parsed.elements.section ?? parsed.elements.root;
  }

  return (
    (selection.nodeId ? parsed.nodeMap[selection.nodeId] : undefined) ??
    (selection.isSection
      ? (parsed.elements.section ?? parsed.elements.root)
      : undefined) ??
    (selection.elementKey
      ? parsed.elements[selection.elementKey]
      : undefined) ??
    (selection.fieldKey ? parsed.elements[selection.fieldKey] : undefined)
  );
}

function targetForFile(
  file: Pick<StorefrontThemeFileDTO, "path" | "content">,
  selection: EditorSelectionDescriptor | null,
): CodeSelectionTarget {
  const parsed = parseComponentSource(file.content, file.path);
  const meta = resolveElementMeta(parsed, selection);
  return {
    filePath: file.path,
    line: meta?.location.line,
    column: meta?.location.column,
  };
}

/**
 * Resolve the Code workspace destination from the live-preview selection.
 * Explicit source provenance wins. Without it, a stable node id may identify
 * one child component file; ambiguous matches safely fall back to the section.
 */
export function resolveCodeSelectionTarget(input: {
  section: SectionSourceDescriptor | null;
  selection: EditorSelectionDescriptor | null;
  themeFiles: StorefrontThemeFileDTO[];
}): CodeSelectionTarget | null {
  const { section, selection, themeFiles } = input;
  const sectionPath = section
    ? getComponentFilePath(
        section.type,
        themeFiles,
        section.componentRef ?? undefined,
      )
    : null;
  const sectionFile = sectionPath
    ? themeFiles.find((file) => file.path === sectionPath)
    : undefined;

  const explicitSourceFile = selection?.sourceFilePath
    ? themeFiles.find((file) => file.path === selection.sourceFilePath)
    : undefined;

  if (explicitSourceFile) {
    return targetForFile(explicitSourceFile, selection);
  }

  if (selection?.nodeId && !selection.isSection) {
    const nodeMatches = themeFiles
      .filter(
        (file) =>
          file.path !== sectionPath &&
          /\.[jt]sx?$/.test(file.path) &&
          Boolean(
            parseComponentSource(file.content, file.path).nodeMap[
              selection.nodeId!
            ],
          ),
      )
      .map((file) => targetForFile(file, selection));

    if (nodeMatches.length === 1) return nodeMatches[0];
  }

  return sectionFile ? targetForFile(sectionFile, selection) : null;
}
