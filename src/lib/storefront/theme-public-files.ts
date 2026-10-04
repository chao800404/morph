import { safeThemeFilePathSchema } from "@/lib/validations/storefront-theme-file";

import { themePublicSvgGate } from "./theme-public-svg-gate";

/**
 * The contract for files a Theme serves as they are, from `public/`.
 *
 * Vite's semantics: `public/images/hero.png` is copied into the build and
 * answered at `/images/hero.png`. A published Theme serves those files as
 * Cloudflare static assets, which answer *before* the Worker, so a file's
 * path is not only a name: it can take a URL away from a route, from the
 * platform's own endpoints, or — for `_headers` and `_redirects` — change how
 * the whole site responds. Every place a file enters `public/` (upload, copy
 * from the Media Library, project import, publish) checks it against this
 * one module, so the rules cannot drift between them.
 *
 * Holds images, fonts and validated data text (TXT/XML/JSON/webmanifest), all
 * stored as immutable bytes. SVG is refused while `themePublicSvgGate` is
 * closed: served from the store's own origin it can run script on navigation.
 * Behind the gate it is wired all the way: its bytes are checked by
 * `validateSvg` wherever they enter (`theme-public-bytes.ts`, kept apart so the
 * parser stays out of the browser bundle this module is part of) and again at
 * publish. The limits are product quotas, not platform ones, counted on raw
 * bytes.
 */

export const THEME_PUBLIC_DIRECTORY = "public/";

export const THEME_PUBLIC_LIMITS = {
  maxFileBytes: 5 * 1024 * 1024,
  /**
   * An SVG is parsed before it is stored, so it has a limit of its own: the
   * media library's, since both are held to the same rules.
   */
  maxSvgBytes: 2 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  maxFiles: 200,
} as const;

const SVG_MIME_TYPE = "image/svg+xml";
const TEXT_FORMATS: Readonly<Record<string, string>> = {
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  json: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
};

/** Format classification only; path admission still goes through the contract. */
export function themePublicTextMimeType(path: string): string | null {
  return TEXT_FORMATS[extensionOf(path)] ?? null;
}

type ThemePublicFormat = Readonly<{
  mimeType: string;
  /** Whether bytes are this format, from their leading signature. */
  matches: (bytes: Uint8Array) => boolean;
}>;

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) =>
  bytes.length >= at + signature.length &&
  signature.every((byte, index) => bytes[at + index] === byte);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

const PNG: ThemePublicFormat = {
  mimeType: "image/png",
  matches: (bytes) =>
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};
const JPEG: ThemePublicFormat = {
  mimeType: "image/jpeg",
  matches: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]),
};

const FORMATS: Readonly<Record<string, ThemePublicFormat>> = {
  png: PNG,
  jpg: JPEG,
  jpeg: JPEG,
  gif: {
    mimeType: "image/gif",
    matches: (bytes) =>
      startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a")),
  },
  webp: {
    mimeType: "image/webp",
    matches: (bytes) =>
      startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8),
  },
  avif: {
    mimeType: "image/avif",
    matches: (bytes) =>
      startsWith(bytes, ascii("ftyp"), 4) &&
      (startsWith(bytes, ascii("avif"), 8) ||
        startsWith(bytes, ascii("avis"), 8)),
  },
  ico: {
    mimeType: "image/x-icon",
    matches: (bytes) => startsWith(bytes, [0x00, 0x00, 0x01, 0x00]),
  },
  woff: {
    mimeType: "font/woff",
    matches: (bytes) => startsWith(bytes, ascii("wOFF")),
  },
  woff2: {
    mimeType: "font/woff2",
    matches: (bytes) => startsWith(bytes, ascii("wOF2")),
  },
};

/**
 * The extensions `public/` accepts, as a file picker's `accept` list. The
 * same table decides on the server; a picker only saves a round trip.
 */
export const THEME_PUBLIC_ACCEPT = [
  ...Object.keys(FORMATS),
  ...Object.keys(TEXT_FORMATS),
  ...(themePublicSvgGate() === "open" ? ["svg"] : []),
]
  .map((extension) => `.${extension}`)
  .join(",");

/**
 * URL prefixes the platform answers itself: the Theme Worker's own endpoints,
 * the build's hashed client assets, library media, Cloudflare's, the store
 * catalog, and published library media. A file under one of them could never
 * be reached: the storefront answers `/api/store/` and `/_storefront-media/`
 * before it looks for a client asset, and a Live Preview sends every
 * `/api/store/` request to Morph rather than to the Theme.
 *
 * Lower case, compared against a lower-cased path. The Live Preview's
 * root-path mapping (`theme-preview-root-public.ts`) skips them too.
 */
