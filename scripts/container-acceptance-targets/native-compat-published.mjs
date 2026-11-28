// @ts-check
/**
 * Ordinary TanStack Start code on the published storefront: the Theme built
 * in the Sandbox container, published, and reached through Morph Core on a
 * local storefront hostname (the local deployer), the way a shopper reaches
 * it. Its Theme carries no build configuration of its own, so it runs with
 * the native build off. It needs the container transport, so on the editor
 * shards it skips itself; this target is the container run, where it may not
 * skip. Its tests are serial and its first needs a storefront that has never
 * been published, which its own runner invocation provides.
 *
 * `node scripts/check-container-acceptance.mjs <report> <this module>`
 * requires exactly these titles, each once, passed with zero skip and zero
 * retry. The editor-e2e-container-starter-publish job runs that check after
 * its own container step. A renamed or added test changes this list in the
 * same commit.
 */
const DESCRIBE = "TanStack Start on the published storefront";

export const TARGET = Object.freeze({
  file: "native-compat-published.spec.ts",
  titles: Object.freeze(
    [
      "publishes the Theme and serves it on a storefront hostname",
      "server-renders a page whose loader calls a server function, with both middlewares",
      "answers server routes and redirects through Core",
      "passes a cookie set by Start's setCookie through Core",
      "serves a public/ image at its root URL",
      "calls server functions from the browser, with cookies, and navigates client-side",
      "preserves custom serialization in hydration and browser GET/POST through Core",
      "streams a deferred shell before release and hydrates its resolved value through Core",
      "keeps disabled and data-only SSR semantics before browser hydration through Core",
      "answers a path both sides have with each owner's own file",
      "serves the Theme's route for a path Morph also has a file for",
      "answers a path the Theme has nothing for with the Theme's 404, not Morph's file",
      "serves the Theme's built assets under /assets/ on the storefront only",
    ].map((title) => `${DESCRIBE} › ${title}`),
  ),
});
