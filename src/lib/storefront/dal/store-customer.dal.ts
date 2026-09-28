import { getDb } from "@/db";
import { customerAddresses, customers } from "@/db/customer.schema";
import {
  orderItems,
  orderLineItems,
  orderSummaries,
  orders,
} from "@/db/order.schema";
import { toOrderItemDTO, toOrderListDTO } from "@/lib/order/mapper/order.mapper";
import { and, asc, count, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { StoreCustomerOrderPageDTO } from "../dto/store-customer.dto";

export interface StoreCustomerAddressDTO {
  id: string;
  addressName: string | null;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
  company: string | null;
  firstName: string | null;
  lastName: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  countryCode: string | null;
  province: string | null;
  postalCode: string | null;
  phone: string | null;
}

export interface StoreCustomerDTO {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  phone: string | null;
  defaultShippingAddressId: string | null;
  defaultBillingAddressId: string | null;
  addresses: StoreCustomerAddressDTO[];
}

const toAddressDTO = (
  address: typeof customerAddresses.$inferSelect,
): StoreCustomerAddressDTO => ({
  id: address.id,
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
});

const ownershipCondition = (customerId: string, email: string) =>
  or(
    eq(orders.customerId, customerId),
    eq(sql`lower(${orders.email})`, email),
  );

export const storeCustomerDal = {
  /**
   * Resolve the commerce customer only from Better Auth's verified identity.
   * The active-account email index makes concurrent first reads converge on
   * one row; an existing guest customer remains untouched.
   */
  async findOrCreateAccount(input: {
    email: string;
    name: string;
    phone: string | null;
  }) {
    const db = await getDb();
    const email = input.email.trim().toLowerCase();
    const find = async () => {
      const rows = await db
        .select({
          id: customers.id,
          email: customers.email,
          firstName: customers.firstName,
          lastName: customers.lastName,
          companyName: customers.companyName,
          phone: customers.phone,
        })
        .from(customers)
        .where(
          and(
            eq(customers.email, email),
            eq(customers.hasAccount, true),
            isNull(customers.deletedAt),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    };

    const existing = await find();
    if (existing) return existing;

    const now = new Date().toISOString();
    await db
      .insert(customers)
      .values({
        id: crypto.randomUUID(),
        email,
        firstName: input.name.trim() || null,
        lastName: null,
        companyName: null,
        phone: input.phone,
        hasAccount: true,
        metadata: {},
        createdBy: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    const createdOrConcurrent = await find();
    if (!createdOrConcurrent) {
      throw new Error("The authenticated customer account could not be created");
    }
    return createdOrConcurrent;
  },

  async getProfile(customerId: string): Promise<StoreCustomerDTO | null> {
    const db = await getDb();
    const [customer] = await db
      .select({
        id: customers.id,
        email: customers.email,
        firstName: customers.firstName,
        lastName: customers.lastName,
        companyName: customers.companyName,
        phone: customers.phone,
      })
      .from(customers)
      .where(
        and(
          eq(customers.id, customerId),
          eq(customers.hasAccount, true),
          isNull(customers.deletedAt),
        ),
      )
      .limit(1);
    if (!customer?.email) return null;

    const addresses = await this.listAddresses(customerId);
    return {
      ...customer,
      email: customer.email,
      defaultShippingAddressId:
        addresses.find((address) => address.isDefaultShipping)?.id ?? null,
      defaultBillingAddressId:
        addresses.find((address) => address.isDefaultBilling)?.id ?? null,
      addresses,
    };
  },

  async updateProfile(
    customerId: string,
    input: {
      firstName?: string | null;
      lastName?: string | null;
      companyName?: string | null;
      phone?: string | null;
    },
  ) {
    const db = await getDb();
    const result = await db
      .update(customers)
      .set({ ...input, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(customers.id, customerId),
          eq(customers.hasAccount, true),
          isNull(customers.deletedAt),
        ),
      )
      .returning({ id: customers.id });
    return result.length > 0;
  },

  async listAddresses(customerId: string): Promise<StoreCustomerAddressDTO[]> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(customerAddresses)
      .where(
        and(
          eq(customerAddresses.customerId, customerId),
          isNull(customerAddresses.deletedAt),
        ),
      )
      .orderBy(
        desc(customerAddresses.isDefaultShipping),
        desc(customerAddresses.isDefaultBilling),
        asc(customerAddresses.createdAt),
      );
    return rows.map(toAddressDTO);
  },

  async listOrders(input: {
    customerId: string;
    email: string;
    salesChannelId: string;
    limit: number;
    offset: number;
  }): Promise<StoreCustomerOrderPageDTO> {
    const db = await getDb();
    const where = and(
      isNull(orders.deletedAt),
      eq(orders.isDraftOrder, false),
      eq(orders.salesChannelId, input.salesChannelId),
      ownershipCondition(input.customerId, input.email),
    );
    const [total, rows] = await Promise.all([
      db.select({ value: count() }).from(orders).where(where),
      db
        .select({ order: orders, summary: orderSummaries.totals })
        .from(orders)
        .leftJoin(
          orderSummaries,
          and(
            eq(orderSummaries.orderId, orders.id),
            eq(orderSummaries.version, orders.version),
            isNull(orderSummaries.deletedAt),
          ),
        )
        .where(where)
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(input.limit)
        .offset(input.offset),
    ]);
    return {
      orders: rows.map(toOrderListDTO),
      count: Number(total[0]?.value ?? 0),
      offset: input.offset,
      limit: input.limit,
    };
  },

  async findOrder(input: {
    id: string;
    customerId: string;
    email: string;
    salesChannelId: string;
  }) {
    const db = await getDb();
    const [row] = await db
      .select({ order: orders, summary: orderSummaries.totals })
      .from(orders)
      .leftJoin(
        orderSummaries,
        and(
          eq(orderSummaries.orderId, orders.id),
          eq(orderSummaries.version, orders.version),
          isNull(orderSummaries.deletedAt),
        ),
      )
      .where(
        and(
          eq(orders.id, input.id),
          isNull(orders.deletedAt),
          eq(orders.isDraftOrder, false),
          eq(orders.salesChannelId, input.salesChannelId),
          ownershipCondition(input.customerId, input.email),
        ),
      )
      .limit(1);
    return row ? toOrderListDTO(row) : null;
  },

  async listOrderItems(input: {
    orderId: string;
    limit: number;
    offset: number;
  }) {
    const db = await getDb();
    const [order] = await db
      .select({ version: orders.version })
      .from(orders)
      .where(and(eq(orders.id, input.orderId), isNull(orders.deletedAt)))
      .limit(1);
    if (!order) return { items: [], count: 0 };
    const where = and(
      eq(orderItems.orderId, input.orderId),
      eq(orderItems.version, order.version),
      isNull(orderItems.deletedAt),
      isNull(orderLineItems.deletedAt),
    );
    const [total, rows] = await Promise.all([
      db
        .select({ value: count() })
        .from(orderItems)
        .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
        .where(where),
      db
        .select({ item: orderLineItems, state: orderItems })
        .from(orderItems)
        .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
        .where(where)
        .orderBy(asc(orderItems.createdAt), asc(orderItems.id))
        .limit(input.limit)
        .offset(input.offset),
    ]);
    return {
      items: rows.map(toOrderItemDTO),
      count: Number(total[0]?.value ?? 0),
    };
  },
};
