import { getDb } from "@/db";
import { assets } from "@/db/asset.schema";
import {
  cartAddresses,
  cartCreditLines,
  cartLineItemAdjustments,
  cartLineItems,
  cartLineItemTaxLines,
  carts,
  cartShippingMethodAdjustments,
  cartShippingMethods,
  cartShippingMethodTaxLines,
} from "@/db/cart.schema";
import { cartPromotions, productSalesChannels } from "@/db/link.schema";
import { promotions } from "@/db/promotion.schema";
import { regionCountries } from "@/db/region.schema";
import {
  productCollections,
  products,
  productTypes,
  productVariants,
} from "@/db/product.schema";
import { pricingDal } from "@/lib/pricing/dal/pricing.dal";
import { cartReservationDal } from "@/lib/inventory/dal/cart-reservation.dal";
import { cartPromotionDal } from "@/lib/promotion/dal/cart-promotion.dal";
import { cartTaxDal } from "@/lib/tax/dal/cart-tax.dal";
import type { StoreContextDTO } from "@/lib/storefront/dto/store-context.dto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { calculateAmountLine, sumCartTotals } from "../cart-totals";
import type {
  CartAddressDTO,
  CartAddressInput,
  CartDTO,
  CartLineItemDTO,
  CartShippingMethodDTO,
} from "../dto/cart.dto";

type CartMutationResult =
  | { success: true; cart: CartDTO }
  | {
      success: false;
      reason:
        | "NOT_FOUND"
        | "COMPLETED"
        | "UNAVAILABLE"
        | "NO_PRICE"
        | "INVALID_ADDRESS";
    };

const activeCart = async (id: string, salesChannelId: string) => {
  const db = await getDb();
  return (
    (
      await db
        .select()
        .from(carts)
        .where(
          and(
            eq(carts.id, id),
            eq(carts.salesChannelId, salesChannelId),
            isNull(carts.deletedAt),
          ),
        )
        .limit(1)
    )[0] ?? null
  );
};

const mapAddress = (
  row: typeof cartAddresses.$inferSelect | undefined,
): CartAddressDTO | null =>
  row
    ? {
        id: row.id,
        company: row.company,
        firstName: row.firstName,
        lastName: row.lastName,
        address1: row.address1,
        address2: row.address2,
        city: row.city,
        countryCode: row.countryCode,
        province: row.province,
        postalCode: row.postalCode,
        phone: row.phone,
      }
    : null;

