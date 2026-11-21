// TEST PROTOTYPE of platform wiring (Astro). Not product code, not Starter
// code, not the Morph SDK. Installed into a workspace as
// src/morph/request-context.ts; the author writes none of it.
//
// Frontmatter has `Astro.request`, but a module it calls does not, and Astro
// has no getRequest(). The middleware the platform's integration adds
// (integration.mjs, middleware.ts) puts the request here for the length of
// one render. Never a module-level variable: a Worker isolate serves many
// requests at once.

import { AsyncLocalStorage } from "node:async_hooks";

export const currentRequest = new AsyncLocalStorage<Request>();
