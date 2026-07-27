import {
  currencies,
  storeSupportedCurrencies,
  stores,
} from "@/db/currency.schema";
import { getDb } from "@/db";
import { getCurrencyCatalog } from "@/lib/currency/catalog";
import type {
  CurrencyDTO,
  StoreCurrencySettingsDTO,
} from "@/lib/currency/dto/currency.dto";
import { chunkForInsert } from "@/lib/product/dal/d1-batch";
import { and, asc, eq, inArray } from "drizzle-orm";

export const DEFAULT_STORE_ID = "default";
const DEFAULT_CURRENCY_CODE = "twd";

const ensureCurrencyData = async () => {
  const db = await getDb();
  const catalog = getCurrencyCatalog();

  // Six bound columns per row; chunking keeps each statement under D1's
  // 100-variable cap.
  for (const group of chunkForInsert(catalog, 6)) {
    await db
      .insert(currencies)
      .values(group)
      .onConflictDoNothing({ target: currencies.code });
  }

  const now = new Date().toISOString();
  await db
    .insert(stores)
    .values({
      id: DEFAULT_STORE_ID,
      name: "Morph store",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: stores.id });

  await db
    .insert(storeSupportedCurrencies)
    .values({
      storeId: DEFAULT_STORE_ID,
      currencyCode: DEFAULT_CURRENCY_CODE,
      isDefault: true,
      isTaxInclusive: false,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [
        storeSupportedCurrencies.storeId,
        storeSupportedCurrencies.currencyCode,
      ],
    });
};

const currencySelection = {
  code: currencies.code,
  symbol: currencies.symbol,
  symbolNative: currencies.symbolNative,
  name: currencies.name,
  decimalDigits: currencies.decimalDigits,
  rounding: currencies.rounding,
};

