/**
 * Attribute carrying a JSX element's authored source position.
 *
 * Emitted by the Live preview interpreter so the editor can identify any
 * element without the Theme author hand-writing identity markers. Source
 * positions are unique by construction, which also removes the "duplicate id"
 * class of authoring error.
 *
 * Deliberately absent from build output. Build Preview shows an immutable
 * artifact and is not editable — its iframe carries no editor channel — so
 * annotating it would add bytes and put Theme source paths into a stored
 * artifact with nothing to consume them.
 */
export const MORPH_SOURCE_LOCATION_ATTRIBUTE = "data-morph-loc";

export type ThemeSourceLocation = Readonly<{
  filePath: string;
  line: number;
  column: number;
}>;

/**
 * Parses an injected location value.
 *
 * Returns `null` for anything malformed so a tampered or truncated attribute
 * can never be turned into a source edit target.
 */
export function parseThemeSourceLocation(
  value: string | null | undefined,
): ThemeSourceLocation | null {
  if (typeof value !== "string" || value.length > 400) return null;
  const lastColon = value.lastIndexOf(":");
  if (lastColon <= 0) return null;
  const secondLastColon = value.lastIndexOf(":", lastColon - 1);
  if (secondLastColon <= 0) return null;

  const filePath = value.slice(0, secondLastColon);
  const line = Number(value.slice(secondLastColon + 1, lastColon));
  const column = Number(value.slice(lastColon + 1));

  if (!filePath.startsWith("src/")) return null;
  if (filePath.includes("..") || filePath.includes("\\")) return null;
  if (!Number.isInteger(line) || line < 1) return null;
  if (!Number.isInteger(column) || column < 1) return null;

  return { filePath, line, column };
}
