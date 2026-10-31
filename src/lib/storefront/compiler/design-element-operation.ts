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
export type DesignElementEdit =
  | Readonly<{ kind: "remove-element"; targetKey: string }>
  | Readonly<{ kind: "swap-siblings"; firstKey: string; secondKey: string }>;

/**
 * A Design element edit, or the undo of one (`undoDesignElementEdit`): the
 * file put back to the text the edit was made on.
 */
export type DesignElementOperation =
  DesignElementEdit | Readonly<{ kind: "undo"; edit: DesignElementEdit }>;

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
/**
 * The edit is judged on the stored file, so a file with changes not yet
 * saved (or still saving) would be judged on other content than the one
 * shown. Nothing is lost: the changes stay in the editor.
 */
export const DESIGN_ELEMENT_UNSAVED_MESSAGE =
  "This file has changes that are not saved yet. They are kept: save them first, then make this change again.";

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
  operation: DesignElementEdit,
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

export const DESIGN_ELEMENT_UNDO_NOT_APPLICABLE_MESSAGE =
  "This change can no longer be undone here: the file has changed since. Make it in Code mode.";

/**
 * The undo of `edit`: `stored`, the current content of `filePath`, put back
 * to `restored`, the text the edit was made on.
 *
 * An undo is not a plain save of older text. It is allowed only when it can
 * be shown to reverse exactly this edit, and to touch ordinary elements only
 * as the files stand now:
 *
 * - the current file can be analysed (anything the analysis cannot read is
 *   refused, as an edit would be);
 * - `edit`, applied to `restored`, gives exactly `stored` — so `restored` is
 *   the text the edit was made on, and the undo changes nothing else;
 * - that edit is judged on `restored` against the sections the files render
 *   now. An element the undo would bring back may since have come to hold a
 *   section call site (another file changed): then the undo would add a
 *   section, and it is refused like any edit that touches one.
 *
 * Anything that cannot be shown is refused; nothing is guessed.
 */
export function undoDesignElementEdit(
  files: readonly ThemeSourceFile[],
  filePath: string,
  stored: string,
  restored: string,
  edit: DesignElementEdit,
): DesignElementOperationResult {
  const current = sectionEffectOfElementEdit(
    files.map((file) =>
      file.path === filePath ? { ...file, content: stored } : file,
    ),
    filePath,
    [],
  );
  if (current.kind === "unknown") {
    return {
      status: "refused",
      error: "DESIGN_ELEMENT_EFFECT_UNKNOWN",
      message: DESIGN_ELEMENT_UNKNOWN_MESSAGE,
    };
  }
  const forward = applyDesignElementOperation(files, filePath, restored, edit);
  if (
    forward.status === "refused" &&
    forward.error !== "DESIGN_ELEMENT_NOT_APPLICABLE"
  ) {
    return forward;
  }
  if (forward.status !== "ok" || forward.code !== stored) {
    return {
      status: "refused",
      error: "DESIGN_ELEMENT_NOT_APPLICABLE",
      message: DESIGN_ELEMENT_UNDO_NOT_APPLICABLE_MESSAGE,
    };
  }
  return { status: "ok", code: restored };
}

/**
 * `operation` on `filePath`, whose stored content is `stored`: the edit
 * recomputed, or its undo checked against the `sent` text it restores.
 */
export function resolveDesignElementOperation(
  files: readonly ThemeSourceFile[],
  filePath: string,
  stored: string,
  sent: string,
  operation: DesignElementOperation,
): DesignElementOperationResult {
  return operation.kind === "undo"
    ? undoDesignElementEdit(files, filePath, stored, sent, operation.edit)
    : applyDesignElementOperation(files, filePath, stored, operation);
}
