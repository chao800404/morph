import type {
  CanonicalThemeBuildManifest,
  CanonicalThemeStaticPage,
} from "./theme-build-artifact-store.types";
import {
  PRERENDER_CLIENT_DIRECTORY,
  prerenderedHtmlArtifactPath,
} from "./theme-prerender";

/**
 * Reading a build's registered static pages, kept apart from registering
 * them so the request path does not load the eligibility rules and the
 * Starter sources they compare against.
 */

export type RegisteredStaticPagesRead =
  | { ok: true; pages: CanonicalThemeStaticPage[] }
  | { ok: false; message: string };

const SHA256 = /^[0-9a-f]{64}$/;

function isContainedArtifactPath(path: string): boolean {
  return (
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

/**
 * The one reader of a manifest's registered pages, for Core serving and the
 * production deployment plan alike.
 *
 * Fail closed: a registration that is malformed, names a file the manifest
 * does not hold, or a hash that is not that file's is an error, never "no
 * pages" — reading it as none would hand a static page back to SSR, or
 * deploy its HTML to the Theme Worker.
 */
export function readRegisteredStaticPages(
  manifest: CanonicalThemeBuildManifest | null | undefined,
): RegisteredStaticPagesRead {
  const value = manifest?.runtime?.staticPages as unknown;
  if (value === undefined) return { ok: true, pages: [] };
  if (!Array.isArray(value)) {
    return { ok: false, message: "Registered static pages are not a list." };
  }
  const files = new Map(
    (Array.isArray(manifest?.files) ? manifest.files : []).map((file) => [
      file.path,
      file.sha256,
    ]),
  );
  const clientDirectory = manifest?.runtime?.clientAssetsDirectory;
  const pages: CanonicalThemeStaticPage[] = [];
  const seen = new Set<string>();
  const artifactPaths = new Set<string>();
  for (const entry of value as unknown[]) {
    const page = entry as Partial<CanonicalThemeStaticPage> | null;
    if (
      !page ||
      typeof page.path !== "string" ||
      !page.path.startsWith("/") ||
      typeof page.artifactPath !== "string" ||
      typeof page.sha256 !== "string" ||
      !SHA256.test(page.sha256)
    ) {
      return { ok: false, message: "A registered static page is malformed." };
    }
    // A page's HTML is exactly where the prerender writes that page, so a
    // registration cannot point one URL at another page's (or any other)
    // file.
    if (
      clientDirectory !== PRERENDER_CLIENT_DIRECTORY ||
      !isContainedArtifactPath(page.artifactPath) ||
      page.artifactPath !==
        prerenderedHtmlArtifactPath(normalizedPagePath(page.path))
    ) {
      return {
        ok: false,
        message: `Registered static page "${page.path}" does not name its own HTML file.`,
      };
    }
    if (artifactPaths.has(page.artifactPath)) {
      return {
        ok: false,
        message: `"${page.artifactPath}" is registered for more than one page.`,
      };
    }
    artifactPaths.add(page.artifactPath);
    if (files.get(page.artifactPath) !== page.sha256) {
      return {
        ok: false,
        message: `Registered static page "${page.path}" has no matching file in the build.`,
      };
    }
    const key = normalizedPagePath(page.path);
    if (seen.has(key)) {
      return {
        ok: false,
        message: `Static page "${page.path}" is registered twice.`,
      };
    }
    seen.add(key);
    pages.push({
      path: page.path,
      artifactPath: page.artifactPath,
      sha256: page.sha256,
    });
  }
  return { ok: true, pages };
}

/** `/about/` and `/about` are one page; `/` stays `/`. */
export function normalizedPagePath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}