export const cartDal = {
  async create(context: StoreContextDTO, email?: string): Promise<CartDTO> {
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(carts).values({
      id,
      regionId: context.regionId,
      salesChannelId: context.salesChannelId,
      currencyCode: context.currencyCode,
      locale: context.localeCode,
      email: email ?? null,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    return (await this.findById(id, context.salesChannelId))!;
  },

  async findById(id: string, salesChannelId: string): Promise<CartDTO | null> {
    const cart = await activeCart(id, salesChannelId);
    if (!cart || !cart.regionId || !cart.salesChannelId) return null;
    const db = await getDb();
    const addressIds = [cart.shippingAddressId, cart.billingAddressId].filter(
      (value): value is string => Boolean(value),
    );
    const [items, shipping, credits, appliedPromotions, addresses] =
      await Promise.all([
        db
          .select()
          .from(cartLineItems)
          .where(
            and(eq(cartLineItems.cartId, id), isNull(cartLineItems.deletedAt)),
          ),
        db
          .select()
          .from(cartShippingMethods)
          .where(
            and(
              eq(cartShippingMethods.cartId, id),
              isNull(cartShippingMethods.deletedAt),
            ),
          ),
        db
          .select()
          .from(cartCreditLines)
          .where(
            and(
              eq(cartCreditLines.cartId, id),
              isNull(cartCreditLines.deletedAt),
            ),
          ),
        db
          .select({
            id: promotions.id,
            code: promotions.code,
            isAutomatic: promotions.isAutomatic,
          })
          .from(cartPromotions)
          .innerJoin(
            promotions,
            and(
              eq(promotions.id, cartPromotions.promotionId),
              eq(promotions.status, "active"),
              isNull(promotions.deletedAt),
            ),
          )
          .where(eq(cartPromotions.cartId, id)),
        addressIds.length
          ? db
              .select()
              .from(cartAddresses)
              .where(
                and(
                  inArray(cartAddresses.id, addressIds),
                  isNull(cartAddresses.deletedAt),
                ),
              )
          : [],
      ]);
    const itemIds = items.map((item) => item.id);
    const shippingIds = shipping.map((method) => method.id);
    const [itemAdjustments, itemTaxes, shippingAdjustments, shippingTaxes] =
      await Promise.all([
        itemIds.length
          ? db
              .select()
              .from(cartLineItemAdjustments)
              .where(
                and(
                  inArray(cartLineItemAdjustments.itemId, itemIds),
                  isNull(cartLineItemAdjustments.deletedAt),
                ),
              )
          : [],
        itemIds.length
          ? db
              .select()
              .from(cartLineItemTaxLines)
              .where(
                and(
                  inArray(cartLineItemTaxLines.itemId, itemIds),
                  isNull(cartLineItemTaxLines.deletedAt),
                ),
              )
          : [],
        shippingIds.length
          ? db
              .select()
              .from(cartShippingMethodAdjustments)
              .where(
                and(
                  inArray(
                    cartShippingMethodAdjustments.shippingMethodId,
                    shippingIds,
                  ),
                  isNull(cartShippingMethodAdjustments.deletedAt),
                ),
              )
          : [],
        shippingIds.length
          ? db
              .select()
              .from(cartShippingMethodTaxLines)
              .where(
                and(
                  inArray(
                    cartShippingMethodTaxLines.shippingMethodId,
                    shippingIds,
                  ),
                  isNull(cartShippingMethodTaxLines.deletedAt),
                ),
              )
          : [],
      ]);
    const itemAmounts = items.map((item) => ({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      isTaxInclusive: item.isTaxInclusive,
      adjustments: itemAdjustments
        .filter((adjustment) => adjustment.itemId === item.id)
        .map((adjustment) => adjustment.amount),
      taxes: itemTaxes
        .filter((tax) => tax.itemId === item.id)
        .map((tax) => ({ rate: tax.rate })),
    }));
    const shippingAmounts = shipping.map((method) => ({
      quantity: 1,
      unitPrice: method.amount,
      isTaxInclusive: method.isTaxInclusive,
      adjustments: shippingAdjustments
        .filter((adjustment) => adjustment.shippingMethodId === method.id)
        .map((adjustment) => adjustment.amount),
      taxes: shippingTaxes
        .filter((tax) => tax.shippingMethodId === method.id)
        .map((tax) => ({ rate: tax.rate })),
    }));
    const totals = sumCartTotals({
      items: itemAmounts,
      shipping: shippingAmounts,
      credits: credits.map((credit) => credit.amount),
    });
    const itemDtos: CartLineItemDTO[] = items.map((item, index) => ({
      id: item.id,
      variantId: item.variantId,
      productId: item.productId,
      title: item.title,
      variantTitle: item.variantTitle,
      productHandle: item.productHandle,
      thumbnail: item.thumbnail,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      ...calculateAmountLine(itemAmounts[index]),
    }));
    const shippingDtos: CartShippingMethodDTO[] = shipping.map(
      (method, index) => ({
        id: method.id,
        shippingOptionId: method.shippingOptionId,
        name: method.name,
        amount: method.amount,
        discountTotal: calculateAmountLine(shippingAmounts[index])
          .discountTotal,
        taxTotal: calculateAmountLine(shippingAmounts[index]).taxTotal,
        total: calculateAmountLine(shippingAmounts[index]).total,
      }),
    );
    return {
      id: cart.id,
      regionId: cart.regionId,
      salesChannelId: cart.salesChannelId,
      currencyCode: cart.currencyCode,
      locale: cart.locale,
      email: cart.email,
      shippingAddress: mapAddress(
        addresses.find((address) => address.id === cart.shippingAddressId),
      ),
      billingAddress: mapAddress(
        addresses.find((address) => address.id === cart.billingAddressId),
      ),
      completedAt: cart.completedAt,
      items: itemDtos,
      shippingMethods: shippingDtos,
      promotions: appliedPromotions,
      ...totals,
      createdAt: cart.createdAt,
      updatedAt: cart.updatedAt,
    };
  },

  async addItem(
    cartId: string,
    context: StoreContextDTO,
    variantId: string,
    quantity: number,
  ): Promise<CartMutationResult> {
    const cart = await activeCart(cartId, context.salesChannelId);
    if (!cart) return { success: false, reason: "NOT_FOUND" };
    if (cart.completedAt) return { success: false, reason: "COMPLETED" };
    const db = await getDb();
    const [catalogue] = await db
      .select({
        variant: productVariants,
        product: products,
        collectionTitle: productCollections.title,
        typeValue: productTypes.value,
        thumbnailAssetId: assets.id,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .innerJoin(
        productSalesChannels,
        and(
          eq(productSalesChannels.productId, products.id),
          eq(productSalesChannels.salesChannelId, context.salesChannelId),
        ),
      )
      .leftJoin(
        productCollections,
        eq(productCollections.id, products.collectionId),
      )
      .leftJoin(productTypes, eq(productTypes.id, products.typeId))
      .leftJoin(
        assets,
        eq(
          assets.id,
          sql<string>`coalesce(${productVariants.thumbnailAssetId}, ${products.thumbnailAssetId})`,
        ),
      )
      .where(
        and(
          eq(productVariants.id, variantId),
          eq(products.status, "published"),
          isNull(productVariants.deletedAt),
          isNull(products.deletedAt),
        ),
      )
      .limit(1);
    if (!catalogue) return { success: false, reason: "UNAVAILABLE" };
    const [existing] = await db
      .select()
      .from(cartLineItems)
      .where(
        and(
          eq(cartLineItems.cartId, cartId),
          eq(cartLineItems.variantId, variantId),
          isNull(cartLineItems.deletedAt),
        ),
      )
      .limit(1);
    const nextQuantity = (existing?.quantity ?? 0) + quantity;
    const lineItemId = existing?.id ?? crypto.randomUUID();
    const resolvedPrice = await pricingDal.resolveVariantPrice(variantId, {
      currencyCode: cart.currencyCode,
      quantity: nextQuantity,
      regionId: cart.regionId ?? undefined,
      salesChannelId: context.salesChannelId,
    });
    if (!resolvedPrice) return { success: false, reason: "NO_PRICE" };
    const reservation = await cartReservationDal.syncLine({
      cartId,
      lineItemId,
      salesChannelId: context.salesChannelId,
      variantId,
      quantity: nextQuantity,
      allowBackorder: catalogue.variant.allowBackorder,
    });
    if (!reservation.success) return { success: false, reason: "UNAVAILABLE" };
    if (
      !reservation.managed &&
      catalogue.variant.manageInventory &&
      !catalogue.variant.allowBackorder &&
      nextQuantity > catalogue.variant.inventoryQuantity
    )
      return { success: false, reason: "UNAVAILABLE" };
    const now = new Date().toISOString();
    if (existing) {
      await db
        .update(cartLineItems)
        .set({
          quantity: nextQuantity,
          unitPrice: resolvedPrice.amount,
          compareAtUnitPrice:
            resolvedPrice.priceListType === "sale"
              ? resolvedPrice.originalAmount
              : null,
          updatedAt: now,
        })
        .where(eq(cartLineItems.id, existing.id));
    } else {
      await db.insert(cartLineItems).values({
        id: lineItemId,
        cartId,
        title: `${catalogue.product.title} - ${catalogue.variant.title}`,
        subtitle: catalogue.product.subtitle,
        thumbnail: catalogue.thumbnailAssetId
          ? `/api/store/assets/${catalogue.thumbnailAssetId}`
          : null,
        quantity,
        variantId: catalogue.variant.id,
        productId: catalogue.product.id,
        productTitle: catalogue.product.title,
        productDescription: catalogue.product.description,
        productSubtitle: catalogue.product.subtitle,
        productType: catalogue.typeValue,
        productTypeId: catalogue.product.typeId,
        productCollectionId: catalogue.product.collectionId,
        productCollection: catalogue.collectionTitle,
        productHandle: catalogue.product.handle,
        variantSku: catalogue.variant.sku,
        variantBarcode: catalogue.variant.barcode,
        variantTitle: catalogue.variant.title,
        requiresShipping: !catalogue.product.isGiftcard,
        isDiscountable: catalogue.product.discountable,
        isGiftcard: catalogue.product.isGiftcard,
        isTaxInclusive: context.isTaxInclusive,
        unitPrice: resolvedPrice.amount,
        compareAtUnitPrice:
          resolvedPrice.priceListType === "sale"
            ? resolvedPrice.originalAmount
            : null,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });
    }
    await db.update(carts).set({ updatedAt: now }).where(eq(carts.id, cartId));
    await cartPromotionDal.refresh(cartId);
    await cartTaxDal.refresh(cartId);
    return {
      success: true,
      cart: (await this.findById(cartId, context.salesChannelId))!,
    };
  },

  async updateItem(
    cartId: string,
    salesChannelId: string,
    itemId: string,
    quantity: number,
  ): Promise<CartMutationResult> {
    const cart = await activeCart(cartId, salesChannelId);
    if (!cart) return { success: false, reason: "NOT_FOUND" };
    if (cart.completedAt) return { success: false, reason: "COMPLETED" };
    const db = await getDb();
    const [item] = await db
      .select({ item: cartLineItems, variant: productVariants })
      .from(cartLineItems)
      .leftJoin(
        productVariants,
        eq(productVariants.id, cartLineItems.variantId),
      )
      .where(
        and(
          eq(cartLineItems.id, itemId),
          eq(cartLineItems.cartId, cartId),
          isNull(cartLineItems.deletedAt),
        ),
      )
      .limit(1);
    if (!item) return { success: false, reason: "NOT_FOUND" };
    if (!item.item.variantId) return { success: false, reason: "UNAVAILABLE" };
    const reservation = await cartReservationDal.syncLine({
      cartId,
      lineItemId: itemId,
      salesChannelId,
      variantId: item.item.variantId,
      quantity,
      allowBackorder: item.variant?.allowBackorder ?? false,
    });
    if (!reservation.success) return { success: false, reason: "UNAVAILABLE" };
    if (
      !reservation.managed &&
      item.variant?.manageInventory &&
      !item.variant.allowBackorder &&
      quantity > item.variant.inventoryQuantity
    )
      return { success: false, reason: "UNAVAILABLE" };
    const resolvedPrice = await pricingDal.resolveVariantPrice(
      item.item.variantId,
      {
        currencyCode: cart.currencyCode,
        quantity,
        regionId: cart.regionId ?? undefined,
        salesChannelId,
      },
    );
    if (!resolvedPrice) return { success: false, reason: "NO_PRICE" };
    const now = new Date().toISOString();
    await db.batch([
      db
        .update(cartLineItems)
        .set({
          quantity,
          unitPrice: resolvedPrice.amount,
          compareAtUnitPrice:
            resolvedPrice.priceListType === "sale"
              ? resolvedPrice.originalAmount
              : null,
          updatedAt: now,
        })
        .where(eq(cartLineItems.id, itemId)),
      db.update(carts).set({ updatedAt: now }).where(eq(carts.id, cartId)),
    ]);
    await cartPromotionDal.refresh(cartId);
    await cartTaxDal.refresh(cartId);
    return {
      success: true,
      cart: (await this.findById(cartId, salesChannelId))!,
    };
  },

  async removeItem(
    cartId: string,
    salesChannelId: string,
    itemId: string,
  ): Promise<CartMutationResult> {
    const cart = await activeCart(cartId, salesChannelId);
    if (!cart) return { success: false, reason: "NOT_FOUND" };
    if (cart.completedAt) return { success: false, reason: "COMPLETED" };
    const db = await getDb();
    const now = new Date().toISOString();
    const result = await db
      .update(cartLineItems)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(cartLineItems.id, itemId),
          eq(cartLineItems.cartId, cartId),
          isNull(cartLineItems.deletedAt),
        ),
      );
    if (!Number(result.meta.changes ?? 0))
      return { success: false, reason: "NOT_FOUND" };
    await cartReservationDal.releaseLine(itemId);
    await db.update(carts).set({ updatedAt: now }).where(eq(carts.id, cartId));
    await cartPromotionDal.refresh(cartId);
    await cartTaxDal.refresh(cartId);
    return {
      success: true,
      cart: (await this.findById(cartId, salesChannelId))!,
    };
  },

  async updateDetails(
    cartId: string,
    salesChannelId: string,
    data: {
      email?: string;
      shippingAddress?: CartAddressInput;
      billingAddress?: CartAddressInput;
    },
  ): Promise<CartMutationResult> {
    const cart = await activeCart(cartId, salesChannelId);
    if (!cart) return { success: false, reason: "NOT_FOUND" };
    if (cart.completedAt) return { success: false, reason: "COMPLETED" };
    const db = await getDb();
    const addressCountries = [
      data.shippingAddress?.countryCode,
      data.billingAddress?.countryCode,
    ].filter((value): value is string => Boolean(value));
    if (addressCountries.length) {
      const assigned = await db
        .select({ iso2: regionCountries.iso2 })
        .from(regionCountries)
        .where(
          and(
            eq(regionCountries.regionId, cart.regionId!),
            inArray(regionCountries.iso2, [...new Set(addressCountries)]),
            isNull(regionCountries.deletedAt),
          ),
        );
      if (assigned.length !== new Set(addressCountries).size)
        return { success: false, reason: "INVALID_ADDRESS" };
    }
    const now = new Date().toISOString();
    const setAddress = async (
      currentId: string | null,
      address: CartAddressInput,
    ) => {
      const id = currentId ?? crypto.randomUUID();
      if (currentId)
        await db
          .update(cartAddresses)
          .set({ ...address, updatedAt: now })
          .where(eq(cartAddresses.id, currentId));
      else
        await db.insert(cartAddresses).values({
          id,
          customerId: cart.customerId,
          ...address,
          metadata: {},
          createdAt: now,
          updatedAt: now,
        });
      return id;
    };
    const shippingAddressId = data.shippingAddress
      ? await setAddress(cart.shippingAddressId, data.shippingAddress)
      : cart.shippingAddressId;
    const billingAddressId = data.billingAddress
      ? await setAddress(cart.billingAddressId, data.billingAddress)
      : cart.billingAddressId;
    await db
      .update(carts)
      .set({
        ...(data.email !== undefined ? { email: data.email } : {}),
        shippingAddressId,
        billingAddressId,
        updatedAt: now,
      })
      .where(eq(carts.id, cartId));
    await cartPromotionDal.refresh(cartId);
    await cartTaxDal.refresh(cartId);
    return {
      success: true,
      cart: (await this.findById(cartId, salesChannelId))!,
    };
  },
};
