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
 * Terms are truncated rather than rejected: a limit of "16 Chinese characters"
 * would be a nonsensical thing to show a user, and searching on a prefix
 * returns a superset of the intended matches instead of an error.
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
