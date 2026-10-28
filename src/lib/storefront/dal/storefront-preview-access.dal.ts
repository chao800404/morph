import { getDb } from "@/db";
import { sessions, users } from "@/db/auth.schema";
import {
  storefrontPreviewAccessExchanges,
  storefrontPreviewAccessGrants,
  storefrontThemes,
} from "@/db/storefront.schema";
import type { StorefrontPreviewAccessKind } from "@/db/storefront.schema";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

/** What a consumed exchange code was issued for. */
export type PreviewAccessExchangeRecord = Readonly<{
  id: string;
  flowId: string;
  kind: StorefrontPreviewAccessKind;
  sessionId: string;
  userId: string;
  storefrontId: string;
  themeId: string;
  previewId: string;
  previewHost: string;
}>;

/** Who and what a grant or a consumed code still answers to, read together. */
export type PreviewAccessAuthorityRecord = Readonly<{
  /** The session row, or null once it is gone (signed out, revoked). */
  session: Readonly<{ userId: string; expiresAtMs: number }> | null;
  user: Readonly<{ role: string | null; banned: boolean }> | null;
  themeLive: boolean;
}>;

export type PreviewAccessGrantRecord = Readonly<{
  id: string;
  flowId: string;
  kind: StorefrontPreviewAccessKind;
  sessionId: string;
  userId: string;
  storefrontId: string;
  themeId: string;
  previewId: string;
  previewHost: string;
  expiresAt: string;
  revokedAt: string | null;
}> &
  PreviewAccessAuthorityRecord;

const exchangeColumns = {
  id: storefrontPreviewAccessExchanges.id,
  flowId: storefrontPreviewAccessExchanges.flowId,
  kind: storefrontPreviewAccessExchanges.kind,
  sessionId: storefrontPreviewAccessExchanges.sessionId,
  userId: storefrontPreviewAccessExchanges.userId,
  storefrontId: storefrontPreviewAccessExchanges.storefrontId,
  themeId: storefrontPreviewAccessExchanges.themeId,
  previewId: storefrontPreviewAccessExchanges.previewId,
  previewHost: storefrontPreviewAccessExchanges.previewHost,
};

