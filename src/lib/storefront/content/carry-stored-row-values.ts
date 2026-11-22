import { sameContent } from "../editor/pending-content-write";
import {
  arrayRowFields,
  isArrayContentField,
  ROW_IDENTITY_KEY,
  type ThemeComponentContentCapability,
} from "../theme-content-capabilities";

/**
 * A list write keeps what its stored rows hold beside their declared fields.
 *
 * The top level of a section already works this way: the write merges the
 * filtered incoming values over the stored props, so a prop the source does
 * not declare is carried untouched (`contentFields` is an authoring allowlist,
 * not the runtime schema). A list is one prop, though, and its incoming rows
 * are filtered to their declared fields before the merge replaces the whole
 * array — so every row lost whatever it stored beside them. A caption edit to
 * one category card deleted the destination of every card, and reported
 * nothing dropped, because `items` itself was accepted.
 *
 * So each incoming row that names a stored row (by its id, the identity the
 * editor reads every stored row with) gets that stored row's undeclared values
 * back. A row the write removed stays removed, values and all; a new row has
 * nothing to carry. The write can neither change nor delete an undeclared
 * value: one it sent with a different value — or for a row with no stored
 * counterpart — is reported as dropped, by its path (`items.2.href`), exactly
 * as a changed undeclared top-level prop is.
 */
export function carryStoredRowValues(args: {
  /** The incoming props after `filterSectionContentProps`. */
  filtered: Record<string, unknown>;
  /** The incoming props as the client sent them (media verified). */
  sent: Record<string, unknown>;
  /** The section's stored props, rows identified. */
  stored: Record<string, unknown>;
  capability: ThemeComponentContentCapability | null | undefined;
}): { props: Record<string, unknown>; dropped: string[] } {
  const dropped: string[] = [];
  if (!args.capability) return { props: args.filtered, dropped };
  const props: Record<string, unknown> = { ...args.filtered };

  for (const [fieldKey, value] of Object.entries(args.filtered)) {
    const definition = args.capability.fields[fieldKey];
    if (!isArrayContentField(definition) || !Array.isArray(value)) continue;
    const rowFields = arrayRowFields(definition) ?? {};
    const isCarried = (key: string) =>
      key !== ROW_IDENTITY_KEY &&
      !Object.prototype.hasOwnProperty.call(rowFields, key);

    const storedRows = Array.isArray(args.stored[fieldKey])
      ? (args.stored[fieldKey] as unknown[])
      : [];
    const storedById = new Map<string, Record<string, unknown>>();
    for (const row of storedRows) {
      if (typeof row !== "object" || row === null || Array.isArray(row))
        continue;
      const id = (row as Record<string, unknown>)[ROW_IDENTITY_KEY];
      // A repeated id names no row reliably; neither copy is carried.
      if (typeof id !== "string") continue;
      if (storedById.has(id)) storedById.set(id, {});
      else storedById.set(id, row as Record<string, unknown>);
    }
    const sentRows = Array.isArray(args.sent[fieldKey])
      ? (args.sent[fieldKey] as unknown[])
      : [];

    props[fieldKey] = (value as Record<string, unknown>[]).map((row, index) => {
      const id = row[ROW_IDENTITY_KEY];
      const storedRow = typeof id === "string" ? storedById.get(id) : undefined;
      const carried: Record<string, unknown> = {};
      for (const [key, storedValue] of Object.entries(storedRow ?? {})) {
        if (isCarried(key)) carried[key] = storedValue;
      }
      const sentRow = sentRows[index];
      if (
        typeof sentRow === "object" &&
        sentRow !== null &&
        !Array.isArray(sentRow)
      ) {
        for (const [key, sentValue] of Object.entries(sentRow)) {
          if (!isCarried(key)) continue;
          if (!sameContent(sentValue, carried[key])) {
            dropped.push(`${fieldKey}.${index}.${key}`);
          }
        }
      }
      return Object.keys(carried).length > 0 ? { ...row, ...carried } : row;
    });
  }
  return { props, dropped };
}
