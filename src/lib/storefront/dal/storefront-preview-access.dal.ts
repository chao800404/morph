import { getDb } from "@/db";
import { sessions, users } from "@/db/auth.schema";
import {
  storefrontPreviewAccessExchanges,
  storefrontPreviewAccessGrants,
  storefrontThemes,
} from "@/db/storefront.schema";
import type { StorefrontPreviewAccessKind } from "@/db/storefront.schema";
import {
  and,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

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
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
}> &
  PreviewAccessAuthorityRecord;

/** At most this many grant tokens are looked up for one request. */
const MAX_GRANT_LOOKUP = 8;

/**
 * Grants, with their session, user and Theme, in one query. Left joins, so
 * that a session, user or Theme that is gone reads as missing and is refused
 * by the caller. The session is read from its table, never from a cached
 * cookie.
 */
async function findGrantsWhere(
  match: SQL,
  limit: number,
): Promise<PreviewAccessGrantRecord[]> {
  const db = await getDb();
  const rows = await db
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
    .where(and(match, isNull(storefrontPreviewAccessGrants.deletedAt)))
    .limit(limit);
  return rows.map((row) => {
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
      createdAt: grant.createdAt,
      activatedAt: grant.activatedAt,
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
  });
}

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

  /**
   * Records which grant a consumed exchange ended in, once. Says whether it
   * did: an exchange not consumed, already resolved, or gone records nothing.
   */
  async recordResolvedGrant(data: {
    exchangeId: string;
    grantId: string;
    now: string;
  }): Promise<boolean> {
    const db = await getDb();
    const rows = await db
      .update(storefrontPreviewAccessExchanges)
      .set({ resolvedGrantId: data.grantId, updatedAt: data.now })
      .where(
        and(
          eq(storefrontPreviewAccessExchanges.id, data.exchangeId),
          isNotNull(storefrontPreviewAccessExchanges.consumedAt),
          isNull(storefrontPreviewAccessExchanges.resolvedGrantId),
          isNull(storefrontPreviewAccessExchanges.deletedAt),
        ),
      )
      .returning({ id: storefrontPreviewAccessExchanges.id });
    return rows.length === 1;
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
    const [record] = await findGrantsWhere(
      eq(storefrontPreviewAccessGrants.tokenHash, tokenHash),
      1,
    );
    return record ?? null;
  },

  /**
   * The same read for one grant by its id: a relayed socket's re-verification
   * (#214 P4). Like every read here it goes to the D1 binding itself, never a
   * Sessions API session or a read replica, so a query sent after a
   * revocation commits reads it (addendum A5, assumption 1).
   */
  async findGrantById(id: string): Promise<PreviewAccessGrantRecord | null> {
    const [record] = await findGrantsWhere(
      eq(storefrontPreviewAccessGrants.id, id),
      1,
    );
    return record ?? null;
  },

  /**
   * The same read for every candidate a preview request carries, in one
   * query. The caller bounds the list (preview-access-cookies.ts); this
   * refuses a longer one rather than splitting it, so no request costs more
   * than one statement here.
   */
  async findGrantsByTokenHashes(
    tokenHashes: readonly string[],
  ): Promise<PreviewAccessGrantRecord[]> {
    if (tokenHashes.length === 0) return [];
    if (tokenHashes.length > MAX_GRANT_LOOKUP) {
      throw new Error(
        `PREVIEW_ACCESS_LOOKUP_TOO_LARGE: at most ${MAX_GRANT_LOOKUP} grant tokens per request.`,
      );
    }
    return findGrantsWhere(
      inArray(storefrontPreviewAccessGrants.tokenHash, [...tokenHashes]),
      tokenHashes.length,
    );
  },

  /**
   * Records a grant's first use, in one statement, and says whether the grant
   * is now activated. It matches only a grant that is not revoked, has not
   * expired at `now`, and either is already activated or is still inside its
   * activation window (`created_at > activatableAfter`). The statement checks
   * all of these itself; what the caller read before is not relied on. `activated_at` keeps the first value
   * written, so of two concurrent first uses both succeed and one time is
   * kept. Nothing else changes: in particular not `expires_at`.
   */
  async activateGrant(data: {
    id: string;
    activatableAfter: string;
    now: string;
  }): Promise<boolean> {
    const db = await getDb();
    const rows = await db
      .update(storefrontPreviewAccessGrants)
      .set({
        activatedAt: sql`coalesce(${storefrontPreviewAccessGrants.activatedAt}, ${data.now})`,
      })
      .where(
        and(
          eq(storefrontPreviewAccessGrants.id, data.id),
          isNull(storefrontPreviewAccessGrants.revokedAt),
          isNull(storefrontPreviewAccessGrants.deletedAt),
          gt(storefrontPreviewAccessGrants.expiresAt, data.now),
          or(
            isNotNull(storefrontPreviewAccessGrants.activatedAt),
            gt(storefrontPreviewAccessGrants.createdAt, data.activatableAfter),
          ),
        ),
      )
      .returning({ id: storefrontPreviewAccessGrants.id });
    return rows.length === 1;
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
