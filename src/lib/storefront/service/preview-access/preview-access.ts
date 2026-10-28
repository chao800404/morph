import type { StorefrontPreviewAccessKind } from "@/db/storefront.schema";
import type {
  PreviewAccessAuthorityRecord,
  StorefrontPreviewAccessDAL,
} from "../../dal/storefront-preview-access.dal";
import { mayPreview } from "../build-preview/build-preview-capability";

/**
 * Private Live Preview access: the exchange that turns the editor's signed-in
 * session into a credential for one preview host in one browser, and the
 * check every preview request is answered by
 * (handoff/2026-10-28/preview-access-design.md §3–§5, §8).
 *
 * - A **code** is issued to the signed-in editor for a binder hash that came
 *   from the preview frame (or tab) it opened. Redeeming it needs the binder
 *   itself, which only that browser holds, so a code obtained anywhere else
 *   cannot be redeemed, and failing to redeem it consumes nothing.
 * - A **grant** is the credential the redeeming browser then holds. It is
 *   checked again on every request against its session, user and Theme, so
 *   signing out, a ban, a role change or a removed Theme refuses the next
 *   request.
 *
 * Only SHA-256 hashes of codes, binders and tokens are stored. Authorising the
 * editor's request to issue (session, role, Theme ownership, and that the
 * preview is this user's) is the caller's: the server function that issues
 * runs behind the same middleware and helpers as `startThemePreviewServer`.
 */

export const PREVIEW_ACCESS_EXCHANGE_TTL_MS = 60_000;
export const PREVIEW_ACCESS_GRANT_MAX_MS = 12 * 60 * 60_000;
const SECRET_BYTES = 32;
const SECRET_PATTERN = /^[0-9a-f]{64}$/;

export type PreviewAccessRefusal =
  | "BINDER_INVALID"
  | "EXCHANGE_INVALID"
  | "USER_NOT_AUTHORIZED"
  | "THEME_NOT_LIVE"
  | "SESSION_ENDED"
  | "GRANT_NOT_CREATED"
  | "GRANT_UNKNOWN"
  | "GRANT_REVOKED"
  | "GRANT_EXPIRED"
  | "HOST_MISMATCH";

export type VerifiedPreviewAccessGrant = Readonly<{
  id: string;
  kind: StorefrontPreviewAccessKind;
  sessionId: string;
  userId: string;
  storefrontId: string;
  themeId: string;
  previewId: string;
  previewHost: string;
  expiresAt: string;
}>;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** A fresh random secret: a code, a binder or a grant token. */
export function createPreviewAccessSecret(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)));
}

export async function hashPreviewAccessSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return toHex(new Uint8Array(digest));
}

/** Why the authority a code or grant answers to no longer holds, or null. */
function authorityRefusal(
  authority: PreviewAccessAuthorityRecord,
  userId: string,
  nowMs: number,
): PreviewAccessRefusal | null {
  if (
    !authority.session ||
    authority.session.userId !== userId ||
    !(nowMs < authority.session.expiresAtMs)
  ) {
    return "SESSION_ENDED";
  }
  if (!mayPreview(authority.user)) return "USER_NOT_AUTHORIZED";
  if (!authority.themeLive) return "THEME_NOT_LIVE";
  return null;
}

/**
 * Issues a code for an exchange the caller has already authorised, bound to
 * the binder hash the preview frame or tab reported.
 */
export async function issuePreviewAccessExchange(input: {
  dal: StorefrontPreviewAccessDAL;
  kind: StorefrontPreviewAccessKind;
  sessionId: string;
  userId: string;
  storefrontId: string;
  themeId: string;
  previewId: string;
  previewHost: string;
  binderHash: string;
  now?: Date;
}): Promise<
  | Readonly<{ ok: true; code: string; expiresAt: string }>
  | Readonly<{ ok: false; reason: PreviewAccessRefusal }>
> {
  if (!SECRET_PATTERN.test(input.binderHash)) {
    return { ok: false, reason: "BINDER_INVALID" };
  }
  const now = input.now ?? new Date();
  const code = createPreviewAccessSecret();
  const expiresAt = new Date(
    now.getTime() + PREVIEW_ACCESS_EXCHANGE_TTL_MS,
  ).toISOString();
  await input.dal.issueExchange({
    id: crypto.randomUUID(),
    codeHash: await hashPreviewAccessSecret(code),
    binderHash: input.binderHash,
    kind: input.kind,
    sessionId: input.sessionId,
    userId: input.userId,
    storefrontId: input.storefrontId,
    themeId: input.themeId,
    previewId: input.previewId,
    previewHost: input.previewHost,
    expiresAt,
    now: now.toISOString(),
  });
  return { ok: true, code, expiresAt };
}

