// @ts-check
/**
 * Render-mode evidence (handoff/2026-11-28/start-render-modes-audit.md,
 * "Codex review — adopted"): a Starter 32 Theme with one route per TanStack
 * Start render mode (full SSR, `ssr: false`, `ssr: "data-only"`, an `ssr()`
 * function on both branches, a controlled deferred `<Await>`), each with
 * shown and hidden sections read through `content()` and through a loader,
 * and a hidden layout Footer. Hidden sections stay out of the streamed HTML,
 * the serialized router state, `/_serverFn` answers and the hydrated DOM in
 * the Live Preview, the isolated Build Preview and the published site,
 * across load, reload, client navigation and Back; selection, Hide and Show
 * work in the editor on every route but /rm-defer, where Show staying
 * disabled after Hide is held as a KNOWN GAP. Containers and the full Start preview
 * only; on the shards the spec skips itself at file level.
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>`
 * requires exactly these titles, each once, passed with zero skip and zero
 * retry. No CI step runs that check yet: it is run on the container
 * transport by hand (Mac container lane). A renamed case changes this list in
 * the same commit.
 */
export const TARGET = Object.freeze({
  file: "start-render-modes-hidden.spec.ts",
  titles: Object.freeze([
    "Start render modes keep hidden sections out › Live Preview: each mode's direct load and reload stream no hidden section, and hydrate without one",
    "Start render modes keep hidden sections out › Live Preview: client navigation through every mode and Back reads no hidden section through /_serverFn",
    "Start render modes keep hidden sections out › editor: selection, Hide and Show work on the full SSR, ssr: false, data-only and ssr() routes; the bridge's wait on a held deferred value is recorded",
    "Start render modes keep hidden sections out › KNOWN GAP: on the deferred <Await> route, Show stays disabled after Hide, even once the held value is released",
    "Start render modes keep hidden sections out › Build Preview: each mode's HTML and hydrated DOM on the bp- host carry no hidden section",
    "Start render modes keep hidden sections out › published on SSR: each mode on the public site carries no hidden section, through load, reload, navigation and Back",
  ]),
});