export const currencyDal = {
  async listAvailable(query?: string): Promise<CurrencyDTO[]> {
    await ensureCurrencyData();
    const db = await getDb();

    const rows = await db
      .select(currencySelection)
      .from(currencies)
      .orderBy(asc(currencies.code));

    const normalizedQuery = query?.trim().toLocaleLowerCase();
    if (!normalizedQuery) return rows;

    return rows.filter(
      (currency) =>
        currency.code.includes(normalizedQuery) ||
        currency.name.toLocaleLowerCase().includes(normalizedQuery),
    );
  },

  async getStoreSettings(): Promise<StoreCurrencySettingsDTO> {
    await ensureCurrencyData();
    const db = await getDb();

    const [store] = await db
      .select()
      .from(stores)
      .where(eq(stores.id, DEFAULT_STORE_ID))
      .limit(1);

    const supportedCurrencies = await db
      .select({
        ...currencySelection,
        isDefault: storeSupportedCurrencies.isDefault,
        isTaxInclusive: storeSupportedCurrencies.isTaxInclusive,
      })
      .from(storeSupportedCurrencies)
      .innerJoin(
        currencies,
        eq(storeSupportedCurrencies.currencyCode, currencies.code),
      )
      .where(eq(storeSupportedCurrencies.storeId, DEFAULT_STORE_ID))
      .orderBy(
        asc(storeSupportedCurrencies.isDefault),
        asc(currencies.code),
      );

    return {
      storeId: DEFAULT_STORE_ID,
      storeName: store?.name ?? "Morph store",
      supportedCurrencies: supportedCurrencies.sort(
        (left, right) => Number(right.isDefault) - Number(left.isDefault),
      ),
    };
  },

  async addSupported(
    codes: string[],
    taxInclusiveCodes: string[] = [],
  ): Promise<void> {
    await ensureCurrencyData();
    if (codes.length === 0) return;

    const db = await getDb();
    const valid = await db
      .select({ code: currencies.code })
      .from(currencies)
      .where(inArray(currencies.code, codes));

    if (valid.length !== codes.length) {
      throw new Error("One or more currencies are not in the standard catalogue");
    }

    const now = new Date().toISOString();
    const taxInclusive = new Set(taxInclusiveCodes);
    const rows = valid.map(({ code }) => ({
      storeId: DEFAULT_STORE_ID,
      currencyCode: code,
      isDefault: false,
      isTaxInclusive: taxInclusive.has(code),
      createdAt: now,
      updatedAt: now,
    }));
    const groups = chunkForInsert(rows, 6);
    const insertGroup = (group: typeof rows) =>
      db
        .insert(storeSupportedCurrencies)
        .values(group)
        .onConflictDoNothing({
          target: [
            storeSupportedCurrencies.storeId,
            storeSupportedCurrencies.currencyCode,
          ],
        });
    const [firstGroup, ...remainingGroups] = groups;
    if (!firstGroup) return;

    await db.batch([
      insertGroup(firstGroup),
      ...remainingGroups.map(insertGroup),
    ]);
  },

  async removeSupported(code: string): Promise<void> {
    await this.removeSupportedMany([code]);
  },

  async removeSupportedMany(codes: string[]): Promise<void> {
    await ensureCurrencyData();
    const db = await getDb();
    const uniqueCodes = [...new Set(codes)];
    const existing = await db
      .select({
        code: storeSupportedCurrencies.currencyCode,
        isDefault: storeSupportedCurrencies.isDefault,
      })
      .from(storeSupportedCurrencies)
      .where(
        and(
          eq(storeSupportedCurrencies.storeId, DEFAULT_STORE_ID),
          inArray(storeSupportedCurrencies.currencyCode, uniqueCodes),
        ),
      );

    if (existing.length !== uniqueCodes.length) {
      throw new Error("One or more currencies are not enabled for this store");
    }
    if (existing.some((currency) => currency.isDefault)) {
      throw new Error("The default currency cannot be removed");
    }

    await db
      .delete(storeSupportedCurrencies)
      .where(
        and(
          eq(storeSupportedCurrencies.storeId, DEFAULT_STORE_ID),
          inArray(storeSupportedCurrencies.currencyCode, uniqueCodes),
        ),
      );
  },

  async setDefault(code: string): Promise<void> {
    await ensureCurrencyData();
    const db = await getDb();
    const now = new Date().toISOString();
    const target = and(
      eq(storeSupportedCurrencies.storeId, DEFAULT_STORE_ID),
      eq(storeSupportedCurrencies.currencyCode, code),
    );
    const [existing] = await db
      .select({ code: storeSupportedCurrencies.currencyCode })
      .from(storeSupportedCurrencies)
      .where(target)
      .limit(1);

    if (!existing) throw new Error("Currency is not enabled for this store");

    await db.batch([
      db
        .update(storeSupportedCurrencies)
        .set({ isDefault: false, updatedAt: now })
        .where(eq(storeSupportedCurrencies.storeId, DEFAULT_STORE_ID)),
      db
        .update(storeSupportedCurrencies)
        .set({ isDefault: true, updatedAt: now })
        .where(target),
    ]);
  },

  async setTaxInclusive(code: string, isTaxInclusive: boolean): Promise<void> {
    await ensureCurrencyData();
    const db = await getDb();
    const rows = await db
      .update(storeSupportedCurrencies)
      .set({ isTaxInclusive, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(storeSupportedCurrencies.storeId, DEFAULT_STORE_ID),
          eq(storeSupportedCurrencies.currencyCode, code),
        ),
      )
      .returning({ code: storeSupportedCurrencies.currencyCode });

    if (rows.length === 0) {
      throw new Error("Currency is not enabled for this store");
    }
  },

  async updateStoreGeneral(
    name: string,
    defaultCurrencyCode: string,
  ): Promise<void> {
    await ensureCurrencyData();
    const db = await getDb();
    const now = new Date().toISOString();
    const target = and(
      eq(storeSupportedCurrencies.storeId, DEFAULT_STORE_ID),
      eq(
        storeSupportedCurrencies.currencyCode,
        defaultCurrencyCode,
      ),
    );
    const [existing] = await db
      .select({ code: storeSupportedCurrencies.currencyCode })
      .from(storeSupportedCurrencies)
      .where(target)
      .limit(1);

    if (!existing) {
      throw new Error("Default currency must be enabled for this store");
    }

    await db.batch([
      db
        .update(stores)
        .set({ name, updatedAt: now })
        .where(eq(stores.id, DEFAULT_STORE_ID)),
      db
        .update(storeSupportedCurrencies)
        .set({ isDefault: false, updatedAt: now })
        .where(eq(storeSupportedCurrencies.storeId, DEFAULT_STORE_ID)),
      db
        .update(storeSupportedCurrencies)
        .set({ isDefault: true, updatedAt: now })
        .where(target),
    ]);
  },

  async areSupported(codes: string[]): Promise<boolean> {
    if (codes.length === 0) return true;
    await ensureCurrencyData();
    const db = await getDb();
    const uniqueCodes = [...new Set(codes)];
    const rows = await db
      .select({ code: storeSupportedCurrencies.currencyCode })
      .from(storeSupportedCurrencies)
      .where(
        and(
          eq(storeSupportedCurrencies.storeId, DEFAULT_STORE_ID),
          inArray(storeSupportedCurrencies.currencyCode, uniqueCodes),
        ),
      );
    return rows.length === uniqueCodes.length;
  },
};