/**
 * Redeems a code on the preview host it was issued for, in the browser that
 * presents its binder, and creates the grant that browser will hold.
 *
 * The code is consumed before the grant is created. If the authority no
 * longer holds, or creating the grant fails, the code stays consumed and the
 * editor starts a new exchange, which needs its live session again; nothing
 * is retried here.
 */
export async function redeemPreviewAccessExchange(input: {
  dal: StorefrontPreviewAccessDAL;
  code: string;
  binder: string;
  previewHost: string;
  kind: StorefrontPreviewAccessKind;
  now?: Date;
}): Promise<
  | Readonly<{ ok: true; token: string; grant: VerifiedPreviewAccessGrant }>
  | Readonly<{ ok: false; reason: PreviewAccessRefusal }>
> {
  if (!SECRET_PATTERN.test(input.code) || !SECRET_PATTERN.test(input.binder)) {
    return { ok: false, reason: "EXCHANGE_INVALID" };
  }
  const now = input.now ?? new Date();
  const exchange = await input.dal.consumeExchange({
    codeHash: await hashPreviewAccessSecret(input.code),
    binderHash: await hashPreviewAccessSecret(input.binder),
    previewHost: input.previewHost,
    kind: input.kind,
    now: now.toISOString(),
  });
  if (!exchange) return { ok: false, reason: "EXCHANGE_INVALID" };

  const authority = await input.dal.readAuthority(exchange);
  const refusal = authorityRefusal(authority, exchange.userId, now.getTime());
  if (refusal) return { ok: false, reason: refusal };

  const token = createPreviewAccessSecret();
  const expiresAt = new Date(
    Math.min(
      authority.session!.expiresAtMs,
      now.getTime() + PREVIEW_ACCESS_GRANT_MAX_MS,
    ),
  ).toISOString();
  const grant: VerifiedPreviewAccessGrant = {
    id: crypto.randomUUID(),
    kind: exchange.kind,
    sessionId: exchange.sessionId,
    userId: exchange.userId,
    storefrontId: exchange.storefrontId,
    themeId: exchange.themeId,
    previewId: exchange.previewId,
    previewHost: exchange.previewHost,
    expiresAt,
  };
  try {
    await input.dal.insertGrant({
      ...grant,
      tokenHash: await hashPreviewAccessSecret(token),
      now: now.toISOString(),
    });
  } catch {
    return { ok: false, reason: "GRANT_NOT_CREATED" };
  }
  return { ok: true, token, grant };
}

/** Checks one preview request's credential, from the stored grant outwards. */
export async function verifyPreviewAccessGrant(input: {
  dal: StorefrontPreviewAccessDAL;
  token: string;
  previewHost: string;
  now?: Date;
}): Promise<
  | Readonly<{ ok: true; grant: VerifiedPreviewAccessGrant }>
  | Readonly<{ ok: false; reason: PreviewAccessRefusal }>
> {
  if (!SECRET_PATTERN.test(input.token)) {
    return { ok: false, reason: "GRANT_UNKNOWN" };
  }
  const record = await input.dal.findGrantByTokenHash(
    await hashPreviewAccessSecret(input.token),
  );
  if (!record) return { ok: false, reason: "GRANT_UNKNOWN" };
  if (record.revokedAt) return { ok: false, reason: "GRANT_REVOKED" };
  const nowMs = (input.now ?? new Date()).getTime();
  if (!(nowMs < Date.parse(record.expiresAt))) {
    return { ok: false, reason: "GRANT_EXPIRED" };
  }
  if (record.previewHost !== input.previewHost) {
    return { ok: false, reason: "HOST_MISMATCH" };
  }
  const refusal = authorityRefusal(record, record.userId, nowMs);
  if (refusal) return { ok: false, reason: refusal };
  return {
    ok: true,
    grant: {
      id: record.id,
      kind: record.kind,
      sessionId: record.sessionId,
      userId: record.userId,
      storefrontId: record.storefrontId,
      themeId: record.themeId,
      previewId: record.previewId,
      previewHost: record.previewHost,
      expiresAt: record.expiresAt,
    },
  };
}

/** Ends one session's grants; says which previews they were for. */
export function revokePreviewAccessForSession(input: {
  dal: StorefrontPreviewAccessDAL;
  sessionId: string;
  now?: Date;
}) {
  return input.dal.revokeGrants({
    sessionId: input.sessionId,
    now: (input.now ?? new Date()).toISOString(),
  });
}

/** Ends every grant one user holds, in every session. */
export function revokePreviewAccessForUser(input: {
  dal: StorefrontPreviewAccessDAL;
  userId: string;
  now?: Date;
}) {
  return input.dal.revokeGrants({
    userId: input.userId,
    now: (input.now ?? new Date()).toISOString(),
  });
}
