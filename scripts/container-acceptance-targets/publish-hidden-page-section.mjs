// @ts-check
/**
 * M3 stage 1, the newsletter acceptance (handoff 2026-11-26
 * m3-reshow-plan.md): a CMS Page whose published revision hides a section is
 * refused at Theme publish with the active release and the public page
 * unchanged, shown again from the refusal, and after the Page and Theme are
 * published the section is back with the content it had before it was
 * hidden. Building and publishing need the container transport; on the
 * shards the spec skips itself at file level.
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>`
 * requires exactly these titles, each once, passed with zero skip and zero
 * retry. No CI step runs that check yet; wiring the container step is a
 * separate change. A renamed case changes this list in the same commit.
 */
export const TARGET = Object.freeze({
  file: "publish-hidden-page-section.spec.ts",
  titles: Object.freeze([
    "a hidden CMS Page section refused at publish, shown again › the newsletter is live, then hidden in the Page's published revision",
    "a hidden CMS Page section refused at publish, shown again › 1 and 2. the Theme publish is refused and the active release is unchanged; Show again changes only the Page's draft",
    "a hidden CMS Page section refused at publish, shown again › 3. Page published, then the Theme: the newsletter is back with the same content",
  ]),
});
