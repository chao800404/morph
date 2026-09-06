import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

/**
 * Workaround for upstream TanStack Start bug (TanStack/router#6609):
 * In dev mode, when a server function is requested before its declaring module has been
 * transformed by the Vite dev server, `tanstack-start-core:validate-server-fn-id` attempts
 * to lazy-load the module using `transformRequest(`${absPath}?${SERVER_FN_LOOKUP}`)`.
 * However, `SERVER_FN_LOOKUP` is explicitly excluded from Start's compiler transform filter
 * and only runs `ingestModule` (which does not extract or register server function IDs into
 * `serverFnsById`). Consequently, `validate-server-fn-id` fails and throws
 * "Error: Invalid server function ID: ...".
 *
 * This pre-plugin intercepts `virtual:tanstack-start-validate-server-fn-id`, decodes the
 * target module path, and triggers `transformRequest(absPath)` on the plain source file so
 * that TanStack Start's compiler runs `compile()` and populates `serverFnsById` before
 * validation executes.
 */
function tanstackServerFnValidateFix(): Plugin {
  let root = process.cwd();
  return {
    name: "morph:tanstack-server-fn-validate-fix",
    apply: "serve",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
    },
    async load(id) {
      if (!id.includes("virtual:tanstack-start-validate-server-fn-id")) {
        return null;
      }
      try {
        const queryIndex = id.indexOf("?");
        if (queryIndex !== -1) {
          const query = new URLSearchParams(id.slice(queryIndex + 1));
          const fnId = query.get("id");
          if (fnId) {
            const decoded = JSON.parse(Buffer.from(fnId, "base64url").toString("utf8"));
            if (typeof decoded.file === "string") {
              let sourceFile = decoded.file;
              if (sourceFile.startsWith("/@id/")) sourceFile = sourceFile.slice(5);
              else if (sourceFile.startsWith("/@fs/")) {
                sourceFile = sourceFile.slice(4);
                sourceFile = sourceFile.replace(/^\/([A-Za-z]:\/)/, "$1");
              } else if (sourceFile.startsWith("/")) {
                sourceFile = sourceFile.slice(1);
              }
              const qIdx = sourceFile.indexOf("?");
              if (qIdx !== -1) sourceFile = sourceFile.slice(0, qIdx);

              const absPath = path.resolve(root, sourceFile);
              if (
                "transformRequest" in this.environment &&
                typeof this.environment.transformRequest === "function"
              ) {
                await this.environment.transformRequest(absPath);
              }
            }
          }
        }
      } catch {
        // Fall through to TanStack Start's built-in validator
      }
      return null;
    },
  };
}

const config = defineConfig({
  plugins: [
    tanstackServerFnValidateFix(),
    devtools(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    // Must come after tanstackStart: with vite-tsconfig-paths registered first,
    // Start's import protection cannot resolve aliased imports and silently
    // stops reporting violations (TanStack/router#6770).
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    viteReact(),
  ],
  server: {
    /**
     * Storefront routing is decided by hostname, so testing it locally requires
     * reaching the dev server on something other than `localhost`. Vite blocks
     * unknown hosts by default (DNS-rebinding protection), which rejects the
     * request before it can reach the Worker.
     *
     * `.localtest.me` resolves to 127.0.0.1 through public DNS, so a storefront
     * hostname needs no hosts-file entry. A leading dot allows subdomains.
     *
     * This applies to `vite dev` only — production hostname classification is
     * unaffected, and platform surface is still separated by
     * `collectPlatformHostnames`. Add more dev hostnames with
     * `MORPH_DEV_ALLOWED_HOSTS` (comma-separated) rather than disabling the
     * check entirely.
     */
    allowedHosts: [
      ".localtest.me",
      ...(process.env.MORPH_DEV_ALLOWED_HOSTS ?? "")
        .split(",")
        .map((host) => host.trim())
        .filter(Boolean),
    ],
  },
  /**
   * Pins where the browser posts server functions.
   *
   * `createClientRpc` builds every server function's URL as
   * `process.env.TSS_SERVER_FN_BASE + functionId`, and it is shipped to the
   * browser with that expression intact. `process` does not exist there, so
   * unless this is substituted at transform time the URL is built from
   * `undefined` — and a server function posted to an unroutable path comes back
   * as `{"status":500,"unhandled":true,"message":"HTTPError"}`, h3's catch-all,
   * with the real reason stripped. It looks like the request failed on the
   * server when it never reached a handler at all.
   *
   * That made it intermittent and reload-sensitive: it depends on whether a
   * given module was evaluated while the value happened to be reachable, so
   * editing a file could break the next call and a refresh would fix it.
   */
  define: {
    "process.env.TSS_SERVER_FN_BASE": JSON.stringify("/_serverFn/"),
  },
  optimizeDeps: {
    exclude: ["vinxi/http"],
  },
});

export default config;
