/**
 * SQLite rejects a LIKE/GLOB pattern longer than
 * `SQLITE_MAX_LIKE_PATTERN_LENGTH` with `LIKE or GLOB pattern too complex`.
 * D1 ships the default of 50, and the limit counts **bytes**, not characters.
 *
 * Measured against D1: a 48-byte term (pattern 50 bytes) succeeds and a 49-byte
 * term fails, for both ASCII and CJK. So a Chinese search breaks at 17
 * characters — three bytes each — which users hit far sooner than the
 * 48-character ASCII equivalent.
 *
 * Terms are truncated rather than rejected: the term is user-typed, so a limit
 * of "16 Chinese characters" would be a nonsensical thing to show a user, and
 * searching on the truncated term returns a superset of the intended matches
 * instead of an error. `prefixPattern` takes the opposite position, because its
 * input is not user-typed — see the note on it.
 *
 * This is not an edge case of this schema, it is a shape it keeps meeting. The
 * limit has been hit three times, by three different people in three different
 * situations: migration 0054's GLOB, the asset folder id path (two UUIDs plus
 * separators is already 76 characters), and an E2E verifier's marker that grew
 * by one phrase. A schema that stores UUIDs and paths everywhere meets a 50-byte
 * pattern cap constantly, which is why the arithmetic belongs here, in one
 * place, rather than in each query that happens to remember.
 */
const MAX_LIKE_PATTERN_BYTES = 50;

/** Two bytes are spent on the leading and trailing `%`. */
const MAX_TERM_BYTES = MAX_LIKE_PATTERN_BYTES - 2;

const encoder = new TextEncoder();

/** Cut to at most `maxBytes`, never splitting a multi-byte character. */
const truncateToBytes = (value: string, maxBytes: number): string => {
  if (encoder.encode(value).length <= maxBytes) return value;

  let result = "";
  let usedBytes = 0;
  // Iterating the string yields whole code points, so surrogate pairs and
  // multi-byte characters stay intact.
  for (const char of value) {
    const charBytes = encoder.encode(char).length;
    if (usedBytes + charBytes > maxBytes) break;
    result += char;
    usedBytes += charBytes;
  }
  return result;
};

/**
 * Build a `%term%` pattern that always fits within SQLite's limit.
 *
 * Use this for every user-supplied contains-search; passing a raw term to
 * `like()` throws once it exceeds 48 bytes.
 */
export const containsPattern = (term: string): string =>
  `%${truncateToBytes(term, MAX_TERM_BYTES)}%`;

/** One `%` is spent by the trailing wildcard. */
const MAX_PREFIX_BYTES = MAX_LIKE_PATTERN_BYTES - 1;

/**
 * Build a `prefix%` pattern for a prefix that ends at a delimiter the caller
 * controls — a namespaced identifier such as `reset-access:`.
 *
 * The prefix analogue of `containsPattern`, and deliberately *not* its
 * behaviour. The difference is whose mistake an over-long input is.
 * `containsPattern` receives a user's typing: there is no correct answer to
 * show at 16 Chinese characters, so degrading to a superset of results is the
 * whole point. A prefix is structural — built from an id or a constant — so an
 * over-long one is the caller's bug, and truncation removes the only signal
 * that would have caught it.
 *
 * What it costs, precisely: a well-formed prefix ends at a delimiter, and that
 * delimiter is what makes it a boundary. `/u1/u2/` matches the subtree under
 * `u2`; the truncated `/u1/u2` also matches `/u1/u2abc/`. So truncation does not
 * shorten the match, it removes the boundary — every nested path starts
 * matching its parent's subtree instead of its own, silently and with no
 * collision required. Downstream that is not a few extra search results: the
 * four subtree readers drive download, delete, move and update.
 *
 * So this throws rather than truncates. Do not reach for it to walk a
 * hierarchical path: the cap is 49 bytes and two UUIDs plus separators is
 * already 75, so a path prefix is over the limit before its second level. A path
 * wants a half-open range — `gte(column, prefix)` with `lt(column, upperBound)`
 * — which has no length limit and can use the column's index; see
 * `startsWithPrefix` in `src/lib/asset/dal/asset-folder.dal.ts`.
 */
export const prefixPattern = (prefix: string): string => {
  const prefixBytes = encoder.encode(prefix).length;
  if (prefixBytes > MAX_PREFIX_BYTES) {
    throw new Error(
      `prefixPattern: ${prefixBytes}-byte prefix exceeds the ${MAX_PREFIX_BYTES}-byte LIKE cap. ` +
        "A well-formed prefix ends at a delimiter — the byte that makes it a " +
        "boundary — and truncating removes exactly that byte, so the pattern " +
        "would match the parent's subtree instead of its own. For a " +
        "hierarchical path use a half-open range: gte(column, prefix) with " +
        "lt(column, upperBound), as in startsWithPrefix " +
        "(src/lib/asset/dal/asset-folder.dal.ts).",
    );
  }
  return `${prefix}%`;
};
