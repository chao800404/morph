// One Astro Live Preview dev server in a process of its own. Forked by
// `LocalVitePreviewServer` with an IPC channel, for a framework whose
// adapter names its own dev server (theme-framework.types.ts,
// `ThemePreviewDevServer`); the same shape as local-vite-preview-child.mjs.
//
// Astro is imported from the workspace's own `node_modules`, which is the
// link to the framework's pinned toolchain the parent writes, so this runs
// the packages a container runs and never the checkout's.
//
// argv: <root> <host> <port> <configFile>, configFile workspace-relative.
// Sends { type: "ready", port } once listening, { type: "error", message }
// on failure, and exits when the parent goes away.
import path from "node:path";
import { pathToFileURL } from "node:url";

const [root, host, port, configFile] = process.argv.slice(2);

async function main() {
  const { dev } = await import(
    pathToFileURL(path.join(root, "node_modules", "astro", "dist", "index.js"))
      .href
  );
  const server = await dev({
    root,
    // Joined to `root` by Astro itself, so it stays workspace-relative.
    configFile,
    server: { host, port: Number(port) },
    vite: {
      // Local writes are filesystem events, and polling loses some of them;
      // the generated config polls for a container's writes.
      server: { strictPort: Number(port) !== 0, watch: { usePolling: false } },
      clearScreen: false,
    },
  });
  const boundPort = server.address?.port;
  if (!boundPort) throw new Error("LOCAL_PREVIEW_NO_PORT");
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await Promise.race([
      server.stop().catch(() => undefined),
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
