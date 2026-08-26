import {
  arrayRowFields,
  MAX_ARRAY_CONTENT_FIELD_ROWS,
  type ThemeArrayContentFieldDefinition,
  type ThemeContentFieldDefinition,
} from "../theme-content-capabilities";
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

/**
 * Stable identity for a repeated row.
 *
 * Instance styles and source ordering are both keyed by it, so a row created
 * without one would lose its styling the moment the list is reordered. Shared
 * rather than generated at each call site for exactly that reason.
 */
export function createMorphItemId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return "morph-" + uuid;
  return (
    "morph-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

/** Value a newly created row starts each declared field at. */
function emptyRowValue(definition: ThemeContentFieldDefinition): unknown {
  switch (definition.type) {
    case "number":
      return definition.min ?? 0;
    case "boolean":
      return false;
    case "select":
      // A select with no valid value would fail validation on the next write.
      return definition.options[0]?.value ?? "";
    default:
      return "";
  }
}

export type ArrayRowMutationResult<T> =
  | { editable: true; value: T; itemId: string }
  | {
      editable: false;
      value: T;
      reason:
        | "invalid-path"
        | "not-an-array"
        | "index-out-of-range"
        | "max-rows"
        | "min-rows";
    };

/**
 * Appends a row to a repeated field, or inserts it after `afterIndex`.
 *
 * The row is created with a value for every declared field so it is valid the
 * moment it exists: a row of `undefined`s would render as gaps and be rejected
 * by the next content write.
 */
export function addArrayRowAtFieldPath<T>(
  value: T,
  arrayPath: string,
  definition: ThemeArrayContentFieldDefinition,
  options?: { afterIndex?: number; createId?: () => string },
): ArrayRowMutationResult<T> {
  if (!arrayPath || arrayPath.split(".").some((segment) => !segment)) {
    return { editable: false, value, reason: "invalid-path" };
  }
  const current = getFieldPathValue(value, arrayPath);
  const rows = Array.isArray(current) ? current : [];
  if (current !== undefined && !Array.isArray(current)) {
    return { editable: false, value, reason: "not-an-array" };
  }
  const maxRows = definition.maxRows ?? MAX_ARRAY_CONTENT_FIELD_ROWS;
  if (rows.length >= maxRows) {
    return { editable: false, value, reason: "max-rows" };
  }

  const rowFields = arrayRowFields(definition);
  // A list whose row shape never resolved has nothing to create.
  if (!rowFields) return { editable: false, value, reason: "not-an-array" };

  const itemId = (options?.createId ?? createMorphItemId)();
  const row: Record<string, unknown> = { id: itemId };
  for (const [key, fieldDefinition] of Object.entries(rowFields)) {
    row[key] = emptyRowValue(fieldDefinition);
  }

  const insertAt =
    options?.afterIndex === undefined
      ? rows.length
      : Math.min(Math.max(options.afterIndex + 1, 0), rows.length);
  const next = [...rows.slice(0, insertAt), row, ...rows.slice(insertAt)];
  return {
    editable: true,
    value: setFieldPathValue(value, arrayPath, next),
    itemId,
  };
}

/**
 * Removes one row, addressed the same way selection addresses it.
 *
 * `minRows` is enforced here rather than in the UI so a stale button or a
 * replayed message cannot empty a list the Theme requires.
 */
export function removeArrayRowAtFieldPath<T>(
  value: T,
  fieldPath: string,
  definition: ThemeArrayContentFieldDefinition,
): ArrayRowMutationResult<T> {
  const parsed = parseArrayItemFieldPath(fieldPath);
  if (!parsed) return { editable: false, value, reason: "invalid-path" };

  const current = getFieldPathValue(value, parsed.arrayPath);
  if (!Array.isArray(current)) {
    return { editable: false, value, reason: "not-an-array" };
  }
  if (parsed.index >= current.length) {
    return { editable: false, value, reason: "index-out-of-range" };
  }
  if (current.length <= (definition.minRows ?? 0)) {
    return { editable: false, value, reason: "min-rows" };
  }

  const removed = current[parsed.index] as Record<string, unknown> | undefined;
  const next = current.filter((_, index) => index !== parsed.index);
  return {
    editable: true,
    value: setFieldPathValue(value, parsed.arrayPath, next),
    itemId: typeof removed?.id === "string" ? removed.id : "",
  };
}
