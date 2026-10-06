import { hasAnyRole } from "@/server/middleware/auth.middleware";
import { normalizeStorefrontHostname } from "../storefront-host-resolver";
import type {
  BuildPreviewCapabilityRecord,
  StorefrontBuildPreviewCapabilityDAL,
} from "../../dal/storefront-build-preview-capability.dal";

/**
 * Access to one build's isolated Build Preview.
 *
 * A capability is a random token held by one user for one build of one Theme
 * of one store, until it expires or is revoked. The browser presents it as the
 * first label of the preview host, `bp-<token>.<THEME_PREVIEW_HOSTNAME>`, so
 * the document and every sub-resource it loads carry it without a cookie and
 * without Morph's session, which never reaches a preview host.
 *
 * One label rather than a path or a deeper name: a path would be visible to
 * the Theme as its own route, and the preview host's certificate covers one
 * label under it.
 *
 * Only the token's SHA-256 is stored. Every request is verified again against
 * the stored row, the build, its Theme and the user (`verifyBuildPreviewCapability`),
 * so nothing that was true when the capability was issued is assumed later.
 */

export const BUILD_PREVIEW_HOST_PREFIX = "bp-";
export const DEFAULT_BUILD_PREVIEW_TTL_MS = 60 * 60_000;
const TOKEN_BYTES = 20;
const TOKEN_PATTERN = /^[0-9a-f]{40}$/;

export type BuildPreviewCapabilityRefusal =
  | "CAPABILITY_UNKNOWN"
  | "CAPABILITY_REVOKED"
  | "CAPABILITY_EXPIRED"
  | "BUILD_NOT_PREVIEWABLE"
  | "USER_NOT_AUTHORIZED";

export type VerifiedBuildPreviewCapability = Readonly<{
  id: string;
  storefrontId: string;
  themeId: string;
  buildId: string;
  userId: string;
  expiresAt: string;
  /** The content snapshot the build was made with; the only one it is shown. */
  contentPublicationId: string | null;
}>;

export type BuildPreviewCapabilityVerification =
  | Readonly<{ ok: true; capability: VerifiedBuildPreviewCapability }>
  | Readonly<{ ok: false; reason: BuildPreviewCapabilityRefusal }>;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function createBuildPreviewToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

export async function hashBuildPreviewToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return toHex(new Uint8Array(digest));
}

/** The host a capability is presented on. */
export function buildPreviewHostname(
  token: string,
  previewHostname: string,
): string {
  return `${BUILD_PREVIEW_HOST_PREFIX}${token}.${previewHostname}`;
}

/**
 * The token a request presents, or null when it is not addressed to a Build
 * Preview: exactly one `bp-<40 hex>` label directly under the configured
 * preview host. Read only for its shape; whether it means anything is
 * `verifyBuildPreviewCapability`'s question.
 */
export function buildPreviewTokenFromHost(
  rawHostname: string | null,
  env: Record<string, unknown> | undefined,
): string | null {
  if (!rawHostname) return null;
  const configured =
    typeof env?.THEME_PREVIEW_HOSTNAME === "string"
      ? normalizeStorefrontHostname(env.THEME_PREVIEW_HOSTNAME)
      : null;
  const host = normalizeStorefrontHostname(rawHostname);
  if (!configured || !host || !host.endsWith(`.${configured}`)) return null;
  const label = host.slice(0, host.length - configured.length - 1);
  if (!label.startsWith(BUILD_PREVIEW_HOST_PREFIX)) return null;
  const token = label.slice(BUILD_PREVIEW_HOST_PREFIX.length);
  return TOKEN_PATTERN.test(token) ? token : null;
}

function mayPreview(user: BuildPreviewCapabilityRecord["user"]): boolean {
  return Boolean(user && !user.banned && hasAnyRole(user.role, ["admin"]));
}

function isPreviewableBuild(record: BuildPreviewCapabilityRecord): boolean {
  const build = record.build;
  return Boolean(
    build &&
    record.themeLive &&
    build.status === "succeeded" &&
    build.artifactPrefix &&
    build.storefrontId === record.storefrontId &&
    build.themeId === record.themeId,
  );
}

/**
 * Issues a capability for a build the caller has already authorised the user
 * for. Checked again here all the same, with the same rules every request is
 * verified with, so that an address is never handed out that the first
 * request would refuse.
 */
export async function issueBuildPreviewCapability(input: {
  dal: StorefrontBuildPreviewCapabilityDAL;
  storefrontId: string;
  themeId: string;
  buildId: string;
  userId: string;
  now?: Date;
  ttlMs?: number;
}): Promise<
  | Readonly<{ ok: true; token: string; expiresAt: string }>
  | Readonly<{ ok: false; reason: BuildPreviewCapabilityRefusal }>
> {
  const now = input.now ?? new Date();
  const token = createBuildPreviewToken();
  const tokenHash = await hashBuildPreviewToken(token);
  const expiresAt = new Date(
    now.getTime() + (input.ttlMs ?? DEFAULT_BUILD_PREVIEW_TTL_MS),
  ).toISOString();
  await input.dal.issue({
    id: crypto.randomUUID(),
    tokenHash,
    storefrontId: input.storefrontId,
    themeId: input.themeId,
    buildId: input.buildId,
    userId: input.userId,
    expiresAt,
    now: now.toISOString(),
  });
  const verified = await verifyBuildPreviewCapability({
    dal: input.dal,
    token,
    now,
  });
  if (!verified.ok) {
    await input.dal.revoke({
      tokenHash,
      userId: input.userId,
      now: now.toISOString(),
    });
    return verified;
  }
  return { ok: true, token, expiresAt };
}

/** Checks one request's capability, from the stored row outwards. */
export async function verifyBuildPreviewCapability(input: {
  dal: StorefrontBuildPreviewCapabilityDAL;
  token: string;
  now?: Date;
}): Promise<BuildPreviewCapabilityVerification> {
  if (!TOKEN_PATTERN.test(input.token)) {
    return { ok: false, reason: "CAPABILITY_UNKNOWN" };
  }
  const record = await input.dal.findByTokenHash(
    await hashBuildPreviewToken(input.token),
  );
  if (!record) return { ok: false, reason: "CAPABILITY_UNKNOWN" };
  if (record.revokedAt) return { ok: false, reason: "CAPABILITY_REVOKED" };
  const now = input.now ?? new Date();
  if (!(now.getTime() < Date.parse(record.expiresAt))) {
    return { ok: false, reason: "CAPABILITY_EXPIRED" };
  }
  if (!mayPreview(record.user)) {
    return { ok: false, reason: "USER_NOT_AUTHORIZED" };
  }
  if (!isPreviewableBuild(record)) {
    return { ok: false, reason: "BUILD_NOT_PREVIEWABLE" };
  }
  return {
    ok: true,
    capability: {
      id: record.id,
      storefrontId: record.storefrontId,
      themeId: record.themeId,
      buildId: record.buildId,
      userId: record.userId,
      expiresAt: record.expiresAt,
      contentPublicationId: record.build?.contentPublicationId ?? null,
    },
  };
}
