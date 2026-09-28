import {
  customerAddresses,
  customerGroupCustomers,
  customerGroups,
  customers,
} from "@/db/customer.schema";
import { orders, orderSummaries } from "@/db/order.schema";
import { getDb } from "@/db";
import { firstOrNull } from "@/lib/db/single-row";
import { likeContains } from "@/lib/db/like-query";
import { totalFromOrderSnapshot } from "@/lib/order/mapper/order.mapper";
import type {
  CustomerAddressDTO,
  CustomerDetailDTO,
  CustomerGroupDTO,
  CustomerListItemDTO,
} from "../dto/customer.dto";
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
} from "drizzle-orm";

export interface CustomerListParams {
  query?: string;
  id?: string;
  email?: string;
  hasAccount?: boolean;
  sortBy: "createdAt" | "email";
  sortOrder: "asc" | "desc";
  page: number;
  limit: number;
  offset?: number;
}

const toAddressDTO = (
  address: typeof customerAddresses.$inferSelect,
): CustomerAddressDTO => ({
  id: address.id,
  customerId: address.customerId,
  addressName: address.addressName,
  isDefaultShipping: address.isDefaultShipping,
  isDefaultBilling: address.isDefaultBilling,
  company: address.company,
  firstName: address.firstName,
  lastName: address.lastName,
  address1: address.address1,
  address2: address.address2,
  city: address.city,
  countryCode: address.countryCode,
  province: address.province,
  postalCode: address.postalCode,
  phone: address.phone,
  metadata: address.metadata,
  createdAt: address.createdAt,
  updatedAt: address.updatedAt,
});

const toGroupDTO = (
  group: typeof customerGroups.$inferSelect,
): CustomerGroupDTO => ({
  id: group.id,
  name: group.name,
});

