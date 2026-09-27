import { THEME_PUBLIC_RESERVED_URL_PREFIXES } from "../theme-public-files";
import { THEME_PREVIEW_SERVER_BASE_PATH } from "./theme-preview-dev-server";

/**
 * Root-path `public/` URLs in the Live Preview.
 *
 * A Theme writes `<img src="/images/hero.png">`, as TanStack Start and Vite
 * expect, and the published storefront serves it at that path. The Live
 * Preview's Vite server is mounted under `THEME_PREVIEW_SERVER_BASE_PATH`,
 * so it serves `public/` there instead, and answered the author's URL with a
 * 404: every public/ image and font was missing from the canvas.
 *
 * This maps such a request onto the base, and nothing else. Only a GET or
 * HEAD, only for a file that exists in `public/`, and never for a path the
 * preview or the platform owns: the base itself, Vite's own `/@…` and
 * `/__vite…` endpoints, and the URL prefixes the public/ contract reserves.
 * A path with an empty, `.`, `..` or dot-led segment is left alone, as is
 * anything that resolves outside `public/`. Everything left alone goes on to
 * whatever handled it before, so a missing file is still the same 404.
 */

type PathApi = Readonly<{
  resolve: (...segments: string[]) => string;
  relative: (from: string, to: string) => string;
  isAbsolute: (value: string) => boolean;
}>;

export type RootPublicOptions = Readonly<{
  /** The preview's Vite base, with its trailing slash. */
  base: string;
  /** The absolute `public/` directory of the preview workspace. */
  publicDir: string;
  /** Lower-case URL prefixes that are never a public/ file. */
  reservedPrefixes: readonly string[];
  path: PathApi;
  isFile: (absolutePath: string) => boolean;
}>;

/**
 * The URL a request should be served at instead, or null to leave it.
 *
 * Self-contained, because the generated `vite.config.ts` embeds it through
 * `toString()`: it reads nothing but its arguments.
 */
export function rootPublicRequestTarget(
  options: RootPublicOptions,
  method: string | undefined,
  url: string | undefined,
): string | null {
  if (method !== "GET" && method !== "HEAD") return null;
  if (!url || !url.startsWith("/")) return null;
  const queryAt = url.search(/[?#]/);
  const rawPath = queryAt === -1 ? url : url.slice(0, queryAt);
  const suffix = queryAt === -1 ? "" : url.slice(queryAt);
  if (rawPath === "/") return null;
  const baseWithoutSlash = options.base.replace(/\/$/, "");
  if (rawPath === baseWithoutSlash || rawPath.startsWith(options.base)) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  const lowered = decoded.toLowerCase();
  if (
    lowered.startsWith("/@") ||
    lowered.startsWith("/__vite") ||
    lowered.startsWith("/__open-in-editor")
  ) {
    return null;
  }
  if (
    options.reservedPrefixes.some(
      (prefix) => lowered.startsWith(prefix) || `${lowered}/` === prefix,
    )
  ) {
    return null;
  }

  const segments = decoded.slice(1).split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment.startsWith(".") ||
        segment.includes("\\") ||
        segment.includes("\0"),
    )
  ) {
    return null;
  }
  const file = options.path.resolve(options.publicDir, ...segments);
  const relative = options.path.relative(options.publicDir, file);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    options.path.isAbsolute(relative)
  ) {
    return null;
  }
  if (!options.isFile(file)) return null;
  return `${options.base}${rawPath.slice(1)}${suffix}`;
}

/**
 * The Vite plugin source the generated Live Preview config embeds. It uses
 * the config's own `path` and `fs` imports, and `rootLiteral`, the workspace
 * root as a JSON string literal.
 */
export function themePreviewRootPublicPluginSource(
  rootLiteral: string,
): string {
  return `{
  name: "morph-preview-root-public",
  configureServer(server) {
    const options = {
      base: ${JSON.stringify(THEME_PREVIEW_SERVER_BASE_PATH)},
      publicDir: path.resolve(${rootLiteral}, "public"),
      reservedPrefixes: ${JSON.stringify(THEME_PUBLIC_RESERVED_URL_PREFIXES)},
      path,
      isFile: (file) => {
        try {
          return fs.statSync(file).isFile();
        } catch {
          return false;
        }
      },
    };
    const target = ${rootPublicRequestTarget.toString()};
    server.middlewares.use((req, _res, next) => {
      const rewritten = target(options, req.method, req.url);
      if (rewritten !== null) req.url = rewritten;
      next();
    });
  },
}`;
}
