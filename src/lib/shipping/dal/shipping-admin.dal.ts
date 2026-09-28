import { getDb } from "@/db";
import type { JsonValue } from "@/db/json";
import { cartShippingMethods, carts } from "@/db/cart.schema";
import {
  fulfillmentProviders,
  fulfillmentSets,
  geoZones,
  serviceZones,
  shippingOptionRules,
  shippingOptionTypes,
  shippingOptions,
  shippingProfiles,
} from "@/db/fulfillment.schema";
import { priceSets, prices } from "@/db/pricing.schema";
import {
  locationFulfillmentSets,
  shippingOptionPriceSets,
} from "@/db/link.schema";
import { stockLocations } from "@/db/stock-location.schema";
import { chunkForInsert } from "@/lib/product/dal/d1-batch";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type {
  ShippingAdminGeoZoneInput,
  ShippingAdminOptionDTO,
  ShippingAdminRuleDTO,
  ShippingAdminZoneDTO,
} from "../dto/shipping-admin.dto";
import { batchGuard } from "@/lib/db/batch-guard";

const GEO_ZONE_COLUMNS = 11;
const PRICE_COLUMNS = 12;
const RULE_COLUMNS = 8;

export const shippingAdminDal = {
  async listForLocation(locationId: string): Promise<ShippingAdminZoneDTO[]> {
    const db = await getDb();
    const zoneRows = await db
      .select({ zone: serviceZones })
      .from(serviceZones)
      .innerJoin(
        fulfillmentSets,
        and(
          eq(fulfillmentSets.id, serviceZones.fulfillmentSetId),
          eq(fulfillmentSets.type, "shipping"),
          isNull(fulfillmentSets.deletedAt),
        ),
      )
      .innerJoin(
        locationFulfillmentSets,
        eq(locationFulfillmentSets.fulfillmentSetId, fulfillmentSets.id),
      )
      .where(
        and(
          eq(locationFulfillmentSets.stockLocationId, locationId),
          isNull(serviceZones.deletedAt),
        ),
      )
      .orderBy(asc(serviceZones.name));
    const zones = zoneRows.map((row) => row.zone);
    if (!zones.length) return [];

    const zoneIds = zones.map((zone) => zone.id);
    const [geoRows, optionRows] = await Promise.all([
      db
        .select({ geoZone: geoZones })
        .from(geoZones)
        .where(
          and(
            inArray(geoZones.serviceZoneId, zoneIds),
            isNull(geoZones.deletedAt),
          ),
        )
        .orderBy(
          asc(geoZones.countryCode),
          asc(geoZones.provinceCode),
          asc(geoZones.city),
        ),
      db
        .select({ option: shippingOptions, optionType: shippingOptionTypes })
        .from(shippingOptions)
        .leftJoin(
          shippingOptionTypes,
          and(
            eq(shippingOptionTypes.id, shippingOptions.shippingOptionTypeId),
            isNull(shippingOptionTypes.deletedAt),
          ),
        )
        .where(
          and(
            inArray(shippingOptions.serviceZoneId, zoneIds),
            isNull(shippingOptions.deletedAt),
          ),
        )
        .orderBy(asc(shippingOptions.name)),
    ]);
    const options = optionRows.map((row) => row.option);
    const optionTypesByOptionId = new Map(
      optionRows.map((row) => [row.option.id, row.optionType]),
    );
    const optionIds = options.map((option) => option.id);
    const profileIds = [
      ...new Set(
        options.flatMap((option) =>
          option.shippingProfileId ? [option.shippingProfileId] : [],
        ),
      ),
    ];
    const [profileRows, priceLinks, ruleRows] = await Promise.all([
      profileIds.length
        ? db
            .select({ id: shippingProfiles.id, name: shippingProfiles.name })
            .from(shippingProfiles)
            .where(
              and(
                inArray(shippingProfiles.id, profileIds),
                isNull(shippingProfiles.deletedAt),
              ),
            )
        : [],
      optionIds.length
        ? db
            .select({
              optionId: shippingOptionPriceSets.shippingOptionId,
              priceSetId: shippingOptionPriceSets.priceSetId,
            })
            .from(shippingOptionPriceSets)
            .where(inArray(shippingOptionPriceSets.shippingOptionId, optionIds))
        : [],
      optionIds.length
        ? db
            .select()
            .from(shippingOptionRules)
            .where(
              and(
                inArray(shippingOptionRules.shippingOptionId, optionIds),
                isNull(shippingOptionRules.deletedAt),
              ),
            )
            .orderBy(
              asc(shippingOptionRules.createdAt),
              asc(shippingOptionRules.id),
            )
        : [],
    ]);
    const priceSetIds = [...new Set(priceLinks.map((link) => link.priceSetId))];
    const priceRows = priceSetIds.length
      ? await db
          .select({
            priceSetId: prices.priceSetId,
            currencyCode: prices.currencyCode,
            amount: prices.amount,
          })
          .from(prices)
          .where(
            and(
              inArray(prices.priceSetId, priceSetIds),
              isNull(prices.priceListId),
              isNull(prices.deletedAt),
            ),
          )
          .orderBy(asc(prices.currencyCode))
      : [];
    const profileNames = new Map(
      profileRows.map((profile) => [profile.id, profile.name]),
    );
    const pricesByOption = new Map<string, ShippingAdminOptionDTO["prices"]>();
    for (const link of priceLinks) {
      const current = pricesByOption.get(link.optionId) ?? [];
      current.push(
        ...priceRows
          .filter((price) => price.priceSetId === link.priceSetId)
          .map((price) => ({
            currencyCode: price.currencyCode,
            amount: price.amount,
          })),
      );
      pricesByOption.set(link.optionId, current);
    }
    const optionsByZone = new Map<string, ShippingAdminOptionDTO[]>();
    const rulesByOption = new Map<string, ShippingAdminOptionDTO["rules"]>();
    for (const rule of ruleRows) {
      const current = rulesByOption.get(rule.shippingOptionId) ?? [];
      current.push({
        attribute:
          rule.attribute as ShippingAdminOptionDTO["rules"][number]["attribute"],
        operator:
          rule.operator as ShippingAdminOptionDTO["rules"][number]["operator"],
        value: rule.value ?? "",
      });
      rulesByOption.set(rule.shippingOptionId, current);
    }
    for (const option of options) {
      const current = optionsByZone.get(option.serviceZoneId) ?? [];
      const optionType = optionTypesByOptionId.get(option.id);
      current.push({
        id: option.id,
        name: option.name,
        updatedAt: option.updatedAt,
        providerId: option.providerId,
        priceType: option.priceType,
        providerData: option.data,
        shippingProfileId: option.shippingProfileId,
        shippingProfileName: option.shippingProfileId
          ? (profileNames.get(option.shippingProfileId) ?? null)
          : null,
        shippingOptionTypeId: option.shippingOptionTypeId,
        shippingOptionTypeLabel: optionType?.label ?? null,
        shippingOptionTypeCode: optionType?.code ?? null,
        rules: rulesByOption.get(option.id) ?? [],
        prices: pricesByOption.get(option.id) ?? [],
      });
      optionsByZone.set(option.serviceZoneId, current);
    }
    const geoZonesByZone = new Map<string, ShippingAdminZoneDTO["geoZones"]>();
    for (const { geoZone } of geoRows) {
      const current = geoZonesByZone.get(geoZone.serviceZoneId) ?? [];
      current.push({
        id: geoZone.id,
        type: geoZone.type,
        countryCode: geoZone.countryCode,
        provinceCode: geoZone.provinceCode,
        city: geoZone.city,
        postalExpression: geoZone.postalExpression,
      });
      geoZonesByZone.set(geoZone.serviceZoneId, current);
    }

    return zones.map((zone) => {
      const zoneGeoZones = geoZonesByZone.get(zone.id) ?? [];
      return {
        id: zone.id,
        name: zone.name,
        updatedAt: zone.updatedAt,
        countries: [
          ...new Set(zoneGeoZones.map((geoZone) => geoZone.countryCode)),
        ],
        geoZones: zoneGeoZones,
        options: optionsByZone.get(zone.id) ?? [],
      };
    });
  },

  async findActiveZoneByName(
    name: string,
    excludingId?: string,
  ): Promise<boolean> {
    const db = await getDb();
    const rows = await db
      .select({ id: serviceZones.id })
      .from(serviceZones)
      .where(
        and(
          eq(serviceZones.name, name),
          isNull(serviceZones.deletedAt),
          ...(excludingId ? [ne(serviceZones.id, excludingId)] : []),
        ),
      )
      .limit(1);
    return rows.length > 0;
  },

  async updateShippingOption(input: {
    locationId: string;
    optionId: string;
    expectedOptionUpdatedAt: string;
    expectedZoneUpdatedAt: string;
    zoneName: string;
    geoZones: ShippingAdminGeoZoneInput[];
    optionName: string;
    shippingProfileId: string;
    shippingOptionTypeId: string | null;
    priceType: "flat" | "calculated";
    providerData: Record<string, JsonValue>;
    rules: ShippingAdminRuleDTO[];
    prices: Array<{ id: string; currencyCode: string; amount: number }>;
    now: string;
  }): Promise<boolean> {
    const db = await getDb();
    const [ownership] = await db
      .select({ zone: serviceZones, option: shippingOptions })
      .from(shippingOptions)
      .innerJoin(
        serviceZones,
        and(
          eq(serviceZones.id, shippingOptions.serviceZoneId),
          isNull(serviceZones.deletedAt),
        ),
      )
      .innerJoin(
        fulfillmentSets,
        and(
          eq(fulfillmentSets.id, serviceZones.fulfillmentSetId),
          eq(fulfillmentSets.type, "shipping"),
          isNull(fulfillmentSets.deletedAt),
        ),
      )
      .innerJoin(
        locationFulfillmentSets,
        eq(locationFulfillmentSets.fulfillmentSetId, fulfillmentSets.id),
      )
      .where(
        and(
          eq(shippingOptions.id, input.optionId),
          eq(locationFulfillmentSets.stockLocationId, input.locationId),
          isNull(shippingOptions.deletedAt),
        ),
      )
      .limit(1);
    if (!ownership) return false;

    const links = await db
      .select({ priceSetId: shippingOptionPriceSets.priceSetId })
      .from(shippingOptionPriceSets)
      .where(eq(shippingOptionPriceSets.shippingOptionId, input.optionId));
    const priceSetId = links[0]?.priceSetId ?? crypto.randomUUID();
    const shippingTypeGuard = input.shippingOptionTypeId
      ? sql`EXISTS (
          SELECT 1 FROM shipping_option_types
          WHERE id = ${input.shippingOptionTypeId} AND deleted_at IS NULL
        )`
      : sql`1 = 1`;
    const statements: BatchItem<"sqlite">[] = [
      batchGuard(
        db,
        sql`EXISTS (
          SELECT 1
          FROM shipping_options AS option
          JOIN service_zones AS zone ON zone.id = option.service_zone_id
          JOIN fulfillment_sets AS fulfillment_set ON fulfillment_set.id = zone.fulfillment_set_id
          JOIN location_fulfillment_sets AS link ON link.fulfillment_set_id = fulfillment_set.id
          WHERE option.id = ${input.optionId}
            AND option.updated_at = ${input.expectedOptionUpdatedAt}
            AND option.deleted_at IS NULL
            AND zone.id = ${ownership.zone.id}
            AND zone.updated_at = ${input.expectedZoneUpdatedAt}
            AND zone.deleted_at IS NULL
            AND fulfillment_set.type = 'shipping'
            AND fulfillment_set.deleted_at IS NULL
            AND link.stock_location_id = ${input.locationId}
        ) AND ${shippingTypeGuard} AND EXISTS (
          SELECT 1 FROM shipping_profiles
          WHERE id = ${input.shippingProfileId} AND deleted_at IS NULL
        )`,
      ),
      db
        .update(serviceZones)
        .set({ name: input.zoneName, updatedAt: input.now })
        .where(
          and(
            eq(serviceZones.id, ownership.zone.id),
            eq(serviceZones.updatedAt, input.expectedZoneUpdatedAt),
            isNull(serviceZones.deletedAt),
          ),
        ),
      db
        .update(shippingOptions)
        .set({
          name: input.optionName,
          shippingProfileId: input.shippingProfileId,
          shippingOptionTypeId: input.shippingOptionTypeId,
          data: input.providerData,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(shippingOptions.id, input.optionId),
            eq(shippingOptions.updatedAt, input.expectedOptionUpdatedAt),
            isNull(shippingOptions.deletedAt),
          ),
        ),
      db
        .update(shippingOptionRules)
        .set({ deletedAt: input.now, updatedAt: input.now })
        .where(
          and(
            eq(shippingOptionRules.shippingOptionId, input.optionId),
            isNull(shippingOptionRules.deletedAt),
          ),
        ),
      db
        .update(geoZones)
        .set({ deletedAt: input.now, updatedAt: input.now })
        .where(
          and(
            eq(geoZones.serviceZoneId, ownership.zone.id),
            isNull(geoZones.deletedAt),
          ),
        ),
    ];
    const geoRows = input.geoZones.map((geoZone) => ({
      id: crypto.randomUUID(),
      serviceZoneId: ownership.zone.id,
      type: geoZone.type,
      countryCode: geoZone.countryCode,
      provinceCode: geoZone.provinceCode ?? null,
      city: geoZone.city ?? null,
      postalExpression: geoZone.postalExpression ?? null,
      metadata: {},
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
    }));
    for (const chunk of chunkForInsert(geoRows, GEO_ZONE_COLUMNS)) {
      statements.push(db.insert(geoZones).values(chunk));
    }
    const ruleRows = input.rules.map((rule) => ({
      id: crypto.randomUUID(),
      shippingOptionId: input.optionId,
      attribute: rule.attribute,
      operator: rule.operator,
      value: rule.value,
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
    }));
    for (const chunk of chunkForInsert(ruleRows, RULE_COLUMNS)) {
      statements.push(db.insert(shippingOptionRules).values(chunk));
    }
    if (input.priceType === "flat" && !links.length) {
      statements.push(
        db.insert(priceSets).values({
          id: priceSetId,
          createdAt: input.now,
          updatedAt: input.now,
        }),
      );
    } else if (input.priceType === "flat" && links.length > 1) {
      statements.push(
        db
          .delete(shippingOptionPriceSets)
          .where(eq(shippingOptionPriceSets.shippingOptionId, input.optionId)),
      );
    }
    if (input.priceType === "flat" && (!links.length || links.length > 1)) {
      statements.push(
        db.insert(shippingOptionPriceSets).values({
          shippingOptionId: input.optionId,
          priceSetId,
          createdAt: input.now,
          updatedAt: input.now,
        }),
      );
    }
    if (input.priceType === "flat") {
      statements.push(
        db
          .update(prices)
          .set({ deletedAt: input.now, updatedAt: input.now })
          .where(
            and(
              eq(prices.priceSetId, priceSetId),
              isNull(prices.priceListId),
              isNull(prices.deletedAt),
            ),
          ),
      );
      const priceRows = input.prices.map((price) => ({
        id: price.id,
        priceSetId,
        priceListId: null,
        title: null,
        currencyCode: price.currencyCode,
        amount: price.amount,
        minQuantity: null,
        maxQuantity: null,
        rulesCount: 0,
        createdAt: input.now,
        updatedAt: input.now,
        deletedAt: null,
      }));
      for (const chunk of chunkForInsert(priceRows, PRICE_COLUMNS)) {
        statements.push(db.insert(prices).values(chunk));
      }
    }
    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
    return true;
  },

  async softDeleteFlatRate(input: {
    locationId: string;
    optionId: string;
    expectedOptionUpdatedAt: string;
    now: string;
  }): Promise<"deleted" | "not-found" | "in-use" | "conflict"> {
    const db = await getDb();
    const [owned] = await db
      .select({ option: shippingOptions, zoneId: serviceZones.id })
      .from(shippingOptions)
      .innerJoin(
        serviceZones,
        and(
          eq(serviceZones.id, shippingOptions.serviceZoneId),
          isNull(serviceZones.deletedAt),
        ),
      )
      .innerJoin(
        fulfillmentSets,
        and(
          eq(fulfillmentSets.id, serviceZones.fulfillmentSetId),
          eq(fulfillmentSets.type, "shipping"),
          isNull(fulfillmentSets.deletedAt),
        ),
      )
      .innerJoin(
        locationFulfillmentSets,
        eq(locationFulfillmentSets.fulfillmentSetId, fulfillmentSets.id),
      )
      .where(
        and(
          eq(shippingOptions.id, input.optionId),
          eq(locationFulfillmentSets.stockLocationId, input.locationId),
          isNull(shippingOptions.deletedAt),
        ),
      )
      .limit(1);
    if (!owned) return "not-found";
    if (owned.option.updatedAt !== input.expectedOptionUpdatedAt) {
      return "conflict";
    }

    const currentCartRows = await db
      .select({ id: cartShippingMethods.id })
      .from(cartShippingMethods)
      .innerJoin(carts, eq(carts.id, cartShippingMethods.cartId))
      .where(
        and(
          eq(cartShippingMethods.shippingOptionId, input.optionId),
          isNull(cartShippingMethods.deletedAt),
          isNull(carts.completedAt),
          isNull(carts.deletedAt),
        ),
      )
      .limit(1);
    if (currentCartRows.length) return "in-use";

    await db.batch([
      batchGuard(
        db,
        sql`EXISTS (
          SELECT 1
          FROM shipping_options AS option
          JOIN service_zones AS zone ON zone.id = option.service_zone_id
          JOIN fulfillment_sets AS fulfillment_set ON fulfillment_set.id = zone.fulfillment_set_id
          JOIN location_fulfillment_sets AS link ON link.fulfillment_set_id = fulfillment_set.id
          WHERE option.id = ${input.optionId}
            AND option.updated_at = ${input.expectedOptionUpdatedAt}
            AND option.deleted_at IS NULL
            AND zone.id = ${owned.zoneId}
            AND zone.deleted_at IS NULL
            AND fulfillment_set.type = 'shipping'
            AND fulfillment_set.deleted_at IS NULL
            AND link.stock_location_id = ${input.locationId}
        ) AND NOT EXISTS (
          SELECT 1
          FROM cart_shipping_methods AS method
          JOIN carts AS cart ON cart.id = method.cart_id
          WHERE method.shipping_option_id = ${input.optionId}
            AND method.deleted_at IS NULL
            AND cart.completed_at IS NULL
            AND cart.deleted_at IS NULL
        )`,
      ),
      db
        .update(shippingOptions)
        .set({ deletedAt: input.now, updatedAt: input.now })
        .where(
          and(
            eq(shippingOptions.id, input.optionId),
            eq(shippingOptions.updatedAt, input.expectedOptionUpdatedAt),
            isNull(shippingOptions.deletedAt),
          ),
        ),
      // A builder, not db.run(sql): see batchGuard. Runs after the option
      // above is removed, so the zone goes with its last option.
      db
        .update(serviceZones)
        .set({ deletedAt: input.now, updatedAt: input.now })
        .where(
          and(
            eq(serviceZones.id, owned.zoneId),
            isNull(serviceZones.deletedAt),
            sql`NOT EXISTS (
              SELECT 1 FROM shipping_options
              WHERE service_zone_id = ${owned.zoneId}
                AND deleted_at IS NULL
            )`,
          ),
        ),
    ]);
    return "deleted";
  },

  async createShippingOption(input: {
    locationId: string;
    locationName: string;
    zoneId: string;
    serviceZoneId?: string | null;
    zoneName?: string;
    geoZones?: ShippingAdminGeoZoneInput[];
    optionId: string;
    optionName: string;
    providerId: string | null;
    shippingProfileId: string;
    shippingOptionTypeId: string | null;
    rules: ShippingAdminRuleDTO[];
    priceSetId: string | null;
    priceType: "flat" | "calculated";
    providerData: Record<string, JsonValue>;
    prices: Array<{ id: string; currencyCode: string; amount: number }>;
    now: string;
  }): Promise<boolean> {
    const db = await getDb();
    const [existingZone] = input.serviceZoneId
      ? await db
          .select({ id: serviceZones.id })
          .from(serviceZones)
          .innerJoin(
            fulfillmentSets,
            and(
              eq(fulfillmentSets.id, serviceZones.fulfillmentSetId),
              eq(fulfillmentSets.type, "shipping"),
              isNull(fulfillmentSets.deletedAt),
            ),
          )
          .innerJoin(
            locationFulfillmentSets,
            eq(locationFulfillmentSets.fulfillmentSetId, fulfillmentSets.id),
          )
          .where(
            and(
              eq(serviceZones.id, input.serviceZoneId),
              eq(locationFulfillmentSets.stockLocationId, input.locationId),
              isNull(serviceZones.deletedAt),
            ),
          )
          .limit(1)
      : [];
    if (input.serviceZoneId && !existingZone) return false;

    const linkedSets = existingZone
      ? []
      : await db
          .select({ id: fulfillmentSets.id })
          .from(fulfillmentSets)
          .innerJoin(
            locationFulfillmentSets,
            eq(locationFulfillmentSets.fulfillmentSetId, fulfillmentSets.id),
          )
          .where(
            and(
              eq(locationFulfillmentSets.stockLocationId, input.locationId),
              eq(fulfillmentSets.type, "shipping"),
              isNull(fulfillmentSets.deletedAt),
            ),
          )
          .limit(1);
    const fulfillmentSetId =
      linkedSets[0]?.id ?? (existingZone ? null : crypto.randomUUID());
    const zoneId = existingZone?.id ?? input.zoneId;
    const zoneOwnershipGuard = input.serviceZoneId
      ? sql`EXISTS (
          SELECT 1
          FROM service_zones AS zone
          JOIN fulfillment_sets AS fulfillment_set
            ON fulfillment_set.id = zone.fulfillment_set_id
          JOIN location_fulfillment_sets AS link
            ON link.fulfillment_set_id = fulfillment_set.id
          WHERE zone.id = ${input.serviceZoneId}
            AND zone.deleted_at IS NULL
            AND fulfillment_set.type = 'shipping'
            AND fulfillment_set.deleted_at IS NULL
            AND link.stock_location_id = ${input.locationId}
        )`
      : sql`1 = 1`;
    const shippingTypeGuard = input.shippingOptionTypeId
      ? sql`EXISTS (
          SELECT 1 FROM shipping_option_types
          WHERE id = ${input.shippingOptionTypeId} AND deleted_at IS NULL
        )`
      : sql`1 = 1`;
    const statements: BatchItem<"sqlite">[] = [
      batchGuard(
        db,
        sql`EXISTS (
          SELECT 1 FROM ${stockLocations}
          WHERE ${stockLocations.id} = ${input.locationId}
            AND ${stockLocations.deletedAt} IS NULL
        ) AND EXISTS (
          SELECT 1 FROM ${shippingProfiles}
          WHERE ${shippingProfiles.id} = ${input.shippingProfileId}
            AND ${shippingProfiles.deletedAt} IS NULL
        ) AND ${shippingTypeGuard} AND ${zoneOwnershipGuard}`,
      ),
    ];

    if (input.providerId) {
      statements.unshift(
        db
          .insert(fulfillmentProviders)
          .values({
            id: input.providerId,
            isEnabled: true,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoUpdate({
            target: fulfillmentProviders.id,
            set: {
              isEnabled: true,
              deletedAt: null,
              updatedAt: input.now,
            },
          }),
      );
    }

    if (!existingZone && fulfillmentSetId && !linkedSets.length) {
      statements.push(
        db.insert(fulfillmentSets).values({
          id: fulfillmentSetId,
          name: `${input.locationName} shipping ${fulfillmentSetId.slice(0, 8)}`,
          type: "shipping",
          metadata: {},
          createdAt: input.now,
          updatedAt: input.now,
        }),
        db.insert(locationFulfillmentSets).values({
          stockLocationId: input.locationId,
          fulfillmentSetId,
          createdAt: input.now,
          updatedAt: input.now,
        }),
      );
    }

    if (!existingZone && fulfillmentSetId) {
      statements.push(
        db.insert(serviceZones).values({
          id: zoneId,
          fulfillmentSetId,
          name: input.zoneName!,
          metadata: {},
          createdAt: input.now,
          updatedAt: input.now,
        }),
      );
      const geoRows = (input.geoZones ?? []).map((geoZone) => ({
        id: crypto.randomUUID(),
        serviceZoneId: zoneId,
        type: geoZone.type,
        countryCode: geoZone.countryCode,
        provinceCode: geoZone.provinceCode ?? null,
        city: geoZone.city ?? null,
        postalExpression: geoZone.postalExpression ?? null,
        metadata: {},
        createdAt: input.now,
        updatedAt: input.now,
        deletedAt: null,
      }));
      for (const chunk of chunkForInsert(geoRows, GEO_ZONE_COLUMNS)) {
        statements.push(db.insert(geoZones).values(chunk));
      }
    }
    statements.push(
      db.insert(shippingOptions).values({
        id: input.optionId,
        serviceZoneId: zoneId,
        shippingProfileId: input.shippingProfileId,
        providerId: input.providerId,
        shippingOptionTypeId: input.shippingOptionTypeId,
        name: input.optionName,
        priceType: input.priceType,
        data: input.providerData,
        metadata: {},
        createdAt: input.now,
        updatedAt: input.now,
      }),
    );
    if (input.priceType === "flat") {
      if (!input.priceSetId) {
        throw new Error("Flat shipping options require a price set");
      }
      statements.push(
        db.insert(priceSets).values({
          id: input.priceSetId,
          createdAt: input.now,
          updatedAt: input.now,
        }),
        db.insert(shippingOptionPriceSets).values({
          shippingOptionId: input.optionId,
          priceSetId: input.priceSetId,
          createdAt: input.now,
          updatedAt: input.now,
        }),
      );
    } else if (input.prices.length > 0 || input.priceSetId !== null) {
      throw new Error("Calculated shipping options cannot store fixed prices");
    }
    const ruleRows = input.rules.map((rule) => ({
      id: crypto.randomUUID(),
      shippingOptionId: input.optionId,
      attribute: rule.attribute,
      operator: rule.operator,
      value: rule.value,
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
    }));
    for (const chunk of chunkForInsert(ruleRows, RULE_COLUMNS)) {
      statements.push(db.insert(shippingOptionRules).values(chunk));
    }
    if (input.priceType === "flat") {
      const priceRows = input.prices.map((price) => ({
        id: price.id,
        priceSetId: input.priceSetId!,
        priceListId: null,
        title: null,
        currencyCode: price.currencyCode,
        amount: price.amount,
        minQuantity: null,
        maxQuantity: null,
        rulesCount: 0,
        createdAt: input.now,
        updatedAt: input.now,
        deletedAt: null,
      }));
      for (const chunk of chunkForInsert(priceRows, PRICE_COLUMNS)) {
        statements.push(db.insert(prices).values(chunk));
      }
    }

    await db.batch(
      statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
    );
    return true;
  },
};
