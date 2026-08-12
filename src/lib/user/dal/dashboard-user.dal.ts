import { and, asc, count, desc, eq, inArray, like, or } from "@/db";
import { users } from "@/db/auth.schema";
import { getDb } from "@/db";
import { containsPattern } from "@/lib/db/like-pattern";
import type {
  DashboardUserDetailDTO,
  DashboardUserListInput,
  DashboardUserPageDTO,
} from "../dto/dashboard-user.dto";
import {
  toDashboardUserDetailDTO,
  toDashboardUserDTO,
} from "../mapper/dashboard-user.mapper";

const staffRole = inArray(users.role, ["admin", "user"]);

export const dashboardUserDal = {
  async existsByEmail(email: string): Promise<boolean> {
    const db = await getDb();
    const row = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .get();
    return Boolean(row);
  },

  async listPage(input: DashboardUserListInput): Promise<DashboardUserPageDTO> {
    const db = await getDb();
    const search = input.query?.trim()
      ? or(
          like(users.name, containsPattern(input.query.trim())),
          like(users.email, containsPattern(input.query.trim())),
        )
      : undefined;
    const where = search ? and(staffRole, search) : staffRole;
    const sortColumn =
      input.sortBy === "name" ||
      input.sortBy === "firstName" ||
      input.sortBy === "lastName"
        ? users.name
        : input.sortBy === "email"
          ? users.email
          : input.sortBy === "updatedAt"
            ? users.updatedAt
            : users.createdAt;
    const order =
      input.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);
    const [{ value: total = 0 } = { value: 0 }, rows] = await Promise.all([
      db.select({ value: count() }).from(users).where(where).get(),
      db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
          role: users.role,
          banned: users.banned,
          emailVerified: users.emailVerified,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(where)
        .orderBy(order)
        .limit(input.limit)
        .offset((input.page - 1) * input.limit),
    ]);

    return { users: rows.map(toDashboardUserDTO), total };
  },

  async findStaffById(id: string): Promise<DashboardUserDetailDTO | null> {
    const db = await getDb();
    const row = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        role: users.role,
        banned: users.banned,
        emailVerified: users.emailVerified,
        language: users.language,
        phoneNumber: users.phoneNumber,
        metadata: users.metadata,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(and(staffRole, eq(users.id, id)))
      .get();

    return row ? toDashboardUserDetailDTO(row) : null;
  },

  async updateMetadata(
    id: string,
    metadata: Record<string, string>,
  ): Promise<void> {
    const db = await getDb();
    await db
      .update(users)
      .set({ metadata, updatedAt: new Date() })
      .where(and(staffRole, eq(users.id, id)));
  },
};
