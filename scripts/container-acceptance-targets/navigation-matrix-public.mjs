// @ts-check
/**
 * The five public storefront cells of the M1 navigation matrix (§11.2 item 5),
 * which only a container transport can run: the shards and the full Start job
 * use the local-sidecar transport, where these cells skip themselves.
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>` requires
 * exactly these titles, each once, passed with zero skip and zero retry. No CI
 * step runs that check yet; wiring the container step is a separate change.
 * Until then these cells are unproven in CI. A renamed cell changes this list
 * in the same commit.
 */
export const TARGET = Object.freeze({
  file: "navigation-matrix.spec.ts",
  titles: Object.freeze([
    "Navigation Matrix: Preview and Storefront › Public storefront navigation matrix › 1. Initial Load: storefront renders published home content, draft strictly never leaks",
    "Navigation Matrix: Preview and Storefront › Public storefront navigation matrix › 2. Link Navigation: storefront navigates via Link to detail and back, draft never leaks",
    "Navigation Matrix: Preview and Storefront › Public storefront navigation matrix › 3. History Navigation: browser back and forward on public storefront, draft never leaks",
    "Navigation Matrix: Preview and Storefront › Public storefront navigation matrix › 4. Reload: refresh restores published non-home route on storefront, draft never leaks",
    "Navigation Matrix: Preview and Storefront › Public storefront navigation matrix › 5. Direct URL: opens non-home route directly on public storefront, draft never leaks",
  ]),
});
