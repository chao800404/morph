/**
 * D1 rejects a statement with more than 100 bound parameters
 * (`D1_ERROR: too many SQL variables`).
 *
 * A multi-row insert binds `rows × columns` parameters, so batches have to be
 * sized by column count, not by row count. Picking a fixed row count is the
 * easy mistake: it happens to work for narrow tables and fails for wide ones.
 */
export const D1_MAX_BOUND_PARAMS = 100;

export const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  const safeSize = Math.max(1, size);
  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize));
  }
  return chunks;
};

/** Largest number of rows that fits under D1's parameter cap. */
export const rowsPerInsert = (columnCount: number): number =>
  Math.max(1, Math.floor(D1_MAX_BOUND_PARAMS / Math.max(1, columnCount)));

/** Split rows for a multi-row insert of a table with `columnCount` columns. */
export const chunkForInsert = <T>(rows: T[], columnCount: number): T[][] =>
  chunk(rows, rowsPerInsert(columnCount));