export const customerDal = {
  async listPage(params: CustomerListParams): Promise<{
    customers: CustomerListItemDTO[];
    total: number;
  }> {
    const db = await getDb();
    const filters = [isNull(customers.deletedAt)];
    if (params.id) filters.push(eq(customers.id, params.id));
    if (params.email) filters.push(eq(customers.email, params.email));
    if (params.hasAccount !== undefined)
      filters.push(eq(customers.hasAccount, params.hasAccount));
    if (params.query) {
      filters.push(
        or(
          likeContains(customers.email, params.query),
          likeContains(customers.firstName, params.query),
          likeContains(customers.lastName, params.query),
          likeContains(customers.companyName, params.query),
        )!,
      );
    }
    const where = and(...filters);
    const totalRow = firstOrNull(
      await db.select({ total: count() }).from(customers).where(where),
    );
    const sortColumn =
      params.sortBy === "email" ? customers.email : customers.createdAt;
    const rows = await db
      .select()
      .from(customers)
      .where(where)
      .orderBy(params.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn))
      .limit(params.limit)
      .offset(params.offset ?? (params.page - 1) * params.limit);

    const customerIds = rows.map((row) => row.id);
    const orderCounts = customerIds.length
      ? await db
          .select({ customerId: orders.customerId, total: count() })
          .from(orders)
          .where(
            and(
              inArray(orders.customerId, customerIds),
              isNull(orders.deletedAt),
            ),
          )
          .groupBy(orders.customerId)
      : [];
    const countByCustomerId = new Map(
      orderCounts.flatMap((row) =>
        row.customerId ? [[row.customerId, row.total] as const] : [],
      ),
    );

    return {
      total: totalRow?.total ?? 0,
      customers: rows.map((row) => ({
        id: row.id,
        email: row.email,
        firstName: row.firstName,
        lastName: row.lastName,
        companyName: row.companyName,
        phone: row.phone,
        hasAccount: row.hasAccount,
        orderCount: countByCustomerId.get(row.id) ?? 0,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    };
  },

  async findById(id: string): Promise<CustomerDetailDTO | null> {
    const db = await getDb();
    const customer = firstOrNull(
      await db
        .select()
        .from(customers)
        .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
        .limit(1),
    );
    if (!customer) return null;

    const [addresses, groups, orderRows, orderCountRow] = await Promise.all([
      db
        .select()
        .from(customerAddresses)
        .where(
          and(
            eq(customerAddresses.customerId, id),
            isNull(customerAddresses.deletedAt),
          ),
        )
        .orderBy(
          desc(customerAddresses.isDefaultShipping),
          desc(customerAddresses.isDefaultBilling),
          asc(customerAddresses.createdAt),
        ),
      db
        .select({ group: customerGroups })
        .from(customerGroupCustomers)
        .innerJoin(
          customerGroups,
          and(
            eq(customerGroups.id, customerGroupCustomers.customerGroupId),
            isNull(customerGroups.deletedAt),
          ),
        )
        .where(
          and(
            eq(customerGroupCustomers.customerId, id),
            isNull(customerGroupCustomers.deletedAt),
          ),
        )
        .orderBy(asc(customerGroups.name)),
      db
        .select({
          id: orders.id,
          displayId: orders.displayId,
          status: orders.status,
          totals: orderSummaries.totals,
          currencyCode: orders.currencyCode,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .leftJoin(
          orderSummaries,
          and(
            eq(orderSummaries.orderId, orders.id),
            eq(orderSummaries.version, orders.version),
            isNull(orderSummaries.deletedAt),
          ),
        )
        .where(and(eq(orders.customerId, id), isNull(orders.deletedAt)))
        .orderBy(desc(orders.createdAt))
        .limit(10),
      db
        .select({ total: count() })
        .from(orders)
        .where(and(eq(orders.customerId, id), isNull(orders.deletedAt))),
    ]);

    return {
      id: customer.id,
      email: customer.email,
      firstName: customer.firstName,
      lastName: customer.lastName,
      companyName: customer.companyName,
      phone: customer.phone,
      hasAccount: customer.hasAccount,
      orderCount: firstOrNull(orderCountRow)?.total ?? 0,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
      metadata: customer.metadata,
      addresses: addresses.map(toAddressDTO),
      groups: groups.map((row) => toGroupDTO(row.group)),
      recentOrders: orderRows.map(({ totals, ...order }) => ({
        ...order,
        total: totalFromOrderSnapshot(totals),
      })),
    };
  },

  async findActiveByEmail(
    email: string,
    hasAccount = false,
    excludeId?: string,
  ) {
    const db = await getDb();
    const conditions = [
      eq(customers.email, email),
      eq(customers.hasAccount, hasAccount),
      isNull(customers.deletedAt),
    ];
    if (excludeId) conditions.push(ne(customers.id, excludeId));
    const rows = await db
      .select({ id: customers.id, email: customers.email })
      .from(customers)
      .where(and(...conditions))
      .limit(2);
    return rows[0] ?? null;
  },

  async create(input: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
    phone: string | null;
    metadata: typeof customers.$inferInsert.metadata;
    createdBy: string;
    now: string;
  }) {
    const db = await getDb();
    await db.insert(customers).values({
      ...input,
      hasAccount: false,
      createdAt: input.now,
      updatedAt: input.now,
    });
    return input.id;
  },

  async update(
    id: string,
    input: {
      email?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      companyName?: string | null;
      phone?: string | null;
      metadata?: typeof customers.$inferInsert.metadata;
    },
    now: string,
  ) {
    const db = await getDb();
    const result = await db
      .update(customers)
      .set({ ...input, updatedAt: now })
      .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
      .returning({ id: customers.id });
    return result.length > 0;
  },

  async softDelete(ids: string[], now: string) {
    if (ids.length === 0) return 0;
    const db = await getDb();
    const existing = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(inArray(customers.id, ids), isNull(customers.deletedAt)));
    if (existing.length === 0) return 0;
    await db
      .update(customers)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          inArray(
            customers.id,
            existing.map((row) => row.id),
          ),
          isNull(customers.deletedAt),
        ),
      );
    return existing.length;
  },
};
