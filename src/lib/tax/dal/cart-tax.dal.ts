import { getDb } from "@/db";
import {
  cartAddresses,
  cartLineItems,
  cartLineItemTaxLines,
  carts,
  cartShippingMethods,
  cartShippingMethodTaxLines,
} from "@/db/cart.schema";
import { regions } from "@/db/region.schema";
import { chunkForInsert } from "@/lib/product/dal/d1-batch";
import { calculateTaxLines } from "@/lib/tax/calculate-tax-lines.server";
import { and, eq, inArray, isNull } from "drizzle-orm";

export const cartTaxDal = {
  async refresh(cartId: string): Promise<void> {
    const db = await getDb();
    const [cart] = await db
      .select({ cart: carts, region: regions })
      .from(carts)
      .leftJoin(
        regions,
        and(eq(regions.id, carts.regionId), isNull(regions.deletedAt)),
      )
      .where(and(eq(carts.id, cartId), isNull(carts.deletedAt)))
      .limit(1);
    if (!cart || cart.cart.completedAt) return;
    const [items, shipping, address] = await Promise.all([
      db
        .select()
        .from(cartLineItems)
        .where(
          and(
            eq(cartLineItems.cartId, cartId),
            isNull(cartLineItems.deletedAt),
          ),
        ),
      db
        .select()
        .from(cartShippingMethods)
        .where(
          and(
            eq(cartShippingMethods.cartId, cartId),
            isNull(cartShippingMethods.deletedAt),
          ),
        ),
      cart.cart.shippingAddressId
        ? db
            .select()
            .from(cartAddresses)
            .where(
              and(
                eq(cartAddresses.id, cart.cart.shippingAddressId),
                isNull(cartAddresses.deletedAt),
              ),
            )
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : null,
    ]);
    const itemIds = items.map((item) => item.id);
    const shippingIds = shipping.map((method) => method.id);
    if (itemIds.length)
      await db
        .delete(cartLineItemTaxLines)
        .where(inArray(cartLineItemTaxLines.itemId, itemIds));
    if (shippingIds.length)
      await db
        .delete(cartShippingMethodTaxLines)
        .where(
          inArray(cartShippingMethodTaxLines.shippingMethodId, shippingIds),
        );
    if (!cart.region?.automaticTaxes || !address?.countryCode) return;
    const lines = await calculateTaxLines({
      context: {
        address: {
          address1: address.address1,
          address2: address.address2,
          city: address.city,
          countryCode: address.countryCode,
          provinceCode: address.province,
          postalCode: address.postalCode,
        },
        currencyCode: cart.cart.currencyCode,
        customerId: cart.cart.customerId,
      },
      itemLines: items.map((item) => ({
        id: item.id,
        unitAmount: item.unitPrice,
        quantity: item.quantity,
        productId: item.productId ?? undefined,
        productTypeId: item.productTypeId,
      })),
      shippingLines: shipping.map((method) => ({
        id: method.id,
        amount: method.amount,
        shippingOptionId: method.shippingOptionId ?? undefined,
      })),
    });
    const now = new Date().toISOString();
    const itemTaxLines = lines.flatMap((line) =>
      "lineItemId" in line
        ? [
            {
              id: crypto.randomUUID(),
              itemId: line.lineItemId,
              description: line.name,
              code: line.code,
              rate: line.rate,
              providerId: line.providerId,
              taxRateId: line.taxRateId ?? null,
              data: line.data ?? null,
              createdAt: now,
              updatedAt: now,
            },
          ]
        : [],
    );
    const shippingTaxLines = lines.flatMap((line) =>
      "shippingLineId" in line
        ? [
            {
              id: crypto.randomUUID(),
              shippingMethodId: line.shippingLineId,
              description: line.name,
              code: line.code,
              rate: line.rate,
              providerId: line.providerId,
              taxRateId: line.taxRateId ?? null,
              data: line.data ?? null,
              createdAt: now,
              updatedAt: now,
            },
          ]
        : [],
    );
    for (const group of chunkForInsert(itemTaxLines, 10)) {
      await db.insert(cartLineItemTaxLines).values(group);
    }
    for (const group of chunkForInsert(shippingTaxLines, 10)) {
      await db.insert(cartShippingMethodTaxLines).values(group);
    }
  },
};
