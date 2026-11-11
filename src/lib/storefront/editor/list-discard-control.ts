/**
 * Whether a list a writer conflict holds has a discard control of its own in
 * the Content panel ("Discard unsaved changes to <label>" beside it).
 *
 * One answer for both sides (Task 41 R2-2): the Inspector draws the control
 * from it, and the shell names it in every message, or offers "Discard mine…"
 * for the section where it says there is none. Two copies of the rule were
 * how a message came to point at a control the panel never drew.
 */
import {
  deriveThemeDocumentLayoutPath,
  readSlotPropsSetInCode,
} from "../compiler/theme-route-sections";
import type { ThemeContentFieldDefinition } from "../theme-content-capabilities";

/**
 * Field keys the Content panel draws with dedicated controls rather than as
 * declared fields: never a list card of their own.
 */
export const SPECIALIZED_CONTENT_FIELD_KEYS: ReadonlySet<string> = new Set([
  "heading",
  "description",
  "body",
  "label",
  "eyebrow",
  "actionLabel",
  "actionHref",
  "imageSrc",
  "imageAlt",
  "image",
  "imagePosition",
]);

/** What the page's own code sets of a section's props (`readSlotPropsSetInCode`). */
export type SlotPropsSetInCode = ReadonlySet<string> | "any" | null;

/**
 * The section's props the route (or the document layout) sets in code, read
 * as the Content panel reads them: from the route's source and the layout.
 */
export function slotPropsSetInCode(
  themeFiles: ReadonlyArray<{ path: string; content?: string | null }>,
  routeSourcePath: string | null | undefined,
  sectionId: string,
): SlotPropsSetInCode {
  const layoutPath = deriveThemeDocumentLayoutPath(themeFiles);
  const paths = [routeSourcePath, layoutPath].filter(
    (path): path is string => typeof path === "string" && path.length > 0,
  );
  return paths.length > 0
    ? readSlotPropsSetInCode(themeFiles, paths, sectionId)
    : null;
}

/**
 * The label of a list's own discard control, or null where the Content panel
 * draws none for it: not stored in the Document (source mode), not declared
 * as a list, drawn by a dedicated control, or set by the page's code (the
 * "any" spread included).
 */
export function listOwnDiscardLabel(args: {
  contentStore: "document" | "source";
  fields: Readonly<Record<string, ThemeContentFieldDefinition>>;
  propsSetInCode: SlotPropsSetInCode;
  fieldPath: string;
}): string | null {
  const { contentStore, fields, propsSetInCode, fieldPath } = args;
  if (contentStore !== "document") return null;
  if (propsSetInCode === "any" || propsSetInCode?.has(fieldPath)) return null;
  if (SPECIALIZED_CONTENT_FIELD_KEYS.has(fieldPath)) return null;
  const definition = fields[fieldPath];
  if (definition?.type !== "array") return null;
  return definition.label ?? fieldPath.replace(/[-_]/g, " ");
}
