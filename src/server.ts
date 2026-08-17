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

type ServerHotData = {
  handler?: StartRequestHandler;
};

const hotData = import.meta.hot?.data as ServerHotData | undefined;
let handler = hotData?.handler;

const getHandler = async (): Promise<StartRequestHandler> => {
  if (!handler) {
    const { createStartHandler, defaultStreamHandler } = await import(
      "@tanstack/react-start/server"
    );
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

export default {
  async fetch(
    ...args: Parameters<StartRequestHandler>
  ): Promise<Response> {
    return (await getHandler())(...args);
  },
};

