import { customerAddresses, customers } from "@/db/customer.schema";
import { getDb } from "@/db";
import type { CustomerAddressDTO } from "../dto/customer.dto";
import { and, asc, count, desc, eq, isNull, type SQL } from "drizzle-orm";

export interface CustomerAddressInput {
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
  metadata?: typeof customerAddresses.$inferInsert.metadata;
}

export interface CustomerAddressListParams {
  customerId: string;
  offset: number;
  limit: number;
  company?: string;
  countryCode?: string;
}

export const customerAddressDal = {
  async listPage(params: CustomerAddressListParams): Promise<{
    addresses: CustomerAddressDTO[];
    total: number;
  } | null> {
    const db = await getDb();
    const customer = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(eq(customers.id, params.customerId), isNull(customers.deletedAt)),
      )
      .limit(1);
    if (!customer[0]) return null;

    const conditions: SQL[] = [
      eq(customerAddresses.customerId, params.customerId),
      isNull(customerAddresses.deletedAt),
    ];
    if (params.company !== undefined)
      conditions.push(eq(customerAddresses.company, params.company));
    if (params.countryCode !== undefined)
      conditions.push(eq(customerAddresses.countryCode, params.countryCode));
    const where = and(...conditions);
    const total =
      (
        await db.select({ total: count() }).from(customerAddresses).where(where)
      )[0]?.total ?? 0;
    const rows = await db
      .select()
      .from(customerAddresses)
      .where(where)
      .orderBy(
        desc(customerAddresses.isDefaultShipping),
        desc(customerAddresses.isDefaultBilling),
        asc(customerAddresses.createdAt),
      )
      .limit(params.limit)
      .offset(params.offset);
    return {
      total,
      addresses: rows.map((address) => ({
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
      })),
    };
  },

  async findById(input: {
    id: string;
    customerId: string;
  }): Promise<CustomerAddressDTO | null> {
    const db = await getDb();
    const address = (
      await db
        .select()
        .from(customerAddresses)
        .where(
          and(
            eq(customerAddresses.id, input.id),
            eq(customerAddresses.customerId, input.customerId),
            isNull(customerAddresses.deletedAt),
          ),
        )
        .limit(1)
    )[0];
    return address
      ? {
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
        }
      : null;
  },

  async create(input: {
    id: string;
    customerId: string;
    fields: CustomerAddressInput;
    now: string;
  }) {
    const db = await getDb();
    const customer = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(eq(customers.id, input.customerId), isNull(customers.deletedAt)),
      )
      .limit(1);
    if (!customer[0]) return null;

    const statements = [];
    if (input.fields.isDefaultShipping) {
      statements.push(
        db
          .update(customerAddresses)
          .set({ isDefaultShipping: false, updatedAt: input.now })
          .where(
            and(
              eq(customerAddresses.customerId, input.customerId),
              eq(customerAddresses.isDefaultShipping, true),
              isNull(customerAddresses.deletedAt),
            ),
          ),
      );
    }
    if (input.fields.isDefaultBilling) {
      statements.push(
        db
          .update(customerAddresses)
          .set({ isDefaultBilling: false, updatedAt: input.now })
          .where(
            and(
              eq(customerAddresses.customerId, input.customerId),
              eq(customerAddresses.isDefaultBilling, true),
              isNull(customerAddresses.deletedAt),
            ),
          ),
      );
    }
    const insert = db.insert(customerAddresses).values({
      id: input.id,
      customerId: input.customerId,
      ...input.fields,
      createdAt: input.now,
      updatedAt: input.now,
    });
    const [first, ...rest] = [...statements, insert];
    if (!first) return null;
    await db.batch([first, ...rest]);
    return input.id;
  },

  async update(input: {
    id: string;
    customerId: string;
    fields: Partial<CustomerAddressInput>;
    now: string;
  }) {
    const db = await getDb();
    const address = await db
      .select({ id: customerAddresses.id })
      .from(customerAddresses)
      .where(
        and(
          eq(customerAddresses.id, input.id),
          eq(customerAddresses.customerId, input.customerId),
          isNull(customerAddresses.deletedAt),
        ),
      )
      .limit(1);
    if (!address[0]) return false;

    const statements = [];
    if (input.fields.isDefaultShipping) {
      statements.push(
        db
          .update(customerAddresses)
          .set({ isDefaultShipping: false, updatedAt: input.now })
          .where(
            and(
              eq(customerAddresses.customerId, input.customerId),
              eq(customerAddresses.isDefaultShipping, true),
              isNull(customerAddresses.deletedAt),
            ),
          ),
      );
    }
    if (input.fields.isDefaultBilling) {
      statements.push(
        db
          .update(customerAddresses)
          .set({ isDefaultBilling: false, updatedAt: input.now })
          .where(
            and(
              eq(customerAddresses.customerId, input.customerId),
              eq(customerAddresses.isDefaultBilling, true),
              isNull(customerAddresses.deletedAt),
            ),
          ),
      );
    }
    const update = db
      .update(customerAddresses)
      .set({ ...input.fields, updatedAt: input.now })
      .where(
        and(
          eq(customerAddresses.id, input.id),
          eq(customerAddresses.customerId, input.customerId),
          isNull(customerAddresses.deletedAt),
        ),
      );
    const [first, ...rest] = [...statements, update];
    if (!first) return false;
    await db.batch([first, ...rest]);
    return true;
  },

  async softDelete(input: { id: string; customerId: string; now: string }) {
    const db = await getDb();
    const result = await db
      .update(customerAddresses)
      .set({ deletedAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(customerAddresses.id, input.id),
          eq(customerAddresses.customerId, input.customerId),
          isNull(customerAddresses.deletedAt),
        ),
      )
      .returning({ id: customerAddresses.id });
    return result.length > 0;
  },
};
