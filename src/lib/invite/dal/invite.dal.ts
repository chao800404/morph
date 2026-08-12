import { and, asc, count, desc, eq, inArray, isNull, like } from "@/db";
import { getDb } from "@/db";
import { invites } from "@/db/invite.schema";
import { containsPattern } from "@/lib/db/like-pattern";
import type {
  InviteListInput,
  InvitePageDTO,
  InviteRecordDTO,
} from "../dto/invite.dto";
import { toInviteRecordDTO } from "../mapper/invite.mapper";

const active = isNull(invites.deletedAt);

export const inviteDal = {
  async listPage(input: InviteListInput): Promise<InvitePageDTO> {
    const db = await getDb();
    const where = input.query?.trim()
      ? and(active, like(invites.email, containsPattern(input.query.trim())))
      : active;
    const sortColumn =
      input.sortBy === "email"
        ? invites.email
        : input.sortBy === "updatedAt"
          ? invites.updatedAt
          : invites.createdAt;
    const order =
      input.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);
    const [countRows, rows] = await Promise.all([
      db.select({ value: count() }).from(invites).where(where),
      db
        .select({
          id: invites.id,
          email: invites.email,
          token: invites.token,
          accepted: invites.accepted,
          expiresAt: invites.expiresAt,
          createdAt: invites.createdAt,
          updatedAt: invites.updatedAt,
        })
        .from(invites)
        .where(where)
        .orderBy(order)
        .limit(input.limit)
        .offset((input.page - 1) * input.limit),
    ]);
    return {
      invites: rows.map(toInviteRecordDTO),
      total: Number(countRows[0]?.value ?? 0),
    };
  },

  async replaceActive(input: {
    id: string;
    email: string;
    tokenHash: string;
    expiresAt: string;
  }) {
    const db = await getDb();
    const now = new Date().toISOString();
    await db.batch([
      db
        .update(invites)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(invites.email, input.email), active)),
      db.insert(invites).values({
        id: input.id,
        email: input.email,
        token: input.tokenHash,
        accepted: false,
        expiresAt: input.expiresAt,
        metadata: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    ]);
  },

  async findActiveByTokenHash(
    tokenHash: string,
  ): Promise<InviteRecordDTO | null> {
    const db = await getDb();
    const row = await db
      .select({
        id: invites.id,
        email: invites.email,
        token: invites.token,
        accepted: invites.accepted,
        expiresAt: invites.expiresAt,
        createdAt: invites.createdAt,
        updatedAt: invites.updatedAt,
      })
      .from(invites)
      .where(and(eq(invites.token, tokenHash), active))
      .get();
    return row ? toInviteRecordDTO(row) : null;
  },

  async markAccepted(id: string) {
    const db = await getDb();
    const now = new Date().toISOString();
    await db
      .update(invites)
      .set({ accepted: true, updatedAt: now })
      .where(and(eq(invites.id, id), active));
  },

  async softDelete(ids: string[]) {
    if (ids.length === 0) return;
    const db = await getDb();
    const now = new Date().toISOString();
    await db
      .update(invites)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(inArray(invites.id, ids), active));
  },
};
