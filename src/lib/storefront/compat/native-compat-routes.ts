import type { NativeCompatFile } from "./native-compat-theme";

/** Ordinary Start routes, shared by preview and built-Worker acceptance. */
export const NATIVE_COMPAT_ROUTE_FILES: readonly NativeCompatFile[] = [
  {
    path: "src/routes/api/compat-items.$id.ts",
    content: String.raw`import { createFileRoute } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";

const routeMiddleware = createMiddleware().server(async ({ next }) =>
  next({ context: { routeMarker: "route" } }),
);
const getMiddleware = createMiddleware().server(async ({ next, context, request }) => {
  if (request.headers.get("x-compat-deny") === "1") {
    return new Response("fixture-refused", { status: 403 });
  }
  // This separately declared middleware receives the route context at runtime.
  const routeMarker = (context as { routeMarker?: string }).routeMarker;
  return next({ context: { handlerMarker: routeMarker + ":get" } });
});

export const Route = createFileRoute("/api/compat-items/$id")({
  server: {
    middleware: [routeMiddleware],
    handlers: ({ createHandlers }) => createHandlers({
      GET: {
        middleware: [getMiddleware],
        handler: async ({ params, context, request }) => Response.json({
          id: params.id,
          route: context.routeMarker,
          handler: context.handlerMarker,
          query: new URL(request.url).searchParams.get("q"),
        }, { headers: { "x-compat-handler": "executed" } }),
      },
      POST: async ({ params, context, request }) => Response.json({
        id: params.id,
        route: context.routeMarker,
        body: await request.json(),
      }),
      // Start falls through to page rendering for an undefined method.
      // An API that wants 405 defines the native ANY handler explicitly.
      ANY: async () => new Response("method-not-allowed", { status: 405 }),
    }),
  },
});
`,
  },
  {
    path: "src/routes/api/compat-files.$.ts",
    content: String.raw`import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/compat-files/$")({
  server: { handlers: { GET: async ({ params }) => Response.json({ path: params._splat }) } },
});
`,
  },
];
