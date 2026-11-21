// TEST PROTOTYPE of platform wiring (Astro). Not product code, not Starter
// code, not the Morph SDK. Installed into a workspace as
// morph-content-wiring.mjs.
//
// Stands in for one line Morph's own wrapper configs would carry
// (astro-preview-workspace.ts, astro-native-prerender.ts: `integrations:
// [...own.integrations, morph...()]`). Those are product code and are not
// changed here, so the test support adds this integration to the Theme's
// config instead. Either way the Theme writes no middleware: Astro's
// `addMiddleware` adds the platform's, before any the author defines.

export function morphContentWiring() {
  return {
    name: "morph:content-wiring-test-prototype",
    hooks: {
      "astro:config:setup": ({ addMiddleware }) => {
        addMiddleware({
          order: "pre",
          entrypoint: new URL("./src/morph/middleware.ts", import.meta.url),
        });
      },
    },
  };
}
