import {
  isBinaryThemeFile,
  type StorefrontThemeFileDTO,
} from "@/lib/storefront/dto/storefront-theme-file.dto";
import { parseThemeSourceLocation } from "@/lib/storefront/compiler/theme-source-location-plugin";
import { PREVIEW_SOURCE_SECTION_PREFIX } from "@/lib/storefront/editor/preview-dom";
import { astroPreviewSourceHash } from "@/lib/storefront/theme-framework/astro-preview-locate";
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
/**
 * L1.5a (docs/astro-theme-plan.md 3.6.2.2): a source-located selection
 * from an Astro Live Preview opens exactly where the preview said, or nowhere.
 *
 * The location is a hint from the preview, so it is checked against the file
 * the editor holds before it is used: a text source file of this Theme, the
 * same version the preview transformed, a line and column inside it, and the
 * selected tag beginning there. Columns are UTF-16 code units from 1, the
 * unit both the preview's parser and the editor's document use.
 */
export function resolveSourceLocatedTarget(input: {
  selection: EditorSelectionDescriptor;
  themeFiles: readonly StorefrontThemeFileDTO[];
}): CodeSelectionTarget | null {
  const { selection, themeFiles } = input;
  const located = parseThemeSourceLocation(selection.sourceLocation);
  if (!located) return null;
  const file = themeFiles.find((entry) => entry.path === located.filePath);
  if (!file || isBinaryThemeFile(file)) return null;
  if (!/\.(astro|[jt]sx?)$/.test(file.path)) return null;
  if (selection.sourceVersion) {
    if (astroPreviewSourceHash(file.content) !== selection.sourceVersion) {
      return null;
    }
  } else if (file.path.endsWith(".astro")) {
    // The preview always records the version of an `.astro` location.
    return null;
  }
  const lineText = file.content.split("\n")[located.line - 1];
  if (lineText === undefined || located.column > lineText.length) return null;
  const tagName = selection.tagName?.toLowerCase();
  if (
    tagName &&
    !lineText
      .slice(located.column - 1)
      .toLowerCase()
      .startsWith(`<${tagName}`)
  ) {
    return null;
  }
  return { filePath: file.path, line: located.line, column: located.column };
}

export function resolveCodeSelectionTarget(input: {
  section: SectionSourceDescriptor | null;
  selection: EditorSelectionDescriptor | null;
  themeFiles: StorefrontThemeFileDTO[];
}): CodeSelectionTarget | null {
  const { section, selection, themeFiles } = input;
  if (selection?.sectionId.startsWith(PREVIEW_SOURCE_SECTION_PREFIX)) {
    return resolveSourceLocatedTarget({ selection, themeFiles });
  }
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
