// TEST PROTOTYPE of platform wiring (TanStack Start). Not product code, not
// Starter code, not the Morph SDK. Installed into a workspace as
// src/morph/content.ts, the module routes import `morph` from; the author
// writes none of it.
//
// All reading is the shared core's (./core). This only answers the core's one
// question for Start: on the server, the request Start is handling
// (getRequest); in a browser, the page's own origin. Start strips the server
// branch, and with it the server-only import, from the client bundle.

import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { createMorph, type MorphContentSource } from "./core";

export { MorphContentError } from "./core";
export type { MorphContentErrorCode, MorphPage } from "./core";

/** The Starter's development-only fallback: server only, DEV only. */
function localContentOrigin(): string | null {
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV !== true) return null;
  const env = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env;
  const value = env?.MORPH_CONTENT_ORIGIN?.trim();
  return value ? value : null;
}

const source = createIsomorphicFn()
  .client((): MorphContentSource => ({ kind: "same-origin" }))
  .server((): MorphContentSource => ({
    kind: "forwarded",
    origin: getRequest().headers.get("x-morph-content-origin"),
    localOrigin: localContentOrigin(),
  }));

export const morph = createMorph(() => source());
