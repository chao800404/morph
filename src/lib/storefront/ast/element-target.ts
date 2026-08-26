import type {
  ComponentElementMeta,
  ParsedComponentMeta,
} from "./theme-ast-transformer";

/**
 * How the editor addresses one JSX element in Theme source.
 *
 * Three places need this answer — the AST patch, the Inspector's lock check and
 * the live style preview — and they must agree. When they drifted apart, an
 * element could be selected but not styled, or styled without any live
 * feedback, with no error anywhere.
 */
export type ElementTargetSelection = Readonly<{
  nodeId?: string | null;
  elementKey?: string | null;
  /** `file:line:column` emitted by the preview for every rendered element. */
  sourceLocation?: string | null;
}>;

/** Last resort for legacy selections that carry no identity at all. */
export const DEFAULT_ELEMENT_TARGET_KEY = "heading";

/**
 * `line:column` portion of a full source location.
 *
 * The AST indexes elements by position within one file, while the DOM attribute
 * carries the file as well, so the two are not interchangeable.
 */
export function sourceLocationKey(
  sourceLocation: string | null | undefined,
): string | null {
  if (typeof sourceLocation !== "string") return null;
  const parts = sourceLocation.split(":");
  if (parts.length < 3) return null;
  const key = parts.slice(-2).join(":");
  return /^\d+:\d+$/.test(key) ? key : null;
}

/**
 * Key the AST patch resolves an element by.
 *
 * Authored markers win over a position: a position shifts whenever the file
 * above it is edited, so it can only ever be the fallback for elements the
 * author never marked.
 */
export function resolveElementTargetKey(
  selection: ElementTargetSelection | null | undefined,
): string {
  return (
    selection?.nodeId ||
    selection?.elementKey ||
    sourceLocationKey(selection?.sourceLocation) ||
    DEFAULT_ELEMENT_TARGET_KEY
  );
}

/**
 * Parsed element a target key refers to.
 *
 * Mirrors `resolveElementTargetKey`'s priority so the Inspector never enables a
 * control the patch cannot apply, and never disables one it could.
 */
export function resolveElementMeta(
  parsed: ParsedComponentMeta | null | undefined,
  targetKey: string,
): ComponentElementMeta | undefined {
  if (!parsed) return undefined;
  return parsed.nodeMap[targetKey] ?? parsed.elements[targetKey] ?? parsed.locationMap[targetKey];
}

/**
 * Whether a rendered DOM element is the one a target describes.
 *
 * Used by the live preview, which holds elements rather than parsed source. An
 * unmarked element carries none of the marker attributes, so its compiled
 * position is the only handle available.
 */
export function domElementMatchesTarget(
  element: {
    dataset: { morphNode?: string; morphElement?: string; morphLoc?: string };
  },
  targetKey: string,
  sourceLocation?: string | null,
): boolean {
  if (element.dataset.morphNode === targetKey) return true;
  if (element.dataset.morphElement === targetKey) return true;
  return Boolean(sourceLocation) && element.dataset.morphLoc === sourceLocation;
}
