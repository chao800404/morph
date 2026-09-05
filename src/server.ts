import type { Register } from "@tanstack/react-router";
import type { RequestHandler } from "@tanstack/react-start/server";

/**
 * Worker entry.
 *
 * This replaces `@tanstack/react-start/server-entry`, whose module-scope call
 * crosses a two-level wildcard re-export chain while Vite is rebuilding the
 * SSR graph. During that window the namespace can be incomplete and produce
 * `createStartHandler is not a function` (TanStack/router#7285).
 *
 * Resolve the namespace only on the first cold request. During HMR, preserve
 * the already-working request handler through Vite's hot data instead of
 * rebuilding it inside the incomplete update window. Start resolves the
 * current router and server-function entries per request, so the outer handler
 * itself does not need to be recreated for source updates.
 */
type StartRequestHandler = RequestHandler<Register>;
type WorkerQueueBatch = {
  messages: Array<{ body: unknown; ack?: () => void }>;
};

type ServerHotData = {
  handler?: StartRequestHandler;
};

const hotData = import.meta.hot?.data as ServerHotData | undefined;
let handler = hotData?.handler;

const getHandler = async (): Promise<StartRequestHandler> => {
  if (!handler) {
    const { createStartHandler, defaultStreamHandler } =
      await import("@tanstack/react-start/server");
    handler = createStartHandler(defaultStreamHandler);
  }
  return handler;
};

if (import.meta.hot) {
  import.meta.hot.dispose((data: ServerHotData) => {
    data.handler = handler;
  });
}

export { Sandbox } from "@cloudflare/sandbox";

/**
 * Production storefront traffic arrives on merchant hostnames and must never
 * reach the Morph Core router: the dashboard, editor and server functions are
 * platform surface. Hostnames are classified first, and only non-platform hosts
 * pay for storefront resolution.
 *
 * The storefront modules are imported lazily so a dashboard cold start does not
 * pull the release/artifact graph, and so this entry keeps the deferred-import
 * shape that the Start handler comment above depends on.
 */
async function handleStorefrontRequest(request: Request): Promise<Response> {
  const [{ StorefrontProductionService }, routing, { env }] = await Promise.all(
    [
      import("@/lib/storefront/service/storefront-production.service"),
      import("@/lib/storefront/service/storefront-request-routing"),
      import("cloudflare:workers"),
    ],
  );

  const { storefrontContentPublicationDal } =
    await import("@/lib/storefront/dal/storefront-content-publication.dal");

  const service = new StorefrontProductionService({
    runtime: routing.createThemeRuntime(
      env as unknown as Record<string, unknown>,
    ),
    r2Bucket: (env as any)?.R2_BUCKET,
    contentPorts: {
      getPublishedDocument: (args) =>
        storefrontContentPublicationDal.getPublishedTemplateDocument(
          args,
        ) as never,
      getPublishedPageDocument: (args) =>
        storefrontContentPublicationDal.getPublishedPageDocument(args) as never,
    },
    // Library media referenced by the live release, served to anonymous
    // visitors. The CMS `/assets` route needs a session, which a storefront
    // visitor does not have.
    mediaPorts: {
      listPublishedAssetKeys: (publicationId) =>
        storefrontContentPublicationDal.listPublishedAssetKeys(publicationId),
      getAssetContentType: async (assetId) => {
        const { assetDal } = await import("@/lib/asset/dal/asset.dal");
        // Only the response header. The bytes come from the published
        // snapshot, so editing the asset cannot change what is served.
        return (await assetDal.findById(assetId))?.mimeType ?? null;
      },
    },
  });
  return service.handleRequest(request);
}

async function isStorefrontHost(request: Request): Promise<boolean> {
  const { shouldRouteToStorefront } =
    await import("@/lib/storefront/service/storefront-request-routing");
  const { env } = await import("cloudflare:workers");
  return shouldRouteToStorefront(
    request,
    env as unknown as Record<string, unknown>,
  );
}

export default {
  async fetch(...args: Parameters<StartRequestHandler>): Promise<Response> {
    const request = args[0];
    if (await isStorefrontHost(request)) {
      return handleStorefrontRequest(request);
    }
    const response = await (await getHandler())(...args);

    // h3 turns anything that escapes a handler into a 500 carrying no cause,
    // and it *returns* that rather than throwing, so it has to be caught on the
    // way out. Server function calls are the one route where this is common —
    // Start throws out of `getServerFnById` for an id it does not have, which
    // happens when the browser holds one from before an edit
    // (TanStack/router#7363). Replace only that blank body; every other
    // response passes through untouched.
    if (response.status === 500) {
      const { recoverServerFnResponse } =
        await import("@/server/server-fn-recovery");
      return recoverServerFnResponse(request, response, {
        dev: import.meta.env.DEV,
      });
    }
    return response;
  },
  async queue(batch: WorkerQueueBatch): Promise<void> {
    const { processThemeBuildQueue } =
      await import("@/server/theme-build-queue");
    await processThemeBuildQueue(batch);
  },
};
