/**
 * Reads the single row of a `.limit(1)` query, honestly typed as possibly
 * absent.
 *
 * `const [row] = await db.select()...` looks null-safe but is not: without
 * `noUncheckedIndexedAccess`, TypeScript types the destructured element as
 * present, so a lookup that finds nothing is inferred as always finding
 * something. `?? null` then narrows back to the non-nullable row and callers
 * never see the "not found" case — the failure surfaces later as an
 * unexplained `undefined` rather than at the call site.
 *
 * Use this helper for every single-row read so absence stays visible in the
 * declared type:
 *
 * ```ts
 * const row = firstOrNull(await db.select().from(t).where(...).limit(1));
 * if (!row) return null;
 * ```
 */
export function firstOrNull<T>(rows: readonly T[]): T | null {
  return rows.length > 0 ? (rows[0] as T) : null;
}
