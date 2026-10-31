import {
  removeJsxElement,
  swapSiblingMorphNodes,
} from "@/lib/storefront/ast/theme-ast-transformer";
import { sectionEffectOfElementEdit } from "./theme-route-sections";

/**
 * One of Design's ordinary element edits, named by what it does rather than
 * by the file it produces.
 *
 * The editor computes the rewrite and shows it; the server recomputes it from
 * the stored file and saves only that (see `saveStorefrontThemeFile`,
 * operation "design-element"). The same function answers both, so the two
 * cannot disagree about what an edit touches.
 */
export type DesignElementOperation =
  | Readonly<{ kind: "remove-element"; targetKey: string }>
  | Readonly<{ kind: "swap-siblings"; firstKey: string; secondKey: string }>;

export type DesignElementOperationRefusal =
  | "DESIGN_ELEMENT_NOT_APPLICABLE"
  | "DESIGN_ELEMENT_TOUCHES_SECTIONS"
  | "DESIGN_ELEMENT_EFFECT_UNKNOWN";

export type DesignElementOperationResult =
  | Readonly<{ status: "ok"; code: string }>
  | Readonly<{ status: "unchanged" }>
  | Readonly<{
      status: "refused";
      error: DesignElementOperationRefusal;
      message: string;
      /** The transformer's own reason, for an edit it could not apply. */
      reason?: string;
    }>;

export const DESIGN_ELEMENT_SECTIONS_MESSAGE =
  "Sections are managed from the page structure tree.";
export const DESIGN_ELEMENT_UNKNOWN_MESSAGE =
  "Design cannot tell whether this change affects the page's sections. Make it in Code mode.";

type ThemeSourceFile = Readonly<{ path: string; content?: string | null }>;

/**
 * Applies `operation` to `source`, the content of `filePath`, and judges it
 * against the sections that file renders in `files`.
 *
 * Refused when it would delete or move a section call site, or an element
 * that contains one, and when the analysis cannot tell. An edit of ordinary
 * elements only is applied, whether or not the route's structure is locked.
 */
export function applyDesignElementOperation(
  files: readonly ThemeSourceFile[],
  filePath: string,
  source: string,
  operation: DesignElementOperation,
): DesignElementOperationResult {
  const result =
    operation.kind === "remove-element"
      ? removeJsxElement(source, operation.targetKey)
      : swapSiblingMorphNodes(source, operation.firstKey, operation.secondKey);
  if (!result.editable) {
    if (result.reason === "same-node") return { status: "unchanged" };
    return {
      status: "refused",
      error: "DESIGN_ELEMENT_NOT_APPLICABLE",
      message: `This element cannot be ${operation.kind === "remove-element" ? "removed" : "moved"} here.`,
      reason: result.reason,
    };
  }
  const effect = sectionEffectOfElementEdit(
    files.map((file) =>
      file.path === filePath ? { ...file, content: source } : file,
    ),
    filePath,
    result.spans ?? [],
  );
  if (effect.kind === "sections") {
    return {
      status: "refused",
      error: "DESIGN_ELEMENT_TOUCHES_SECTIONS",
      message: DESIGN_ELEMENT_SECTIONS_MESSAGE,
    };
  }
  if (effect.kind === "unknown" || !result.spans?.length) {
    return {
      status: "refused",
      error: "DESIGN_ELEMENT_EFFECT_UNKNOWN",
      message: DESIGN_ELEMENT_UNKNOWN_MESSAGE,
    };
  }
  return { status: "ok", code: result.code };
}
