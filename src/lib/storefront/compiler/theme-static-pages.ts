import type { StorefrontThemeBuildInput } from "../dto/storefront-theme-build.dto";
import { resolveSsgPageEligibility } from "../ssg-eligibility";
import { THEME_FRAMEWORK_ROUTES } from "../theme-framework/theme-routes";
import { resolveStorefrontRenderPolicy } from "../../validations/storefront-render-policy";
import type {
  CanonicalThemeBuildManifest,
  CanonicalThemeStaticPage,
} from "./theme-build-artifact-store.types";
import {
  PRERENDER_CLIENT_DIRECTORY,
  prerenderedHtmlArtifactPath,
  themePrerenderOptions,
} from "./theme-prerender";

/**
 * The pages a build serves as static HTML, frozen into its canonical
 * manifest.
 *
 * Computed by the artifact store from the build's own immutable input — the
 * materialized source revision and the sealed content snapshot — and the
 * hashes the store itself took of the uploaded bytes. A runner's manifest
 * says nothing here. A release names one build, so the list a request reads
 * is always the active release's.
 *
 * Every page the sealed content asks to be static must be eligible
 * (`ssg-eligibility.ts`) and have its HTML in the build; otherwise the build
 * fails. An SSG claim is never dropped back to SSR silently.
 */
export function registerThemeStaticPages(args: {
  buildInput: StorefrontThemeBuildInput;
  clientAssetsDirectory: string | undefined;
  files: ReadonlyArray<Readonly<{ path: string; sha256: string }>>;
}): CanonicalThemeStaticPage[] {
  const { buildInput } = args;
  const snapshot = buildInput.contentSnapshot;
  if (!snapshot) return [];

  const framework = buildInput.framework ?? "tanstack-start";
  const registry = THEME_FRAMEWORK_ROUTES[framework](buildInput.files);
  if (!registry.valid) {
    if (claimsStaticHtml(snapshot)) {
      throw new Error(
        "SSG_PAGE_NOT_ELIGIBLE: The build's routes cannot be read, so no page can be verified for static HTML.",
      );
    }
    return [];
  }

  const claimed = themePrerenderOptions(snapshot, registry, true)?.pages ?? [];
  if (claimed.length === 0) return [];

  if (args.clientAssetsDirectory !== PRERENDER_CLIENT_DIRECTORY) {
    throw new Error(
      `SSG_PAGE_NOT_ELIGIBLE: Static HTML is only served from "${PRERENDER_CLIENT_DIRECTORY}".`,
    );
  }

  const hashes = new Map(args.files.map((file) => [file.path, file.sha256]));
  const pages: CanonicalThemeStaticPage[] = [];
  for (const { path } of claimed) {
    const eligibility = resolveSsgPageEligibility({
      framework,
      buildMode: buildInput.buildMode,
      files: buildInput.files,
      routePath: path,
    });
    if (!eligibility.eligible) {
      throw new Error(
        `SSG_PAGE_NOT_ELIGIBLE: ${path}: ${eligibility.code}: ${eligibility.detail}`,
      );
    }
    const artifactPath = prerenderedHtmlArtifactPath(path);
    const sha256 = hashes.get(artifactPath);
    if (!sha256) {
      throw new Error(`INCOMPLETE_SSG_ARTIFACT: Missing HTML for ${path}`);
    }
    pages.push({ path, artifactPath, sha256 });
  }
  return pages.sort((left, right) => left.path.localeCompare(right.path));
}

function claimsStaticHtml(
  snapshot: NonNullable<StorefrontThemeBuildInput["contentSnapshot"]>,
): boolean {
  return snapshot.documents.some(({ document }) => {
    if (document.websiteRenderPolicy?.mode === "ssg") return true;
    const resolved = resolveStorefrontRenderPolicy({ page: document.renderPolicy });
    return !resolved.success || resolved.policy.mode === "ssg";
  });
}

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
    if (
      !clientDirectory ||
      !isContainedArtifactPath(page.artifactPath) ||
      !page.artifactPath.startsWith(`${clientDirectory}/`) ||
      !page.artifactPath.endsWith("index.html")
    ) {
      return {
        ok: false,
        message: `Registered static page "${page.path}" is outside the client assets.`,
      };
    }
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
