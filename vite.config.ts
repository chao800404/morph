import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, transformWithEsbuild, type Plugin } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";
import {
  DEV_PREVIEW_PASSTHROUGH_HEADER,
  DEV_PREVIEW_PASSTHROUGH_PATH,
  isDevPreviewHost,
} from "./src/server/dev-preview-passthrough";

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

/**
 * Dev only: a Live Preview host's requests go to the Worker, not to this Vite.
 *
 * A Start Live Preview is served at the root of its own host, so its module
 * URLs (`/src/...`, `/@vite/client`, `/node_modules/...`) are ones this Vite
 * would otherwise answer from Morph's own source. Registered before Vite's
 * middlewares, it parks such a request on a path Vite does not own; the
 * Worker restores it (src/server/dev-preview-passthrough.ts). The preview
 * hostname is the Worker's THEME_PREVIEW_HOSTNAME (`preview.localhost` in
 * wrangler.jsonc); override with MORPH_DEV_PREVIEW_HOSTNAME.
 */
function morphDevPreviewPassthrough(): Plugin {
  const previewHostname =
    process.env.MORPH_DEV_PREVIEW_HOSTNAME ?? "preview.localhost";
  return {
    name: "morph:dev-preview-passthrough",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (isDevPreviewHost(req.headers.host, previewHostname)) {
          req.headers[DEV_PREVIEW_PASSTHROUGH_HEADER] = req.url ?? "/";
          req.url = DEV_PREVIEW_PASSTHROUGH_PATH;
        }
        next();
      });
    },
  };
}

/**
 * Prints Morph's server chunks ASCII-only and without whitespace or comments.
 * Server build only: the client build is untouched.
 *
 * workerd compiles every server chunk into each Worker isolate at start, and
 * V8 keeps a script's source for the isolate's lifetime: two bytes per
 * character if any character is above U+00FF, which a single em dash in a
 * comment is enough for. Measured at about 15 MiB less isolate memory after
 * GC in every state (docs/evidence/main-worker-memory-2026-10.md, section 8).
 *
 * Only esbuild's own output options are used. Names and syntax are never
 * minified, so stack traces keep their function names, and source maps
 * (`environments.ssr.build.sourcemap`) map positions back to Morph's source.
 * esbuild leaves regular expressions and tagged templates as written, where
 * escaping could change a value; any chunk that keeps a character above
 * U+007F is reported, never rewritten.
 *
 * `order: "post"`: Vite's own `vite:esbuild-transpile` reprints every server
 * chunk with `charset: "utf8"` and readable whitespace, which would undo this.
 */
function morphServerOutput(): Plugin {
  return {
    name: "morph:server-output",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "ssr",
    renderChunk: {
      order: "post",
      async handler(code, chunk) {
        const result = await transformWithEsbuild(code, chunk.fileName, {
          loader: "js",
          format: "esm",
          charset: "ascii",
          minifyWhitespace: true,
          minifyIdentifiers: false,
          minifySyntax: false,
          // Unchanged from Vite's default; whether license comments must be
          // kept is a separate decision.
          legalComments: "none",
          sourcemap: true,
        });
        return { code: result.code, map: result.map };
      },
    },
    generateBundle(_options, bundle) {
      // Bounded, so a regression cannot flood the build log or print much of
      // a chunk's source: a few chunks, one short excerpt each.
      const MAX_CHUNKS = 10;
      const EXCERPT_BEFORE = 24;
      const EXCERPT_AFTER = 8;
      const kept: string[] = [];
      let chunks = 0;
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        const code = output.code;
        let count = 0;
        let first = -1;
        for (let index = 0; index < code.length; index += 1) {
          if (code.charCodeAt(index) <= 0x7f) continue;
          count += 1;
          if (first < 0) first = index;
        }
        if (count === 0) continue;
        chunks += 1;
        if (kept.length < MAX_CHUNKS) {
          const excerpt = code.slice(
            Math.max(0, first - EXCERPT_BEFORE),
            first + EXCERPT_AFTER,
          );
          kept.push(
            `  ${output.fileName}: ${count} character(s), first at ${JSON.stringify(excerpt)}`,
          );
        }
      }
      if (chunks > 0) {
        const more =
          chunks > kept.length ? `\n  …and ${chunks - kept.length} more` : "";
        this.warn(
          `${chunks} server chunk(s) keep characters above U+007F, which esbuild leaves as written in regular expressions and tagged templates. This is a notice, not an error; such a chunk is stored two bytes per character in each Worker isolate.\n${kept.join("\n")}${more}`,
        );
      }
    },
  };
}

const config = defineConfig({
  plugins: [
    morphDevPreviewPassthrough(),
    tanstackServerFnValidateFix(),
    // Skipped for an end-to-end run: its event bus binds a fixed port (42069),
    // so a run started beside a developer's own `pnpm dev` dies before serving
    // anything. Nothing attaches devtools to an automated run anyway.
    ...(process.env.MORPH_E2E_STATE_DIR ? [] : [devtools()]),
    cloudflare({
      viteEnvironment: { name: "ssr" },
      // Local bindings live in `.wrangler/state` unless a run asks for its own.
      // An editor end-to-end run does: it lays out a database, seeds an account
      // and throws the directory away, and doing that in the shared state would
      // mean a test run and a developer's own store writing to one place. The
      // path must be absolute — Wrangler resolves `--persist-to` against the
      // working directory while this resolves against Vite's root, so a
      // relative one sends the migrations and the server to different
      // directories and the server simply finds nothing.
      persistState: process.env.MORPH_E2E_STATE_DIR
        ? { path: process.env.MORPH_E2E_STATE_DIR }
        : undefined,
      // The debugger port is fixed, so a run started beside a developer's own
      // `pnpm dev` dies on `EADDRINUSE` before it serves anything. An
      // end-to-end run has nothing to attach a debugger to, so it goes without.
      inspectorPort: process.env.MORPH_E2E_STATE_DIR ? false : undefined,
    }),
    tailwindcss(),
    tanstackStart(),
    // Must come after tanstackStart: with vite-tsconfig-paths registered first,
    // Start's import protection cannot resolve aliased imports and silently
    // stops reporting violations (TanStack/router#6770).
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    viteReact(),
    morphServerOutput(),
  ],
  environments: {
    // Source maps for the server chunks, which `morphServerOutput` prints
    // without line breaks: a stack trace's positions map back to Morph's
    // source through them. They stay in dist/server, which is not served as
    // static assets; `upload_source_maps` in wrangler.jsonc hands them to
    // Cloudflare at deploy.
    ssr: { build: { sourcemap: true } },
  },
  server: {
    /**
     * Local Live Preview workspaces are laid out under the checkout
     * (`.morph-previews/`, see local-vite-preview-server.ts) and are served by
     * their own Vite. This one must not watch them: a preview start rewrites
     * its whole workspace, and a rewritten `tsconfig.json` there made this
     * server clear its cache, full-reload the editor and reload the Worker
     * mid-request ("Worker's code had hung" in the preview frame). The
     * `.morph-previews-*` roots are the ones tests create.
     */
    watch: {
      ignored: ["**/.morph-previews/**", "**/.morph-previews-*/**"],
    },
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
