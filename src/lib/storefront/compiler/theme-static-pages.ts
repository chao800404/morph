import type { StorefrontThemeBuildInput } from "../dto/storefront-theme-build.dto";
import { resolveSsgPageEligibility } from "../ssg-eligibility";
import { THEME_FRAMEWORK_ROUTES } from "../theme-framework/theme-routes";
import { resolveStorefrontRenderPolicy } from "../../validations/storefront-render-policy";
import type { CanonicalThemeStaticPage } from "./theme-build-artifact-store.types";
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

  // Static pages are a TanStack Start platform-build capability. Another
  // framework, or a Start Theme built with its own build config, behaves as
  // it did before registration existed: its HTML is not registered (so Core
  // never serves it from the artifact) and its build is not refused here.
  const framework = buildInput.framework ?? "tanstack-start";
  if (framework !== "tanstack-start" || buildInput.buildMode === "native") {
    return [];
  }
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

export {
  normalizedPagePath,
  readRegisteredStaticPages,
  type RegisteredStaticPagesRead,
} from "./theme-static-page-reader";
