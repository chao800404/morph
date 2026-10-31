/**
 * The `line:column` part of an authored source position.
 *
 * Its own module because it is needed both by the AST patcher, which resolves
 * an element to edit, and by the preview, which decides whether a position
 * names one element well enough to reorder through. Reaching it through the
 * patcher would have dragged that module's AST types into a Theme workspace,
 * for eight lines that depend on nothing.
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
