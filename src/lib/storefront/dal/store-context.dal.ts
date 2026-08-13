import { getDb } from "@/db";
import { apiKeys } from "@/db/api-key.schema";
import { stores, storeLocales } from "@/db/currency.schema";
import { publishableApiKeySalesChannels } from "@/db/link.schema";
import { regionCountries, regions } from "@/db/region.schema";
import { salesChannels } from "@/db/sales-channel.schema";
import { storefrontDomains, storefronts } from "@/db/storefront.schema";
import {
  parsePublishableKeyId,
  verifyPublishableKey,
} from "@/lib/api-key/publishable-key";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { StoreContextDTO } from "../dto/store-context.dto";

export interface ResolveStoreContextInput {
  publishableKey?: string;
  hostname?: string;
  regionId?: string;
  countryCode?: string;
}

const normalizeHostname = (hostname: string) =>
  hostname.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");

export const storeContextDal = {
  async resolve(
    input: ResolveStoreContextInput,
  ): Promise<StoreContextDTO | null> {
    const db = await getDb();
    const channelIds = new Set<string>();
    let storefrontId: string | null = null;

    if (input.publishableKey) {
      const keyId = parsePublishableKeyId(input.publishableKey);
      if (!keyId) return null;
      const [key] = await db
        .select()
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.id, keyId),
            eq(apiKeys.type, "publishable"),
            isNull(apiKeys.revokedAt),
            isNull(apiKeys.deletedAt),
          ),
        )
        .limit(1);
      if (
        !key ||
        !(await verifyPublishableKey(input.publishableKey, key.salt, key.token))
      )
        return null;
      const links = await db
        .select({
          salesChannelId: publishableApiKeySalesChannels.salesChannelId,
        })
        .from(publishableApiKeySalesChannels)
        .where(eq(publishableApiKeySalesChannels.apiKeyId, key.id));
      for (const link of links) channelIds.add(link.salesChannelId);
    }

    if (input.hostname) {
      const [domain] = await db
        .select({
          storefrontId: storefrontDomains.storefrontId,
          salesChannelId: storefronts.salesChannelId,
        })
        .from(storefrontDomains)
        .innerJoin(
          storefronts,
          eq(storefronts.id, storefrontDomains.storefrontId),
        )
        .where(
          and(
            eq(storefrontDomains.hostname, normalizeHostname(input.hostname)),
            eq(storefrontDomains.status, "active"),
            isNull(storefrontDomains.deletedAt),
            isNull(storefronts.deletedAt),
          ),
        )
        .limit(1);
      if (!domain) return null;
      storefrontId = domain.storefrontId;
      if (channelIds.size > 0 && !channelIds.has(domain.salesChannelId))
        return null;
      channelIds.clear();
      channelIds.add(domain.salesChannelId);
    }

    const [store] = await db.select().from(stores).limit(1);
    if (!store) return null;
    if (channelIds.size === 0 && store.defaultSalesChannelId)
      channelIds.add(store.defaultSalesChannelId);
    if (channelIds.size !== 1) return null;
    const salesChannelId = [...channelIds][0];
    const [channel] = await db
      .select({ id: salesChannels.id })
      .from(salesChannels)
      .where(
        and(
          eq(salesChannels.id, salesChannelId),
          eq(salesChannels.isDisabled, false),
          isNull(salesChannels.deletedAt),
        ),
      )
      .limit(1);
    if (!channel) return null;

    if (!storefrontId) {
      const [storefront] = await db
        .select({ id: storefronts.id })
        .from(storefronts)
        .where(
          and(
            eq(storefronts.salesChannelId, salesChannelId),
            eq(storefronts.status, "published"),
            isNull(storefronts.deletedAt),
          ),
        )
        .limit(1);
      storefrontId = storefront?.id ?? null;
    }

    const countryCode = input.countryCode?.trim().toLowerCase() ?? null;
    let regionId = input.regionId ?? store.defaultRegionId;
    if (countryCode) {
      const [country] = await db
        .select({ regionId: regionCountries.regionId })
        .from(regionCountries)
        .where(eq(regionCountries.iso2, countryCode))
        .limit(1);
      if (
        !country?.regionId ||
        (input.regionId && input.regionId !== country.regionId)
      )
        return null;
      regionId = country.regionId;
    }
    if (!regionId) return null;
    const [region] = await db
      .select({
        id: regions.id,
        currencyCode: regions.currencyCode,
        automaticTaxes: regions.automaticTaxes,
        isTaxInclusive: regions.isTaxInclusive,
      })
      .from(regions)
      .where(and(eq(regions.id, regionId), isNull(regions.deletedAt)))
      .limit(1);
    if (!region) return null;
    const [locale] = await db
      .select({ localeCode: storeLocales.localeCode })
      .from(storeLocales)
      .where(eq(storeLocales.storeId, store.id))
      .orderBy(desc(storeLocales.isDefault), storeLocales.localeCode)
      .limit(1);
    return {
      storeId: store.id,
      storefrontId,
      salesChannelId,
      regionId: region.id,
      currencyCode: region.currencyCode,
      automaticTaxes: region.automaticTaxes,
      isTaxInclusive: region.isTaxInclusive,
      countryCode,
      localeCode: locale?.localeCode ?? null,
    };
  },
};
