// TEST PROTOTYPE of platform wiring (Astro). Not product code, not Starter
// code, not the Morph SDK. Installed into a workspace as src/morph/content.ts,
// the module pages import `morph` from; the author writes none of it.
//
// All reading is the shared core's (./core). This only answers the core's one
// question for Astro: the request being rendered, as the platform's
// middleware holds it.

import { createMorph } from "./core";
import { currentRequest } from "./request-context";

export { MorphContentError } from "./core";
export type { MorphContentErrorCode, MorphPage } from "./core";

export const morph = createMorph(() => {
  const request = currentRequest.getStore();
  return request === undefined
    ? undefined
    : { kind: "forwarded", origin: request.headers.get("x-morph-content-origin") };
});
