import type { CanonicalThemeBuildManifest } from "../compiler/theme-build-artifact-store.types";
import { storefrontDomainDal } from "../dal/storefront-domain.dal";
import { storefrontReleaseDal } from "../dal/storefront-release.dal";
import { storefrontThemeBuildDal } from "../dal/storefront-theme-build.dal";
import { storefrontDal } from "../dal/storefront.dal";

/**
 * Every reason production hostname resolution can refuse to serve.
 * Resolution is fail-closed: an unmapped, unverified, unpublished or
 * unreleased host must never fall back to a build, a theme workspace or
 * another storefront.
 */
export type StorefrontHostFailureReason =
  | "INVALID_HOSTNAME"
  | "DOMAIN_NOT_FOUND"
  | "DOMAIN_NOT_ACTIVE"
  | "STOREFRONT_NOT_FOUND"
  | "STOREFRONT_NOT_PUBLISHED"
  | "NO_ACTIVE_RELEASE"
  | "RELEASE_BUILD_UNAVAILABLE";

export type ResolvedStorefrontHost = Readonly<{
  hostname: string;
  domainId: string;
  storefrontId: string;
  releaseId: string;
  themeId: string;
  sourceRevisionId: string;
  themeBuildId: string;
  contentPublicationId: string | null;
  artifactPrefix: string;
  manifest: CanonicalThemeBuildManifest;
}>;

export type StorefrontHostResolution =
  | { success: true; value: ResolvedStorefrontHost }
  | {
      success: false;
      reason: StorefrontHostFailureReason;
      status: number;
      message: string;
    };

const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const MAX_HOSTNAME_LENGTH = 253;

/**
 * Normalizes an untrusted `Host` header into a comparable hostname.
 * Returns `null` when the value cannot be a routable storefront hostname, so
 * callers never query storage with attacker-controlled shapes.
 */
export function normalizeStorefrontHostname(raw: string | null): string | null {
  if (!raw) return null;
  let value = raw.trim().toLowerCase();
  if (!value) return null;

  // Strip an explicit port, including bracketed IPv6 forms we do not serve.
  if (value.startsWith("[")) return null;
  const colonIndex = value.lastIndexOf(":");
  if (colonIndex !== -1) {
    const port = value.slice(colonIndex + 1);
    if (!/^\d+$/.test(port)) return null;
    value = value.slice(0, colonIndex);
  }

  value = value.replace(/\.$/, "");
  if (!value || value.length > MAX_HOSTNAME_LENGTH) return null;
  if (value.includes("..") || value.includes("_")) return null;
  if (!HOSTNAME_PATTERN.test(value)) return null;

  return value;
}

/**
 * The resolver declares its own dependency ports instead of reusing DAL
 * implementation types, so this fail-closed chain states exactly what it needs
 * and keeps the absent case visible regardless of how a DAL is later shaped.
 * Single-row DAL reads must use `firstOrNull` to stay honestly nullable.
 */
export type HostResolverDomainPort = Readonly<{
  findByHostname(hostname: string): Promise<{
    id: string;
    storefrontId: string;
    hostname: string;
    status: string;
  } | null>;
}>;

export type HostResolverStorefrontPort = Readonly<{
  findActive(id?: string): Promise<{
    id: string;
    status: string;
  } | null>;
}>;

export type HostResolverReleasePort = Readonly<{
  getActive(storefrontId: string): Promise<{
    id: string;
    themeId: string;
    sourceRevisionId: string;
    themeBuildId: string;
    contentPublicationId: string | null;
  } | null>;
}>;

export type HostResolverBuildPort = Readonly<{
  getBuildById(buildId: string): Promise<{
    id: string;
    storefrontId: string;
    themeId: string;
    status: string;
    artifactPrefix: string | null;
    manifestJson: unknown;
  } | null>;
}>;

export type StorefrontHostResolverDeps = Readonly<{
  domainDal?: HostResolverDomainPort;
  storefrontDalRef?: HostResolverStorefrontPort;
  releaseDal?: HostResolverReleasePort;
  buildDal?: HostResolverBuildPort;
}>;

function failure(
  reason: StorefrontHostFailureReason,
  status: number,
  message: string,
): StorefrontHostResolution {
  return { success: false, reason, status, message };
}

/**
 * Resolves a production hostname to the immutable artifact the edge must serve.
 *
 * Chain: hostname -> verified domain -> published storefront ->
 * `storefronts.active_release_id` -> available release -> succeeded build.
 *
 * `storefronts.active_release_id` remains the only source of truth for which
 * release is live; this resolver never infers liveness from build recency,
 * release status alone or theme workspace state.
 */
export async function resolveStorefrontHost(
  rawHostname: string | null,
  deps: StorefrontHostResolverDeps = {},
): Promise<StorefrontHostResolution> {
  const domainDal = deps.domainDal ?? storefrontDomainDal;
  const storefronts = deps.storefrontDalRef ?? storefrontDal;
  const releaseDal = deps.releaseDal ?? storefrontReleaseDal;
  const buildDal = deps.buildDal ?? storefrontThemeBuildDal;

  const hostname = normalizeStorefrontHostname(rawHostname);
  if (!hostname) {
    return failure(
      "INVALID_HOSTNAME",
      400,
      "Request host is not a routable storefront hostname.",
    );
  }

  const domain = await domainDal.findByHostname(hostname);
  if (!domain) {
    return failure(
      "DOMAIN_NOT_FOUND",
      404,
      `No storefront is attached to "${hostname}".`,
    );
  }

  if (domain.status !== "active") {
    return failure(
      "DOMAIN_NOT_ACTIVE",
      404,
      `Domain "${hostname}" is not verified for production traffic.`,
    );
  }

  const storefront = await storefronts.findActive(domain.storefrontId);
  if (!storefront) {
    return failure(
      "STOREFRONT_NOT_FOUND",
      404,
      `Storefront for "${hostname}" is unavailable.`,
    );
  }

  if (storefront.status !== "published") {
    return failure(
      "STOREFRONT_NOT_PUBLISHED",
      404,
      `Storefront for "${hostname}" is not published.`,
    );
  }

  const release = await releaseDal.getActive(storefront.id);
  if (!release) {
    return failure(
      "NO_ACTIVE_RELEASE",
      404,
      `Storefront for "${hostname}" has no active release.`,
    );
  }

  const build = await buildDal.getBuildById(release.themeBuildId);
  if (
    !build ||
    build.status !== "succeeded" ||
    !build.artifactPrefix ||
    !build.manifestJson
  ) {
    return failure(
      "RELEASE_BUILD_UNAVAILABLE",
      503,
      `Active release for "${hostname}" has no served build artifact.`,
    );
  }

  // Ownership guard: a release must never point at another storefront's build.
  if (build.storefrontId !== storefront.id || build.themeId !== release.themeId) {
    return failure(
      "RELEASE_BUILD_UNAVAILABLE",
      503,
      `Active release for "${hostname}" references a build outside the storefront.`,
    );
  }

  return {
    success: true,
    value: {
      hostname,
      domainId: domain.id,
      storefrontId: storefront.id,
      releaseId: release.id,
      themeId: release.themeId,
      sourceRevisionId: release.sourceRevisionId,
      themeBuildId: release.themeBuildId,
      contentPublicationId: release.contentPublicationId ?? null,
      artifactPrefix: build.artifactPrefix,
      manifest: build.manifestJson as CanonicalThemeBuildManifest,
    },
  };
}
