import {
  customerGroupCustomers,
  customerGroups,
  customers,
} from "@/db/customer.schema";
import { getDb } from "@/db";
import { firstOrNull } from "@/lib/db/single-row";
import { likeContains } from "@/lib/db/like-query";
import { chunk, chunkForInsert } from "@/lib/product/dal/d1-batch";
import type {
  CustomerGroupDetailDTO,
  CustomerGroupListItemDTO,
  CustomerGroupMemberDTO,
} from "../dto/customer-group.dto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  type SQL,
} from "drizzle-orm";

export interface CustomerGroupListParams {
  query?: string;
  sortBy: "createdAt" | "name";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
  offset?: number;
}

export interface CustomerGroupMemberListParams {
  groupId: string;
  query?: string;
  page: number;
  limit: number;
  offset?: number;
}

export const customerGroupDal = {
  async listPage(params: CustomerGroupListParams): Promise<{
    groups: CustomerGroupListItemDTO[];
    total: number;
  }> {
    const db = await getDb();
    const conditions: SQL[] = [isNull(customerGroups.deletedAt)];
    if (params.query) {
      conditions.push(likeContains(customerGroups.name, params.query)!);
    }
    const where = and(...conditions);
    const total =
      firstOrNull(
        await db.select({ total: count() }).from(customerGroups).where(where),
      )?.total ?? 0;
    const sortColumn =
      params.sortBy === "name" ? customerGroups.name : customerGroups.createdAt;
    const rows = await db
      .select({ group: customerGroups, customerCount: count(customers.id) })
      .from(customerGroups)
      .leftJoin(
        customerGroupCustomers,
        and(
          eq(customerGroupCustomers.customerGroupId, customerGroups.id),
          isNull(customerGroupCustomers.deletedAt),
        ),
      )
      .leftJoin(
        customers,
        and(
          eq(customers.id, customerGroupCustomers.customerId),
          isNull(customers.deletedAt),
        ),
      )
      .where(where)
      .groupBy(customerGroups.id)
      .orderBy(params.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn))
      .limit(params.limit)
      .offset(params.offset ?? (params.page - 1) * params.limit);

    return {
      total,
      groups: rows.map(({ group, customerCount }) => ({
        id: group.id,
        name: group.name,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        customerCount,
      })),
    };
  },

  async findById(id: string): Promise<CustomerGroupDetailDTO | null> {
    const db = await getDb();
    const group = firstOrNull(
      await db
        .select()
        .from(customerGroups)
        .where(and(eq(customerGroups.id, id), isNull(customerGroups.deletedAt)))
        .limit(1),
    );
    if (!group) return null;
    const customerCount =
      firstOrNull(
        await db
          .select({ total: count(customers.id) })
          .from(customerGroupCustomers)
          .innerJoin(
            customers,
            and(
              eq(customers.id, customerGroupCustomers.customerId),
              isNull(customers.deletedAt),
            ),
          )
          .where(
            and(
              eq(customerGroupCustomers.customerGroupId, id),
              isNull(customerGroupCustomers.deletedAt),
            ),
          ),
      )?.total ?? 0;
    return {
      id: group.id,
      name: group.name,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      customerCount,
      metadata: group.metadata,
    };
  },

  async listMembersPage(params: CustomerGroupMemberListParams): Promise<{
    customers: CustomerGroupMemberDTO[];
    total: number;
  }> {
    const db = await getDb();
    const conditions: SQL[] = [
      eq(customerGroupCustomers.customerGroupId, params.groupId),
      isNull(customerGroupCustomers.deletedAt),
      isNull(customers.deletedAt),
    ];
    if (params.query) {
      conditions.push(
        or(
          likeContains(customers.email, params.query),
          likeContains(customers.firstName, params.query),
          likeContains(customers.lastName, params.query),
          likeContains(customers.companyName, params.query),
        ) as SQL,
      );
    }
    const where = and(...conditions);
    const total =
      firstOrNull(
        await db
          .select({ total: count() })
          .from(customerGroupCustomers)
          .innerJoin(
            customers,
            eq(customers.id, customerGroupCustomers.customerId),
          )
          .where(where),
      )?.total ?? 0;
    const rows = await db
      .select({
        id: customers.id,
        email: customers.email,
        firstName: customers.firstName,
        lastName: customers.lastName,
        companyName: customers.companyName,
        createdAt: customers.createdAt,
      })
      .from(customerGroupCustomers)
      .innerJoin(customers, eq(customers.id, customerGroupCustomers.customerId))
      .where(where)
      .orderBy(asc(customers.email), asc(customers.createdAt))
      .limit(params.limit)
      .offset(params.offset ?? (params.page - 1) * params.limit);
    return { customers: rows, total };
  },

  async findActiveByName(name: string, excludeId?: string) {
    const db = await getDb();
    const conditions = [
      eq(customerGroups.name, name),
      isNull(customerGroups.deletedAt),
    ];
    if (excludeId) conditions.push(ne(customerGroups.id, excludeId));
    const rows = await db
      .select({ id: customerGroups.id })
      .from(customerGroups)
      .where(and(...conditions))
      .limit(2);
    return rows[0] ?? null;
  },

  async create(input: {
    id: string;
    name: string;
    metadata: typeof customerGroups.$inferInsert.metadata;
    createdBy: string;
    now: string;
  }) {
    const db = await getDb();
    await db.insert(customerGroups).values({
      ...input,
      createdAt: input.now,
      updatedAt: input.now,
    });
    return input.id;
  },

  async update(
    id: string,
    input: {
      name?: string;
      metadata?: typeof customerGroups.$inferInsert.metadata;
    },
    now: string,
  ) {
    const db = await getDb();
    const rows = await db
      .update(customerGroups)
      .set({ ...input, updatedAt: now })
      .where(and(eq(customerGroups.id, id), isNull(customerGroups.deletedAt)))
      .returning({ id: customerGroups.id });
    return rows.length > 0;
  },

  async softDelete(id: string, now: string) {
    const db = await getDb();
    const group = await db
      .select({ id: customerGroups.id })
      .from(customerGroups)
      .where(and(eq(customerGroups.id, id), isNull(customerGroups.deletedAt)))
      .limit(1);
    if (!group[0]) return false;
    await db.batch([
      db
        .update(customerGroupCustomers)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(customerGroupCustomers.customerGroupId, id),
            isNull(customerGroupCustomers.deletedAt),
          ),
        ),
      db
        .update(customerGroups)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(eq(customerGroups.id, id), isNull(customerGroups.deletedAt)),
        ),
    ]);
    return true;
  },

  async addCustomers(input: {
    groupId: string;
    customerIds: string[];
    createdBy: string;
    now: string;
  }): Promise<"added" | "invalid-group" | "invalid-customer"> {
    const db = await getDb();
    const group = firstOrNull(
      await db
        .select({ id: customerGroups.id })
        .from(customerGroups)
        .where(
          and(
            eq(customerGroups.id, input.groupId),
            isNull(customerGroups.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!group) return "invalid-group";
    if (input.customerIds.length === 0) return "added";
    const validCustomers = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          inArray(customers.id, input.customerIds),
          isNull(customers.deletedAt),
        ),
      );
    if (validCustomers.length !== input.customerIds.length) {
      return "invalid-customer";
    }
    const activeLinks = (
      await Promise.all(
        chunk(input.customerIds, 90).map((customerIds) =>
          db
            .select({ customerId: customerGroupCustomers.customerId })
            .from(customerGroupCustomers)
            .where(
              and(
                eq(customerGroupCustomers.customerGroupId, input.groupId),
                inArray(customerGroupCustomers.customerId, customerIds),
                isNull(customerGroupCustomers.deletedAt),
              ),
            ),
        ),
      )
    ).flat();
    const activeIds = new Set(activeLinks.map((link) => link.customerId));
    const pendingIds = input.customerIds.filter((id) => !activeIds.has(id));
    if (pendingIds.length > 0) {
      const rows = pendingIds.map((customerId) => ({
        id: crypto.randomUUID(),
        customerGroupId: input.groupId,
        customerId,
        createdBy: input.createdBy,
        createdAt: input.now,
        updatedAt: input.now,
      }));
      const statements = chunkForInsert(rows, 6).map((chunk) =>
        db.insert(customerGroupCustomers).values(chunk).onConflictDoNothing(),
      );
      const [firstStatement, ...remainingStatements] = statements;
      if (firstStatement) {
        await db.batch([firstStatement, ...remainingStatements]);
      }
    }
    return "added";
  },

  async removeCustomer(input: {
    groupId: string;
    customerId: string;
    now: string;
  }) {
    const db = await getDb();
    const result = await db
      .update(customerGroupCustomers)
      .set({ deletedAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(customerGroupCustomers.customerGroupId, input.groupId),
          eq(customerGroupCustomers.customerId, input.customerId),
          isNull(customerGroupCustomers.deletedAt),
        ),
      )
      .returning({ id: customerGroupCustomers.id });
    return result.length > 0;
  },

  async batchCustomersForGroup(input: {
    groupId: string;
    addCustomerIds: string[];
    removeCustomerIds: string[];
    createdBy: string;
    now: string;
  }): Promise<"updated" | "invalid-group" | "invalid-customer"> {
    const db = await getDb();
    const group = firstOrNull(
      await db
        .select({ id: customerGroups.id })
        .from(customerGroups)
        .where(
          and(
            eq(customerGroups.id, input.groupId),
            isNull(customerGroups.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!group) return "invalid-group";
    const customerIds = [
      ...new Set([...input.addCustomerIds, ...input.removeCustomerIds]),
    ];
    if (customerIds.length) {
      const validCustomers = await db
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(inArray(customers.id, customerIds), isNull(customers.deletedAt)),
        );
      if (validCustomers.length !== customerIds.length)
        return "invalid-customer";
    }

    const statements = [];
    if (input.removeCustomerIds.length) {
      statements.push(
        db
          .update(customerGroupCustomers)
          .set({ deletedAt: input.now, updatedAt: input.now })
          .where(
            and(
              eq(customerGroupCustomers.customerGroupId, input.groupId),
              inArray(
                customerGroupCustomers.customerId,
                input.removeCustomerIds,
              ),
              isNull(customerGroupCustomers.deletedAt),
            ),
          ),
      );
    }
    if (input.addCustomerIds.length) {
      const rows = input.addCustomerIds.map((customerId) => ({
        id: crypto.randomUUID(),
        customerGroupId: input.groupId,
        customerId,
        createdBy: input.createdBy,
        createdAt: input.now,
        updatedAt: input.now,
      }));
      statements.push(
        ...chunkForInsert(rows, 6).map((rowsChunk) =>
          db
            .insert(customerGroupCustomers)
            .values(rowsChunk)
            .onConflictDoNothing(),
        ),
      );
    }
    const [first, ...rest] = statements;
    if (first) await db.batch([first, ...rest]);
    return "updated";
  },

  async batchGroupsForCustomer(input: {
    customerId: string;
    addGroupIds: string[];
    removeGroupIds: string[];
    createdBy: string;
    now: string;
  }): Promise<"updated" | "invalid-customer" | "invalid-group"> {
    const db = await getDb();
    const customer = firstOrNull(
      await db
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(eq(customers.id, input.customerId), isNull(customers.deletedAt)),
        )
        .limit(1),
    );
    if (!customer) return "invalid-customer";
    const groupIds = [
      ...new Set([...input.addGroupIds, ...input.removeGroupIds]),
    ];
    if (groupIds.length) {
      const validGroups = await db
        .select({ id: customerGroups.id })
        .from(customerGroups)
        .where(
          and(
            inArray(customerGroups.id, groupIds),
            isNull(customerGroups.deletedAt),
          ),
        );
      if (validGroups.length !== groupIds.length) return "invalid-group";
    }

    const statements = [];
    if (input.removeGroupIds.length) {
      statements.push(
        db
          .update(customerGroupCustomers)
          .set({ deletedAt: input.now, updatedAt: input.now })
          .where(
            and(
              eq(customerGroupCustomers.customerId, input.customerId),
              inArray(
                customerGroupCustomers.customerGroupId,
                input.removeGroupIds,
              ),
              isNull(customerGroupCustomers.deletedAt),
            ),
          ),
      );
    }
    if (input.addGroupIds.length) {
      const rows = input.addGroupIds.map((customerGroupId) => ({
        id: crypto.randomUUID(),
        customerGroupId,
        customerId: input.customerId,
        createdBy: input.createdBy,
        createdAt: input.now,
        updatedAt: input.now,
      }));
      statements.push(
        ...chunkForInsert(rows, 6).map((rowsChunk) =>
          db
            .insert(customerGroupCustomers)
            .values(rowsChunk)
            .onConflictDoNothing(),
        ),
      );
    }
    const [first, ...rest] = statements;
    if (first) await db.batch([first, ...rest]);
    return "updated";
  },
};