export const THEME_PUBLIC_RESERVED_URL_PREFIXES: readonly string[] = [
  "/_morph/",
  "/_serverfn/",
  "/_storefront-media/",
  "/api/store/",
  "/assets/",
  "/cdn-cgi/",
];

/**
 * Files that mean something to the static asset host or the browser rather
 * than being served as themselves.
 */
const PLATFORM_FILE_NAMES = new Set([
  "_headers",
  "_redirects",
  "_routes.json",
  "_worker.js",
  "index.html",
  "404.html",
]);

export type ThemePublicPathRefusal =
  | "not-public"
  | "unsafe-path"
  | "hidden-file"
  | "platform-file"
  | "reserved-prefix"
  | "route-collision"
  | "svg-not-allowed"
  | "unsupported-format";

/** Whether the path names an SVG, which the contract checks by parsing. */
export function isThemePublicSvgPath(path: string): boolean {
  return extensionOf(path) === "svg";
}

export type ThemePublicPathCheck =
  | Readonly<{ ok: true; urlPath: string; mimeType: string }>
  | Readonly<{ ok: false; reason: ThemePublicPathRefusal }>;

/** `public/images/hero.png` → `/images/hero.png`; null outside `public/`. */
export function themePublicUrlPath(path: string): string | null {
  if (!path.startsWith(THEME_PUBLIC_DIRECTORY)) return null;
  const rest = path.slice(THEME_PUBLIC_DIRECTORY.length);
  return rest ? `/${rest}` : null;
}

