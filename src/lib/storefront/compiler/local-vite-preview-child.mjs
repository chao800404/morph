// One Live Preview dev server in a process of its own (PROTOTYPE, Start
// preview only). Forked by `LocalVitePreviewServer` with an IPC channel.
//
// Why a process: the Cloudflare Vite plugin keeps its Miniflare instance in
// module scope, one per Node process. Two Start previews in one process share
// it, and a preview replaced in the same process keeps the old Worker's module
// runner — measured: a Theme that gained `src/start.ts` after a first start
// never ran its request middleware until the process was new. The container
// transport already runs one Vite process per start; this is the same shape.
//
// argv: <root> <host> <port> [<served timing>]. Sends
// { type: "ready", port, servedTiming } once listening, { type: "error",
// message } on failure, and exits when the parent goes away.
//
// <served timing> is the `Server-Timing` value naming the instance the parent
// minted for this server. It is put on every response this server gives, as
// the in-process server does, and echoed on the ready so the parent can
// register it. Only the exact shape a parent mints is used; anything else is
// neither put on a response nor confirmed (servedTiming: null).
import { createServer } from "vite";

const [root, host, port, servedTimingArg] = process.argv.slice(2);

const SERVED_TIMING = /^morph-instance;desc="[A-Za-z0-9-]{8,64}\.[1-9]\d*"$/;
const servedTiming =
  typeof servedTimingArg === "string" && SERVED_TIMING.test(servedTimingArg)
    ? servedTimingArg
    : null;

async function main() {
  const server = await createServer({
    configFile: `${root}/vite.config.ts`,
    root,
    // The same override, and for the same reason, as the in-process server:
    // local writes are filesystem events and polling loses some of them.
    server: {
      host,
      port: Number(port),
      strictPort: Number(port) !== 0,
      watch: { usePolling: false },
    },
    clearScreen: false,
    // Set as each request arrives. The Worker's rendered document keeps it
    // (local-vite-preview-server.start-instance.test.ts) unless the Theme's
    // Worker sets its own `Server-Timing`, which replaces it: the page then
    // cannot name its server and reports that, never another instance.
    plugins: servedTiming
      ? [
          {
            name: "morph-preview-served-instance",
            configureServer(dev) {
              dev.middlewares.use((_request, response, next) => {
                response.setHeader("Server-Timing", servedTiming);
                next();
              });
            },
          },
        ]
      : [],
  });
  if (server.config.server.watch?.usePolling) {
    throw new Error("LOCAL_PREVIEW_POLLING_WATCHER: the resolved config polls.");
  }
  await server.listen();
  const address = server.httpServer?.address();
  const boundPort = address && typeof address === "object" ? address.port : null;
  if (!boundPort) throw new Error("LOCAL_PREVIEW_NO_PORT");
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    server.httpServer?.closeAllConnections?.();
    await Promise.race([
      server.close().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    process.exit(0);
  };
  process.on("SIGTERM", close);
  process.on("disconnect", close);
  process.send?.({ type: "ready", port: boundPort, servedTiming });
}

main().catch((error) => {
  process.send?.({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