export const storefrontPreviewAccessDal = {
  /**
   * Stores one flow's code. A flow has at most one: issuing again for a flow
   * that already has a code stores nothing and returns false.
   */
  async issueExchange(data: {
    id: string;
    flowId: string;
    codeHash: string;
    binderHash: string;
    kind: StorefrontPreviewAccessKind;
    sessionId: string;
    userId: string;
    storefrontId: string;
    themeId: string;
    previewId: string;
    previewHost: string;
    expiresAt: string;
    now: string;
  }): Promise<boolean> {
    const db = await getDb();
    const inserted = await db
      .insert(storefrontPreviewAccessExchanges)
      .values({
        id: data.id,
        flowId: data.flowId,
        codeHash: data.codeHash,
        binderHash: data.binderHash,
        kind: data.kind,
        sessionId: data.sessionId,
        userId: data.userId,
        storefrontId: data.storefrontId,
        themeId: data.themeId,
        previewId: data.previewId,
        previewHost: data.previewHost,
        expiresAt: data.expiresAt,
        createdAt: data.now,
        updatedAt: data.now,
      })
      .onConflictDoNothing({ target: storefrontPreviewAccessExchanges.flowId })
      .returning({ id: storefrontPreviewAccessExchanges.id });
    return inserted.length === 1;
  },

  /**
   * Consumes one code in a single statement, or nothing. It matches only when
   * every condition holds at once: the code, the flow the redeem names, the
   * binder the redeeming browser presented, the host and context it is redeemed on, not yet consumed, not
   * expired, and its session still signed in. A wrong binder therefore
   * consumes nothing, and of two concurrent redeems exactly one gets the row.
   */
  async consumeExchange(data: {
    flowId: string;
    codeHash: string;
    binderHash: string;
    previewHost: string;
    kind: StorefrontPreviewAccessKind;
    now: string;
  }): Promise<PreviewAccessExchangeRecord | null> {
    const db = await getDb();
    const nowMs = Date.parse(data.now);
    const [row] = await db
      .update(storefrontPreviewAccessExchanges)
      .set({ consumedAt: data.now, updatedAt: data.now })
      .where(
        and(
          eq(storefrontPreviewAccessExchanges.codeHash, data.codeHash),
          eq(storefrontPreviewAccessExchanges.flowId, data.flowId),
          eq(storefrontPreviewAccessExchanges.binderHash, data.binderHash),
          eq(storefrontPreviewAccessExchanges.previewHost, data.previewHost),
          eq(storefrontPreviewAccessExchanges.kind, data.kind),
          isNull(storefrontPreviewAccessExchanges.consumedAt),
          isNull(storefrontPreviewAccessExchanges.deletedAt),
          gt(storefrontPreviewAccessExchanges.expiresAt, data.now),
          sql`exists (select 1 from ${sessions} where ${sessions.id} = ${storefrontPreviewAccessExchanges.sessionId} and ${sessions.userId} = ${storefrontPreviewAccessExchanges.userId} and ${sessions.expiresAt} > ${nowMs})`,
        ),
      )
      .returning(exchangeColumns);
    return row ?? null;
  },

  /** The session, user and Theme a consumed code answers to, as they are now. */
  async readAuthority(data: {
    sessionId: string;
    userId: string;
    storefrontId: string;
    themeId: string;
  }): Promise<PreviewAccessAuthorityRecord> {
    const db = await getDb();
    const [session] = await db
      .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.id, data.sessionId))
      .limit(1);
    const [user] = await db
      .select({ role: users.role, banned: users.banned })
      .from(users)
      .where(eq(users.id, data.userId))
      .limit(1);
    const [theme] = await db
      .select({ id: storefrontThemes.id })
      .from(storefrontThemes)
      .where(
        and(
          eq(storefrontThemes.id, data.themeId),
          eq(storefrontThemes.storefrontId, data.storefrontId),
          isNull(storefrontThemes.deletedAt),
        ),
      )
      .limit(1);
    return {
      session: session
        ? {
            userId: session.userId,
            expiresAtMs: new Date(session.expiresAt).getTime(),
          }
        : null,
      user: user
        ? { role: user.role ?? null, banned: Boolean(user.banned) }
        : null,
      themeLive: Boolean(theme),
    };
  },

  async insertGrant(data: {
    id: string;
    flowId: string;
    tokenHash: string;
    kind: StorefrontPreviewAccessKind;
    sessionId: string;
    userId: string;
    storefrontId: string;
    themeId: string;
    previewId: string;
    previewHost: string;
    expiresAt: string;
    now: string;
  }): Promise<void> {
    const db = await getDb();
    await db.insert(storefrontPreviewAccessGrants).values({
      id: data.id,
      flowId: data.flowId,
      tokenHash: data.tokenHash,
      kind: data.kind,
      sessionId: data.sessionId,
      userId: data.userId,
      storefrontId: data.storefrontId,
      themeId: data.themeId,
      previewId: data.previewId,
      previewHost: data.previewHost,
      expiresAt: data.expiresAt,
      createdAt: data.now,
      updatedAt: data.now,
    });
  },

  /**
   * Everything one preview request is checked against, in one query: the
   * grant, its session, its user and its Theme. Left joins, so that a session,
   * user or Theme that is gone reads as missing and is refused by the caller.
   * The session is read from its table, never from a cached cookie.
   */
  async findGrantByTokenHash(
    tokenHash: string,
  ): Promise<PreviewAccessGrantRecord | null> {
    const db = await getDb();
    const [row] = await db
      .select({
        grant: storefrontPreviewAccessGrants,
        session: {
          id: sessions.id,
          userId: sessions.userId,
          expiresAt: sessions.expiresAt,
        },
        user: { id: users.id, role: users.role, banned: users.banned },
        themeId: storefrontThemes.id,
      })
      .from(storefrontPreviewAccessGrants)
      .leftJoin(
        sessions,
        eq(sessions.id, storefrontPreviewAccessGrants.sessionId),
      )
      .leftJoin(users, eq(users.id, storefrontPreviewAccessGrants.userId))
      .leftJoin(
        storefrontThemes,
        and(
          eq(storefrontThemes.id, storefrontPreviewAccessGrants.themeId),
          eq(
            storefrontThemes.storefrontId,
            storefrontPreviewAccessGrants.storefrontId,
          ),
          isNull(storefrontThemes.deletedAt),
        ),
      )
      .where(
        and(
          eq(storefrontPreviewAccessGrants.tokenHash, tokenHash),
          isNull(storefrontPreviewAccessGrants.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return null;
    const { grant, session, user } = row;
    return {
      id: grant.id,
      flowId: grant.flowId,
      kind: grant.kind,
      sessionId: grant.sessionId,
      userId: grant.userId,
      storefrontId: grant.storefrontId,
      themeId: grant.themeId,
      previewId: grant.previewId,
      previewHost: grant.previewHost,
      expiresAt: grant.expiresAt,
      revokedAt: grant.revokedAt,
      session: session?.id
        ? {
            userId: session.userId,
            expiresAtMs: new Date(session.expiresAt).getTime(),
          }
        : null,
      user: user?.id
        ? { role: user.role ?? null, banned: Boolean(user.banned) }
        : null,
      themeLive: Boolean(row.themeId),
    };
  },

  /**
   * Revokes every live grant of one session, or of one user, and says which
   * previews they were for, so that their open connections can be closed.
   */
  async revokeGrants(data: {
    sessionId?: string;
    userId?: string;
    now: string;
  }): Promise<Array<{ id: string; previewId: string; sessionId: string }>> {
    if (!data.sessionId && !data.userId) return [];
    const db = await getDb();
    return db
      .update(storefrontPreviewAccessGrants)
      .set({ revokedAt: data.now, updatedAt: data.now })
      .where(
        and(
          data.sessionId
            ? eq(storefrontPreviewAccessGrants.sessionId, data.sessionId)
            : eq(storefrontPreviewAccessGrants.userId, data.userId!),
          isNull(storefrontPreviewAccessGrants.revokedAt),
          isNull(storefrontPreviewAccessGrants.deletedAt),
        ),
      )
      .returning({
        id: storefrontPreviewAccessGrants.id,
        previewId: storefrontPreviewAccessGrants.previewId,
        sessionId: storefrontPreviewAccessGrants.sessionId,
      });
  },
};

export type StorefrontPreviewAccessDAL = typeof storefrontPreviewAccessDal;
