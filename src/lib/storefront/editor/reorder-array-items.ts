import { getFieldPathValue, setFieldPathValue } from "./selection-taxonomy";

type ArrayItemPath = {
  arrayPath: string;
  index: number;
};

const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

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

export type SwapArrayItemsResult<T> =
  | { editable: true; value: T }
  | {
      editable: false;
      value: T;
      reason: "invalid-path" | "different-arrays" | "index-out-of-range";
    };

export function swapArrayItemsAtFieldPaths<T>(
  value: T,
  draggedFieldPath: string,
  targetFieldPath: string,
): SwapArrayItemsResult<T> {
  const dragged = parseArrayItemFieldPath(draggedFieldPath);
  const target = parseArrayItemFieldPath(targetFieldPath);
  if (!dragged || !target) {
    return { editable: false, value, reason: "invalid-path" };
  }
  if (dragged.arrayPath !== target.arrayPath) {
    return { editable: false, value, reason: "different-arrays" };
  }
  if (dragged.index === target.index) {
    return { editable: false, value, reason: "invalid-path" };
  }

  const currentArray = getFieldPathValue(value, dragged.arrayPath);
  if (
    !Array.isArray(currentArray) ||
    dragged.index >= currentArray.length ||
    target.index >= currentArray.length
  ) {
    return { editable: false, value, reason: "index-out-of-range" };
  }

  const nextArray = [...currentArray];
  [nextArray[dragged.index], nextArray[target.index]] = [
    nextArray[target.index],
    nextArray[dragged.index],
  ];
  return {
    editable: true,
    value: setFieldPathValue(value, dragged.arrayPath, nextArray),
  };
}
