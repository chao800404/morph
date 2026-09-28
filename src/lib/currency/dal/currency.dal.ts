import {
  currencies,
  storeLocales,
  storeSupportedCurrencies,
  stores,
} from "@/db/currency.schema";
import { regions } from "@/db/region.schema";
import { stockLocations } from "@/db/stock-location.schema";
import type {
  StoreAdminDTO,
  StoreAdminUpdateInput,
} from "@/lib/currency/dto/currency.dto";
import { AVAILABLE_LANGUAGES } from "@/lib/config/localization";
import { StoreSettingsError } from "@/lib/currency/store-settings-error";
import { getDb } from "@/db";
import { getCurrencyCatalog } from "@/lib/currency/catalog";
import type {
  CurrencyDTO,
  StoreCurrencySettingsDTO,
} from "@/lib/currency/dto/currency.dto";
import { chunkForInsert } from "@/lib/product/dal/d1-batch";
import { salesChannels } from "@/db/sales-channel.schema";
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { storefrontDal } from "@/lib/storefront/dal/storefront.dal";

export const DEFAULT_STORE_ID = "default";
const DEFAULT_CURRENCY_CODE = "twd";
const DEFAULT_SALES_CHANNEL_ID = "00000000-0000-4000-8000-000000000001";

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

  const [store] = await db
    .select({ defaultSalesChannelId: stores.defaultSalesChannelId })
    .from(stores)
    .where(eq(stores.id, DEFAULT_STORE_ID))
    .limit(1);
  const activeChannels = await db
    .select({ id: salesChannels.id, type: salesChannels.type })
    .from(salesChannels)
    .where(isNull(salesChannels.deletedAt))
    .orderBy(asc(salesChannels.createdAt));
  const currentDefault = store?.defaultSalesChannelId
    ? await db
        .select({ id: salesChannels.id, type: salesChannels.type })
        .from(salesChannels)
        .where(
          and(
            eq(salesChannels.id, store.defaultSalesChannelId),
            isNull(salesChannels.deletedAt),
          ),
        )
        .limit(1)
    : [];

  let storefrontChannel = activeChannels.find(
    (channel) => channel.type === "storefront",
  );

  // Older stores only had a generic default channel. Promote that channel
  // once instead of creating a duplicate Online Store beside it.
  if (!storefrontChannel && currentDefault[0]) {
    const promoted = currentDefault[0];
    await db
      .update(salesChannels)
      .set({
        type: "storefront",
        updatedAt: now,
      })
      .where(eq(salesChannels.id, promoted.id));
    storefrontChannel = { ...promoted, type: "storefront" };
  }

  if (!storefrontChannel) {
    await db
      .insert(salesChannels)
      .values({
        id: DEFAULT_SALES_CHANNEL_ID,
        name: "Online Store",
        type: "storefront",
        description: "Products published to the online storefront.",
        isDisabled: false,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: salesChannels.id,
        set: {
          type: "storefront",
          deletedAt: null,
          isDisabled: false,
          updatedAt: now,
        },
      });
    storefrontChannel = {
      id: DEFAULT_SALES_CHANNEL_ID,
      type: "storefront",
    };
  }

  const defaultSalesChannelId =
    currentDefault[0]?.id ??
    storefrontChannel.id ??
    activeChannels[0]?.id ??
    DEFAULT_SALES_CHANNEL_ID;
  if (store?.defaultSalesChannelId !== defaultSalesChannelId) {
    await db
      .update(stores)
      .set({ defaultSalesChannelId, updatedAt: now })
      .where(eq(stores.id, DEFAULT_STORE_ID));
  }

  await storefrontDal.ensureDefault(storefrontChannel.id);

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
      .orderBy(asc(storeSupportedCurrencies.isDefault), asc(currencies.code));
    const channels = await db
      .select({ id: salesChannels.id, name: salesChannels.name })
      .from(salesChannels)
      .where(isNull(salesChannels.deletedAt))
      .orderBy(asc(salesChannels.name));

    return {
      storeId: DEFAULT_STORE_ID,
      storeName: store?.name ?? "Morph store",
      defaultSalesChannelId:
        store?.defaultSalesChannelId ??
        channels[0]?.id ??
        DEFAULT_SALES_CHANNEL_ID,
      salesChannels: channels,
      supportedCurrencies: supportedCurrencies.sort(
        (left, right) => Number(right.isDefault) - Number(left.isDefault),
      ),
    };
  },

  async listAdminStores(input: { offset: number; limit: number }) {
    await ensureCurrencyData();
    const db = await getDb();
    const [rows, totalRow] = await Promise.all([
      db
        .select({ id: stores.id })
        .from(stores)
        .orderBy(asc(stores.id))
        .limit(input.limit)
        .offset(input.offset),
      db.select({ total: count() }).from(stores).get(),
    ]);
    const storeRows = await Promise.all(
      rows.map(({ id }) => this.getAdminStoreById(id)),
    );
    return {
      stores: storeRows.filter(
        (store): store is StoreAdminDTO => store !== null,
      ),
      count: totalRow?.total ?? 0,
    };
  },

  async getAdminStoreById(id: string): Promise<StoreAdminDTO | null> {
    await ensureCurrencyData();
    const db = await getDb();
    const [store] = await db
      .select()
      .from(stores)
      .where(eq(stores.id, id))
      .limit(1);
    if (!store) return null;

    const [currencyRows, localeRows] = await Promise.all([
      db
        .select({
          ...currencySelection,
          isDefault: storeSupportedCurrencies.isDefault,
          isTaxInclusive: storeSupportedCurrencies.isTaxInclusive,
          createdAt: storeSupportedCurrencies.createdAt,
          updatedAt: storeSupportedCurrencies.updatedAt,
        })
        .from(storeSupportedCurrencies)
        .innerJoin(
          currencies,
          eq(storeSupportedCurrencies.currencyCode, currencies.code),
        )
        .where(eq(storeSupportedCurrencies.storeId, id))
        .orderBy(asc(storeSupportedCurrencies.currencyCode)),
      db
        .select()
        .from(storeLocales)
        .where(eq(storeLocales.storeId, id))
        .orderBy(asc(storeLocales.localeCode)),
    ]);

    return {
      id: store.id,
      name: store.name,
      supportedCurrencies: currencyRows.map((row) => ({
        id: `${store.id}_${row.code}`,
        currencyCode: row.code,
        storeId: store.id,
        isDefault: row.isDefault,
        isTaxInclusive: row.isTaxInclusive,
        currency: {
          code: row.code,
          symbol: row.symbol,
          symbolNative: row.symbolNative,
          name: row.name,
          decimalDigits: row.decimalDigits,
          rounding: row.rounding,
        },
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      defaultSalesChannelId: store.defaultSalesChannelId,
      defaultRegionId: store.defaultRegionId,
      defaultLocationId: store.defaultLocationId,
      metadata: store.metadata ?? {},
      createdAt: store.createdAt,
      updatedAt: store.updatedAt,
      supportedLocales: localeRows.map((row) => ({
        id: `${store.id}_${row.localeCode}`,
        localeCode: row.localeCode,
        storeId: store.id,
        isDefault: row.isDefault,
        locale: {
          code: row.localeCode,
          name:
            AVAILABLE_LANGUAGES.find(
              (language) => language.code === row.localeCode,
            )?.name ?? row.localeCode,
        },
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    };
  },

  async updateAdminStore(
    id: string,
    input: StoreAdminUpdateInput,
  ): Promise<StoreAdminDTO> {
    const current = await this.getAdminStoreById(id);
    if (!current) throw new StoreSettingsError("NOT_FOUND", "Store not found");

    const db = await getDb();
    const now = new Date().toISOString();
    const updates: Partial<typeof stores.$inferInsert> = { updatedAt: now };
    if (input.name !== undefined) updates.name = input.name;
    if (input.defaultSalesChannelId !== undefined)
      updates.defaultSalesChannelId = input.defaultSalesChannelId;
    if (input.defaultRegionId !== undefined)
      updates.defaultRegionId = input.defaultRegionId;
    if (input.defaultLocationId !== undefined)
      updates.defaultLocationId = input.defaultLocationId;
    if (input.metadata !== undefined) updates.metadata = input.metadata ?? {};

    if (input.defaultSalesChannelId !== undefined) {
      const channel = await db
        .select({ id: salesChannels.id })
        .from(salesChannels)
        .where(
          and(
            eq(salesChannels.id, input.defaultSalesChannelId),
            eq(salesChannels.isDisabled, false),
            isNull(salesChannels.deletedAt),
          ),
        )
        .limit(1)
        .get();
      if (!channel)
        throw new StoreSettingsError(
          "INVALID_SALES_CHANNEL",
          "Default sales channel must be active",
        );
    }

    const regionId =
      input.defaultRegionId !== undefined
        ? input.defaultRegionId
        : current.defaultRegionId;
    const nextCurrencyCodes = new Set(
      (input.supportedCurrencies ?? current.supportedCurrencies).map(
        (currency) => currency.currencyCode.toLowerCase(),
      ),
    );
    let regionCurrencyCode: string | null = null;
    if (
      regionId &&
      (input.defaultRegionId !== undefined ||
        input.supportedCurrencies !== undefined)
    ) {
      const region = await db
        .select({ currencyCode: regions.currencyCode })
        .from(regions)
        .where(and(eq(regions.id, regionId), isNull(regions.deletedAt)))
        .limit(1)
        .get();
      if (!region)
        throw new StoreSettingsError(
          "INVALID_REGION",
          "Default region must be active",
        );
      regionCurrencyCode = region.currencyCode;
    }

    if (input.defaultLocationId) {
      const location = await db
        .select({ id: stockLocations.id })
        .from(stockLocations)
        .where(
          and(
            eq(stockLocations.id, input.defaultLocationId),
            isNull(stockLocations.deletedAt),
          ),
        )
        .limit(1)
        .get();
      if (!location)
        throw new StoreSettingsError(
          "INVALID_LOCATION",
          "Default stock location must be active",
        );
    }

    const statements: BatchItem<"sqlite">[] = [
      db.update(stores).set(updates).where(eq(stores.id, id)),
    ];

    if (input.supportedCurrencies !== undefined) {
      const currencyCodes = input.supportedCurrencies.map((currency) =>
        currency.currencyCode.toLowerCase(),
      );
      if (new Set(currencyCodes).size !== currencyCodes.length)
        throw new StoreSettingsError(
          "INVALID_CURRENCY",
          "Supported currencies cannot contain duplicates",
        );
      const catalogRows = currencyCodes.length
        ? await db
            .select({ code: currencies.code })
            .from(currencies)
            .where(inArray(currencies.code, currencyCodes))
        : [];
      if (catalogRows.length !== currencyCodes.length)
        throw new StoreSettingsError(
          "INVALID_CURRENCY",
          "One or more currencies are not in the standard catalogue",
        );
      if (input.supportedCurrencies.length === 0)
        throw new StoreSettingsError(
          "INVALID_DEFAULT",
          "A store must have at least one supported currency",
        );
      const defaultCount = input.supportedCurrencies.filter(
        (currency) => currency.isDefault,
      ).length;
      if (defaultCount !== 1)
        throw new StoreSettingsError(
          "INVALID_DEFAULT",
          "Choose exactly one default supported currency",
        );

      const nextCodes = new Set(currencyCodes);
      const removedCodes = current.supportedCurrencies
        .map((currency) => currency.currencyCode)
        .filter((code) => !nextCodes.has(code));
      if (removedCodes.length) {
        const referencedRegion = await db
          .select({ id: regions.id })
          .from(regions)
          .where(
            and(
              inArray(regions.currencyCode, removedCodes),
              isNull(regions.deletedAt),
            ),
          )
          .limit(1)
          .get();
        if (referencedRegion)
          throw new StoreSettingsError(
            "CURRENCY_IN_USE",
            "A currency used by an active region cannot be removed",
          );
      }
      const existingByCode = new Map(
        current.supportedCurrencies.map((currency) => [
          currency.currencyCode,
          currency,
        ]),
      );
      const rows = input.supportedCurrencies.map((currency, index) => {
        const currencyCode = currencyCodes[index];
        if (!currencyCode)
          throw new StoreSettingsError(
            "INVALID_CURRENCY",
            "Currency code is required",
          );
        const existing = existingByCode.get(currencyCode);
        return {
          storeId: id,
          currencyCode,
          isDefault: currency.isDefault === true,
          isTaxInclusive:
            currency.isTaxInclusive ?? existing?.isTaxInclusive ?? false,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
      });
      statements.push(
        db
          .delete(storeSupportedCurrencies)
          .where(eq(storeSupportedCurrencies.storeId, id)),
      );
      for (const group of chunkForInsert(rows, 6))
        statements.push(db.insert(storeSupportedCurrencies).values(group));
    }

    if (regionCurrencyCode && !nextCurrencyCodes.has(regionCurrencyCode))
      throw new StoreSettingsError(
        "CURRENCY_IN_USE",
        "The default region currency must be supported by the store",
      );

    if (input.supportedLocales !== undefined) {
      const localeCodes = input.supportedLocales.map((locale) =>
        locale.localeCode.trim(),
      );
      if (new Set(localeCodes).size !== localeCodes.length)
        throw new StoreSettingsError(
          "INVALID_LOCALE",
          "Supported locales cannot contain duplicates",
        );
      if (
        localeCodes.some(
          (code) =>
            !AVAILABLE_LANGUAGES.some((language) => language.code === code),
        )
      )
        throw new StoreSettingsError(
          "INVALID_LOCALE",
          "One or more locales are not enabled in the platform configuration",
        );
      const defaultCount = input.supportedLocales.filter(
        (locale) => locale.isDefault,
      ).length;
      if (input.supportedLocales.length > 0 && defaultCount !== 1)
        throw new StoreSettingsError(
          "INVALID_DEFAULT",
          "Choose exactly one default supported locale",
        );
      const existingByCode = new Map(
        current.supportedLocales.map((locale) => [locale.localeCode, locale]),
      );
      const rows = input.supportedLocales.map((locale, index) => {
        const localeCode = localeCodes[index];
        if (!localeCode)
          throw new StoreSettingsError(
            "INVALID_LOCALE",
            "Locale code is required",
          );
        const existing = existingByCode.get(localeCode);
        return {
          storeId: id,
          localeCode,
          isDefault: locale.isDefault === true,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
      });
      statements.push(
        db.delete(storeLocales).where(eq(storeLocales.storeId, id)),
      );
      for (const group of chunkForInsert(rows, 5))
        statements.push(db.insert(storeLocales).values(group));
    }

    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
    const updated = await this.getAdminStoreById(id);
    if (!updated) throw new StoreSettingsError("NOT_FOUND", "Store not found");
    return updated;
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
      throw new Error(
        "One or more currencies are not in the standard catalogue",
      );
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
    defaultSalesChannelId: string,
  ): Promise<void> {
    await ensureCurrencyData();
    const db = await getDb();
    const now = new Date().toISOString();
    const target = and(
      eq(storeSupportedCurrencies.storeId, DEFAULT_STORE_ID),
      eq(storeSupportedCurrencies.currencyCode, defaultCurrencyCode),
    );
    const [existing] = await db
      .select({ code: storeSupportedCurrencies.currencyCode })
      .from(storeSupportedCurrencies)
      .where(target)
      .limit(1);

    if (!existing) {
      throw new Error("Default currency must be enabled for this store");
    }
    const [channel] = await db
      .select({ id: salesChannels.id })
      .from(salesChannels)
      .where(
        and(
          eq(salesChannels.id, defaultSalesChannelId),
          isNull(salesChannels.deletedAt),
        ),
      )
      .limit(1);
    if (!channel) {
      throw new Error("Default sales channel must be active");
    }

    await db.batch([
      db
        .update(stores)
        .set({ name, defaultSalesChannelId, updatedAt: now })
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

  async getDefaultSalesChannelId(): Promise<string> {
    await ensureCurrencyData();
    const db = await getDb();
    const [store] = await db
      .select({ id: stores.defaultSalesChannelId })
      .from(stores)
      .where(eq(stores.id, DEFAULT_STORE_ID))
      .limit(1);
    if (!store?.id) throw new Error("Store has no default sales channel");
    return store.id;
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
