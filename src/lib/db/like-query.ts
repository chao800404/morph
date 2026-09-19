import { like, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { containsPattern, prefixPattern } from "./like-pattern";

/**
 * Whatever Drizzle's own `like()` accepts on the left.
 *
 * Taken from its signature rather than restated: a column union written out by
 * hand is one Drizzle upgrade away from being wrong, and the error would land
 * here rather than at the call site.
 */
type LikeColumn = Parameters<typeof like>[0];

/**
 * The only places in the application that spell `LIKE`.
 *
 * `like-pattern` owns the arithmetic; this owns the query. The raw-SQL route has
 * to exist because Drizzle's `like()` cannot match inside an array column, and
 * putting it here means "is every pattern bounded?" is answered by reading one
 * module rather than sixty-four call sites: the rule stops being a convention
 * every query has to re-earn and becomes a property of the module boundary.
 *
 * Keep it that way. A `like(` or a `LIKE` anywhere else is exactly the drift
 * this module exists to prevent, and it fails for users typing a long query long
 * before it fails for anyone testing one.
 */

/** A contains-search: `column LIKE %term%`, with the term fitted to the cap. */
export const likeContains = (
  column: LikeColumn,
  term: string,
): SQL => like(column, containsPattern(term));

/**
 * A prefix search, for a namespaced identifier — a fixed-length prefix on a
 * value the caller controls.
 *
 * Throws if the prefix does not fit the cap; see `prefixPattern` for why this
 * one refuses to truncate where `likeContains` does. Not for a hierarchical
 * path: a path prefix is over the cap before its second level, and a truncated
 * one would match the parent's subtree rather than the one you asked for. A
 * path wants a half-open range instead.
 */
export const likePrefix = (
  column: LikeColumn,
  prefix: string,
): SQL => like(column, prefixPattern(prefix));

/**
 * A contains-search against a column Drizzle's `like()` cannot take.
 *
 * An array column is the case that needs it: `assets.tags` is stored as an array
 * and only the raw spelling reaches inside it.
 */
export const sqlContains = (column: SQLWrapper, term: string): SQL =>
  sql`${column} LIKE ${containsPattern(term)}`;
