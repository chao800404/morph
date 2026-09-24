import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Writes a generated file only when its content would change.
 *
 * The generators run before every `typecheck`, `build` and `test`. They used to
 * rewrite their outputs every time, identical or not, and several of those
 * outputs live under `src/`: a running `pnpm dev` saw them change and reloaded
 * its Worker, which restarted the Live Preview sandbox's runtime and left every
 * open preview answering `410` until it reconnected. Leaving an unchanged file
 * untouched keeps a validation run from disturbing a dev server it has nothing
 * to do with.
 *
 * Returns whether the file was written.
 */
export function writeFileIfChanged(path, content) {
  let current = null;
  try {
    current = readFileSync(path, "utf8");
  } catch {
    current = null;
  }
  if (current === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return true;
}
