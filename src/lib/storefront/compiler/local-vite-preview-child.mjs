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
// argv: <root> <host> <port>. Sends { type: "ready", port } once listening,
// { type: "error", message } on failure, and exits when the parent goes away.
import { createServer } from "vite";

const [root, host, port] = process.argv.slice(2);

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
  process.send?.({ type: "ready", port: boundPort });
}

main().catch((error) => {
  process.send?.({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
