// @ts-check
/**
 * Astro M2 PR 3, the first Astro Inspector write, and the Astro M2 D3
 * shapes (acceptance coverage equal to Start's B1 and binding acceptance,
 * the shared case table `~/handoff/2026-11-27/binding-case-table.md`):
 * `e2e/astro-inspector-write.spec.ts` on the real container Live Preview,
 * with Astro on (`MORPH_ASTRO_THEMES=1` in the Worker's `.dev.vars` and in
 * the runner's shell) and Core's `ASTRO_PARSER` bound
 * (`MORPH_E2E_ASTRO_PARSER=1`; the runner makes one real parse through that
 * binding before any test and refuses the run otherwise).
 *
 * - the PR 3 hero: a click selects and opens its declared fields (D2), an
 *   Inspector edit made from an equal baseline is stored at exactly that
 *   field of the whole D1 draft, a second field only on the reloaded page's
 *   own ack, a reload agrees (D3 rows 1, 10, 11, 15, 16, 19), and an edit on
 *   a draft another writer replaced is refused and kept (row 20);
 * - the editable shapes: field-wise props, a cross-name alias, renamed
 *   destructuring, a literal before the spread, and a second same-text
 *   instance on /about (rows 2-4, 12, 17);
 * - the shapes Design must not write: each refused field shown as
 *   controlled by code with no write, its sibling edited (rows 5-9);
 * - the `.fields.ts` declaration relabelled, deleted by another tab under a
 *   held edit, gone, and made again (row 30).
 *
 * Every case must run once and pass with zero skip and zero retry: the
 * spec's gates skip the whole file where Astro or the parser is off, and
 * this check then fails for the missing cases instead of passing.
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>`
 * requires exactly these titles. No CI step runs it yet: Astro container
 * E2E is local only for M2 (owner decision D4, 2026-11-26), so it is listed
 * as deferred in scripts/ci-workflow.test.mjs. A renamed case changes this
 * list in the same commit.
 */
const PR3 = "Astro Inspector write on the container Live Preview (M2 PR 3)";
const SHAPES =
  "Astro D3 shapes: field-wise, aliases, a literal before the spread, a second instance on another page";
const REFUSED =
  "Astro D3 shapes Design must not write: literals, an override after the spread, author code, a page value";
const SIDECAR = "Astro D3 fields declared in <Name>.fields.ts";

export const TARGET = Object.freeze({
  file: "astro-inspector-write.spec.ts",
  titles: Object.freeze([
    `${PR3} › a click selects the hero, an Inspector edit is stored in the Document, and page, Inspector and Document agree after a reload`,
    `${PR3} › an edit made on a draft another writer replaced is refused, kept, and writes nothing`,
    `${SHAPES} › each shape edits only its own field, a second same-text instance on /about edits alone, and a reload agrees`,
    `${REFUSED} › each refused field is shown as controlled by code and writes nothing, its sibling edits, and literals alone select nothing`,
    `${SIDECAR} › follows a relabelled declaration saved in Code`,
    `${SIDECAR} › does not save an edit after another tab deleted the declaration, keeps it, and says so`,
    `${SIDECAR} › drops the fields once the declaration is gone`,
    `${SIDECAR} › brings the fields back when the declaration is made again, and an edit is stored`,
  ]),
});
