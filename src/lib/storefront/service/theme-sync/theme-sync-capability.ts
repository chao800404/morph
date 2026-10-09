import { hasAnyRole } from "@/server/middleware/auth.middleware";
import type {
  StorefrontThemeSyncCapabilityDAL,
  ThemeSyncCapabilityRecord,
} from "../../dal/storefront-theme-sync-capability.dal";

/**
 * Access to one Theme's source from a developer's machine.
 *
 * A capability is a random token held by one user for one Theme of one store,
 * until it expires or is revoked. `morph-sync` presents it as a bearer token
 * on every request to the sync API. It is not a session and carries none of
 * the user's other access: the API it opens reads and writes that Theme's
 * source files and nothing else.
 *
 * Only the token's SHA-256 is stored. Every request is verified again against
 * the stored row, the Theme and the user, so a revoked token, a deleted Theme
 * or an admin who lost the role is refused on the next request — the same
 * rules as a Build Preview capability (`build-preview-capability.ts`).
 *
 * The prefix makes a leaked token recognisable to a secret scanner and to a
 * person reading a log.
 */

export const THEME_SYNC_TOKEN_PREFIX = "mts_";
/**
 * One token for the length of a prototype session. The design keeps a short
 * access token with a refresh token (docs/local-code-sync.md); until that
 * exists a re-issue from the editor replaces this one.
 */
export const DEFAULT_THEME_SYNC_TTL_MS = 30 * 24 * 60 * 60_000;
const TOKEN_BYTES = 20;
const TOKEN_PATTERN = /^mts_[0-9a-f]{40}$/;

export type ThemeSyncCapabilityRefusal =
  | "CAPABILITY_UNKNOWN"
  | "CAPABILITY_REVOKED"
  | "CAPABILITY_EXPIRED"
  | "THEME_NOT_AVAILABLE"
  | "USER_NOT_AUTHORIZED";

export type VerifiedThemeSyncCapability = Readonly<{
  id: string;
  storefrontId: string;
  themeId: string;
  userId: string;
  expiresAt: string;
}>;

export type ThemeSyncCapabilityVerification =
  | Readonly<{ ok: true; capability: VerifiedThemeSyncCapability }>
  | Readonly<{ ok: false; reason: ThemeSyncCapabilityRefusal }>;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function createThemeSyncToken(): string {
  return `${THEME_SYNC_TOKEN_PREFIX}${toHex(
    crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)),
  )}`;
}

export async function hashThemeSyncToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return toHex(new Uint8Array(digest));
}

/**
 * The token a request presents as `Authorization: Bearer mts_…`, or null.
 * Read only for its shape; whether it means anything is
 * `verifyThemeSyncCapability`'s question.
 */
export function themeSyncTokenFromAuthorization(
  authorization: string | null,
): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? "");
  const token = match?.[1] ?? null;
  return token && TOKEN_PATTERN.test(token) ? token : null;
}

/** Who may hold one: the role that may write Theme files in the editor. */
function maySync(user: ThemeSyncCapabilityRecord["user"]): boolean {
  return Boolean(user && !user.banned && hasAnyRole(user.role, ["admin"]));
}

/**
 * Issues a capability for a Theme the caller has already authorised the user
 * for. Checked again here all the same, with the rules every request is
 * verified with, so a token is never handed out that the first request would
 * refuse.
 */
export async function issueThemeSyncCapability(input: {
  dal: StorefrontThemeSyncCapabilityDAL;
  storefrontId: string;
  themeId: string;
  userId: string;
  now?: Date;
  ttlMs?: number;
}): Promise<
  | Readonly<{ ok: true; token: string; expiresAt: string }>
  | Readonly<{ ok: false; reason: ThemeSyncCapabilityRefusal }>
> {
  const now = input.now ?? new Date();
  const token = createThemeSyncToken();
  const tokenHash = await hashThemeSyncToken(token);
  const expiresAt = new Date(
    now.getTime() + (input.ttlMs ?? DEFAULT_THEME_SYNC_TTL_MS),
  ).toISOString();
  await input.dal.issue({
    id: crypto.randomUUID(),
    tokenHash,
    storefrontId: input.storefrontId,
    themeId: input.themeId,
    userId: input.userId,
    expiresAt,
    now: now.toISOString(),
  });
  const verified = await verifyThemeSyncCapability({
    dal: input.dal,
    token,
    now,
  });
  if (!verified.ok) {
    await input.dal.revoke({ tokenHash, now: now.toISOString() });
    return verified;
  }
  return { ok: true, token, expiresAt };
}

/** Checks one request's capability, from the stored row outwards. */
export async function verifyThemeSyncCapability(input: {
  dal: StorefrontThemeSyncCapabilityDAL;
  token: string;
  now?: Date;
}): Promise<ThemeSyncCapabilityVerification> {
  if (!TOKEN_PATTERN.test(input.token)) {
    return { ok: false, reason: "CAPABILITY_UNKNOWN" };
  }
  const record = await input.dal.findByTokenHash(
    await hashThemeSyncToken(input.token),
  );
  if (!record) return { ok: false, reason: "CAPABILITY_UNKNOWN" };
  if (record.revokedAt) return { ok: false, reason: "CAPABILITY_REVOKED" };
  const now = input.now ?? new Date();
  if (!(now.getTime() < Date.parse(record.expiresAt))) {
    return { ok: false, reason: "CAPABILITY_EXPIRED" };
  }
  if (!maySync(record.user)) {
    return { ok: false, reason: "USER_NOT_AUTHORIZED" };
  }
  if (!record.themeLive) return { ok: false, reason: "THEME_NOT_AVAILABLE" };
  return {
    ok: true,
    capability: {
      id: record.id,
      storefrontId: record.storefrontId,
      themeId: record.themeId,
      userId: record.userId,
      expiresAt: record.expiresAt,
    },
  };
}