export function isThemePublicPath(path: string): boolean {
  return path.startsWith(THEME_PUBLIC_DIRECTORY);
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Whether a file may be served from `public/`, and at which URL.
 *
 * `routePaths` are the Theme's routes as the registry names them. Only a
 * static route can be taken over: a file answering one URL a dynamic route
 * (`/$lang`, `/products/$slug`) could also serve is how Vite behaves, and
 * refusing it would refuse `favicon.ico` to every site with a `/$lang`.
 * Comparisons ignore case, since hosts and file systems disagree on it.
 */
export function checkThemePublicPath(
  path: string,
  routePaths: readonly string[] = [],
): ThemePublicPathCheck {
  const urlPath = themePublicUrlPath(path);
  if (!urlPath) return { ok: false, reason: "not-public" };
  if (!safeThemeFilePathSchema.safeParse(path).success) {
    return { ok: false, reason: "unsafe-path" };
  }
  const segments = urlPath.slice(1).split("/");
  if (segments.some((segment) => segment.startsWith("."))) {
    return { ok: false, reason: "hidden-file" };
  }
  const lowered = urlPath.toLowerCase();
  if (PLATFORM_FILE_NAMES.has(segments[segments.length - 1]!.toLowerCase())) {
    return { ok: false, reason: "platform-file" };
  }
  if (
    THEME_PUBLIC_RESERVED_URL_PREFIXES.some(
      (prefix) => lowered.startsWith(prefix) || `${lowered}/` === prefix,
    )
  ) {
    return { ok: false, reason: "reserved-prefix" };
  }
  if (
    routePaths.some(
      (route) =>
        !route.includes("$") &&
        route.replace(/\/+$/, "").toLowerCase() === lowered,
    )
  ) {
    return { ok: false, reason: "route-collision" };
  }
  const extension = extensionOf(path);
  if (extension === "svg" || extension === "svgz") {
    if (themePublicSvgGate() === "closed") {
      return { ok: false, reason: "svg-not-allowed" };
    }
    // Compressed SVG cannot be parsed before it is stored, so it stays out.
    if (extension === "svgz")
      return { ok: false, reason: "unsupported-format" };
    return { ok: true, urlPath, mimeType: SVG_MIME_TYPE };
  }
  const format = FORMATS[extension];
  const textType = themePublicTextMimeType(path);
  if (textType) return { ok: true, urlPath, mimeType: textType };
  if (!format) return { ok: false, reason: "unsupported-format" };
  return { ok: true, urlPath, mimeType: format.mimeType };
}

/**
 * Whether the bytes are the raster or font format the path says, which is
 * what the served MIME type is then taken from — never from what a client
 * claimed. False for SVG, which has no signature to match: its bytes are
 * judged by `checkThemePublicBytes`, which every write goes through.
 */
export function themePublicBytesMatch(path: string, bytes: Uint8Array) {
  const format = FORMATS[extensionOf(path)];
  return format !== undefined && format.matches(bytes);
}

export type ThemePublicSetProblem = Readonly<{
  path: string;
  reason:
    | ThemePublicPathRefusal
    | "file-too-large"
    | "svg-too-large"
    | "case-collision"
    | "too-many-files"
    | "total-too-large";
}>;

/**
 * Checks everything `public/` would hold after a change, as a whole: each
 * path, each size, the count, the total, and paths that differ only in case.
 * The limits hold for the result, so the same answer applies to an upload,
 * an import or a publish.
 */
export function checkThemePublicFiles(
  files: readonly Readonly<{ path: string; size: number }>[],
  routePaths: readonly string[] = [],
):
  | { ok: true; totalBytes: number }
  | { ok: false; problems: ThemePublicSetProblem[] } {
  const problems: ThemePublicSetProblem[] = [];
  const seen = new Map<string, string>();
  let totalBytes = 0;
  for (const file of files) {
    const check = checkThemePublicPath(file.path, routePaths);
    if (!check.ok) problems.push({ path: file.path, reason: check.reason });
    if (file.size > THEME_PUBLIC_LIMITS.maxFileBytes) {
      problems.push({ path: file.path, reason: "file-too-large" });
    } else if (
      isThemePublicSvgPath(file.path) &&
      file.size > THEME_PUBLIC_LIMITS.maxSvgBytes
    ) {
      problems.push({ path: file.path, reason: "svg-too-large" });
    }
    const folded = file.path.toLowerCase();
    const earlier = seen.get(folded);
    if (earlier !== undefined && earlier !== file.path) {
      problems.push({ path: file.path, reason: "case-collision" });
    }
    seen.set(folded, file.path);
    totalBytes += file.size;
  }
  if (files.length > THEME_PUBLIC_LIMITS.maxFiles) {
    problems.push({ path: THEME_PUBLIC_DIRECTORY, reason: "too-many-files" });
  }
  if (totalBytes > THEME_PUBLIC_LIMITS.maxTotalBytes) {
    problems.push({ path: THEME_PUBLIC_DIRECTORY, reason: "total-too-large" });
  }
  return problems.length === 0
    ? { ok: true, totalBytes }
    : { ok: false, problems };
}

/** One line an author can act on, for each reason. */
export function describeThemePublicProblem(
  reason: ThemePublicSetProblem["reason"],
): string {
  switch (reason) {
    case "not-public":
      return "Only files under public/ are served as they are.";
    case "unsafe-path":
      return "The path has characters or segments a file name cannot use.";
    case "hidden-file":
      return "Files and folders starting with a dot are not served.";
    case "platform-file":
      return "This name is reserved by the host (index.html, _headers, _redirects, …).";
    case "reserved-prefix":
      return "This URL belongs to the platform (/_morph, /assets, /_serverFn, /cdn-cgi, /api/store, /_storefront-media).";
    case "route-collision":
      return "A page of the Theme already answers this URL.";
    case "svg-not-allowed":
      return "SVG files are not supported yet; use PNG or WebP.";
    case "unsupported-format":
      return themePublicSvgGate() === "open"
        ? "Only PNG, JPEG, WebP, GIF, AVIF, ICO, SVG, WOFF, WOFF2, TXT, XML, JSON and WEBMANIFEST are supported."
        : "Only PNG, JPEG, WebP, GIF, AVIF, ICO, WOFF, WOFF2, TXT, XML, JSON and WEBMANIFEST are supported.";
    case "file-too-large":
      return `Files are limited to ${THEME_PUBLIC_LIMITS.maxFileBytes / 1024 / 1024} MB.`;
    case "svg-too-large":
      return `SVG files are limited to ${THEME_PUBLIC_LIMITS.maxSvgBytes / 1024 / 1024} MB.`;
    case "case-collision":
      return "Another file has the same path apart from letter case.";
    case "too-many-files":
      return `public/ holds at most ${THEME_PUBLIC_LIMITS.maxFiles} files.`;
    case "total-too-large":
      return `public/ holds at most ${THEME_PUBLIC_LIMITS.maxTotalBytes / 1024 / 1024} MB in total.`;
  }
}
