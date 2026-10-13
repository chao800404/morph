// TEST PROTOTYPE of platform wiring (Astro). Not product code, not Starter
// code, not the Morph SDK. Installed into a workspace as
// src/morph/middleware.ts and added by integration.mjs through Astro's
// `addMiddleware`; the Theme has no src/middleware.ts for it.
//
// It only holds the request for the render: it reads no content and changes
// neither the request nor the response.

import { currentRequest } from "./request-context";

export const onRequest = (
  context: { request: Request },
  next: () => Promise<Response>,
): Promise<Response> => currentRequest.run(context.request, next);
