/**
 * Reading an array row out of a content field path.
 *
 * Its own module because the preview needs only this, and the array editing
 * it used to live beside pulls in the whole content-capability model — which
 * a Theme workspace has no business carrying just to know that `items.2` is a
 * row and `items.2.title` is a value inside one.
 */

/** Segments that would reach the prototype chain rather than a field. */
const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export type ArrayItemPath = Readonly<{ arrayPath: string; index: number }>;

/**
 * The row a path names, or `null` when it names something else.
 *
 * A path ends at its index to be a row. `items.2.title` names a value inside
 * one, which is not a thing that can be reordered.
 */
export function parseArrayItemFieldPath(
  fieldPath: string,
): ArrayItemPath | null {
  const segments = fieldPath.split(".");
  if (segments.length < 2 || segments.length > 50) return null;

  const indexSegment = segments.at(-1);
  const arraySegments = segments.slice(0, -1);
  if (
    !indexSegment ||
    !/^\d+$/.test(indexSegment) ||
    arraySegments.some(
      (segment) => !segment || UNSAFE_PATH_SEGMENTS.has(segment),
    )
  ) {
    return null;
  }

  const index = Number(indexSegment);
  if (!Number.isSafeInteger(index)) return null;
  return { arrayPath: arraySegments.join("."), index };
}
