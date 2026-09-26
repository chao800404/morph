/**
 * Reads something together with the Theme source generation it describes.
 *
 * A preview orders its writes by that generation, so a value must never be
 * paired with a generation newer than the state it was read from — old file
 * contents stamped with a new generation would outrank a start that is in
 * fact current, and let an older one through. D1 gives no read snapshot
 * across the two queries, so the generation is read before and after: every
 * workspace write advances it, so an unchanged value means no write landed
 * in between and the read saw exactly that generation. A changed one means
 * the read may straddle a save, and it is taken again.
 */

export const SOURCE_GENERATION_READ_ATTEMPTS = 3;

export async function readAtSourceGeneration<T>(
  readGeneration: () => Promise<number | null>,
  read: () => Promise<T>,
  attempts: number = SOURCE_GENERATION_READ_ATTEMPTS,
): Promise<{ value: T; generation: number }> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const before = await readGeneration();
    if (before === null) {
      throw new Error(
        "THEME_NOT_FOUND: The theme has no source generation to read against.",
      );
    }
    const value = await read();
    const after = await readGeneration();
    if (after === before) return { value, generation: before };
  }
  throw new Error(
    `SOURCE_GENERATION_UNSTABLE: The theme kept changing while it was read (${attempts} attempts). Try again.`,
  );
}
