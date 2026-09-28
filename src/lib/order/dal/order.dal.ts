import { getDb } from "@/db";
import type { JsonValue, Metadata } from "@/db/json";
import {
  orderAddresses,
  orderItems,
  orderLineItems,
  orders,
  orderSummaries,
  orderLineItemAdjustments,
  orderLineItemTaxLines,
  orderShippings,
  orderShippingMethods,
  orderShippingMethodAdjustments,
  orderShippingMethodTaxLines,
  orderTransactions,
  orderCreditLines,
  orderChanges,
  orderChangeActions,
} from "@/db/schema";
import {
  fulfillmentItems,
  fulfillmentLabels,
  fulfillments,
  shippingOptions,
} from "@/db/fulfillment.schema";
import {
  orderFulfillments,
  orderPaymentCollections,
  orderPromotions,
} from "@/db/link.schema";
import { paymentCollections } from "@/db/payment.schema";
import {
  promotionCampaignBudgets,
  promotionCampaignBudgetUsages,
  promotions,
} from "@/db/promotion.schema";
import { regions } from "@/db/region.schema";
import { chunkForInsert } from "@/lib/product/dal/d1-batch";
import { calculateTaxLines } from "@/lib/tax/calculate-tax-lines.server";
import { likeContains } from "@/lib/db/like-query";
import { firstOrNull } from "@/lib/db/single-row";
import type { OrderDetailDTO } from "@/lib/order/dto/order.dto";
import type { DraftPromotionEvaluation } from "@/lib/order/dal/draft-order-promotion.dal";
import {
  calculateDraftOrderTotal,
  calculateDraftOrderSummary,
  draftOrderConversionFailure,
} from "@/lib/order/draft-order";
import {
  databaseErrorMessage,
  isOrderDisplayIdConflict,
} from "@/lib/order/database-error";
import type { BatchItem } from "drizzle-orm/batch";
import {
  toOrderDetailDTO,
  toOrderFulfillmentDTOs,
  toOrderItemDTO,
  toOrderListDTO,
} from "@/lib/order/mapper/order.mapper";
import type { FulfillmentRow } from "@/lib/order/mapper/order.mapper";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  max,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { batchGuard } from "@/lib/db/batch-guard";

type DraftOrderAddressSnapshot = {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  countryCode: string | null;
  phone: string | null;
};

const sameDraftAddress = (
  left: DraftOrderAddressSnapshot | null,
  right: DraftOrderAddressSnapshot | null,
): boolean =>
  Boolean(
    left &&
    right &&
    left.firstName === right.firstName &&
    left.lastName === right.lastName &&
    left.company === right.company &&
    left.address1 === right.address1 &&
    left.address2 === right.address2 &&
    left.city === right.city &&
    left.province === right.province &&
    left.postalCode === right.postalCode &&
    left.countryCode === right.countryCode &&
    left.phone === right.phone,
  );

export const orderDal = {
  async listPage(options: {
    query?: string;
    sortBy: "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
    offset?: number;
    isDraftOrder?: boolean;
  }) {
    const db = await getDb();
    const conditions: SQL[] = [isNull(orders.deletedAt)];
    if (options.isDraftOrder !== undefined)
      conditions.push(eq(orders.isDraftOrder, options.isDraftOrder));
    if (options.query) {
      const term = options.query;
      conditions.push(
        or(
          likeContains(orders.email, term),
          likeContains(orders.customDisplayId, term),
        ) as SQL,
      );
    }
    const where = and(...conditions);
    const sortColumn =
      options.sortBy === "updatedAt" ? orders.updatedAt : orders.createdAt;
    const orderBy =
      options.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);
    const [totals, rows] = await Promise.all([
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
        .orderBy(orderBy)
        .limit(options.limit)
        .offset(options.offset ?? (options.page - 1) * options.limit),
    ]);
    const data = rows.map(toOrderListDTO);
    return { orders: data, total: Number(totals[0]?.value ?? 0) };
  },

  async findById(id: string): Promise<OrderDetailDTO | null> {
    const db = await getDb();
    const rows = await db
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
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const [addresses, paymentRows, unfulfilledRows, creditLines] =
      await Promise.all([
        db
          .select()
          .from(orderAddresses)
          .where(
            and(
              inArray(
                orderAddresses.id,
                [
                  row.order.shippingAddressId,
                  row.order.billingAddressId,
                ].filter((value): value is string => Boolean(value)),
              ),
              isNull(orderAddresses.deletedAt),
            ),
          ),
        db
          .select({ collection: paymentCollections })
          .from(orderPaymentCollections)
          .innerJoin(
            paymentCollections,
            eq(
              paymentCollections.id,
              orderPaymentCollections.paymentCollectionId,
            ),
          )
          .where(eq(orderPaymentCollections.orderId, id))
          .limit(1),
        db
          .select({ id: orderItems.id })
          .from(orderItems)
          .where(
            and(
              eq(orderItems.orderId, id),
              eq(orderItems.version, row.order.version),
              isNull(orderItems.deletedAt),
              sql`${orderItems.fulfilledQuantity} < ${orderItems.quantity}`,
            ),
          )
          .limit(1),
        db
          .select()
          .from(orderCreditLines)
          .where(
            and(
              eq(orderCreditLines.orderId, id),
              eq(orderCreditLines.version, row.order.version),
              isNull(orderCreditLines.deletedAt),
            ),
          )
          .orderBy(asc(orderCreditLines.createdAt), asc(orderCreditLines.id)),
      ]);
    return toOrderDetailDTO({
      row,
      addresses,
      creditLines,
      payment: paymentRows[0]?.collection ?? null,
      hasUnfulfilledItems: unfulfilledRows.length > 0,
    });
  },

  async findDraftShippingContext(orderId: string) {
    const db = await getDb();
    const order = firstOrNull(
      await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), isNull(orders.deletedAt)))
        .limit(1),
    );
    if (!order) return null;
    const [
      itemRows,
      addressRows,
      billingAddressRows,
      shippingRows,
      promotionRows,
    ] = await Promise.all([
      db
        .select({ item: orderLineItems, state: orderItems })
        .from(orderItems)
        .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
        .where(
          and(
            eq(orderItems.orderId, orderId),
            eq(orderItems.version, order.version),
            isNull(orderItems.deletedAt),
            isNull(orderLineItems.deletedAt),
          ),
        ),
      order.shippingAddressId
        ? db
            .select()
            .from(orderAddresses)
            .where(
              and(
                eq(orderAddresses.id, order.shippingAddressId),
                isNull(orderAddresses.deletedAt),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
      order.billingAddressId
        ? db
            .select()
            .from(orderAddresses)
            .where(
              and(
                eq(orderAddresses.id, order.billingAddressId),
                isNull(orderAddresses.deletedAt),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
      db
        .select({
          method: orderShippingMethods,
          shippingProfileId: shippingOptions.shippingProfileId,
        })
        .from(orderShippings)
        .innerJoin(
          orderShippingMethods,
          eq(orderShippingMethods.id, orderShippings.shippingMethodId),
        )
        .leftJoin(
          shippingOptions,
          eq(shippingOptions.id, orderShippingMethods.shippingOptionId),
        )
        .where(
          and(
            eq(orderShippings.orderId, orderId),
            eq(orderShippings.version, order.version),
            isNull(orderShippings.returnId),
            isNull(orderShippings.exchangeId),
            isNull(orderShippings.claimId),
            isNull(orderShippings.deletedAt),
          ),
        ),
      db
        .select({
          code: promotions.code,
          isAutomatic: promotions.isAutomatic,
        })
        .from(orderPromotions)
        .innerJoin(promotions, eq(promotions.id, orderPromotions.promotionId))
        .where(eq(orderPromotions.orderId, orderId))
        .orderBy(asc(promotions.code)),
    ]);
    const itemIds = itemRows.map(({ item }) => item.id);
    const adjustmentRows = itemIds.length
      ? await db
          .select({
            itemId: orderLineItemAdjustments.itemId,
            amount: orderLineItemAdjustments.amount,
          })
          .from(orderLineItemAdjustments)
          .where(
            and(
              inArray(orderLineItemAdjustments.itemId, itemIds),
              eq(orderLineItemAdjustments.version, order.version),
              isNull(orderLineItemAdjustments.deletedAt),
            ),
          )
      : [];
    const itemSubtotal = itemRows.reduce(
      (sum, { item, state }) =>
        sum + state.quantity * (state.unitPrice ?? item.unitPrice ?? 0),
      0,
    );
    return {
      order,
      shippingAddress: addressRows[0] ?? null,
      billingAddress: billingAddressRows[0] ?? null,
      items: itemRows.map(({ item, state }) => ({
        itemId: item.id,
        productId: item.productId,
        requiresShipping: item.requiresShipping,
        quantity: state.quantity,
        unitPrice: state.unitPrice ?? item.unitPrice ?? 0,
        productTypeId: item.productTypeId,
        title: item.title,
      })),
      itemSubtotal,
      itemDiscountTotal: adjustmentRows.reduce(
        (sum, adjustment) => sum + Math.max(0, adjustment.amount),
        0,
      ),
      selectedShippingOptionIds: shippingRows.flatMap(({ method }) =>
        method.shippingOptionId ? [method.shippingOptionId] : [],
      ),
      selectedShippingMethods: shippingRows.map(
        ({ method, shippingProfileId }) => ({
          id: method.id,
          shippingOptionId: method.shippingOptionId,
          shippingProfileId,
          name: method.name,
          description: method.description,
          amount: method.amount,
          isCustomAmount: method.isCustomAmount,
        }),
      ),
      appliedPromotionCodes: promotionRows
        .filter((row) => !row.isAutomatic)
        .map((row) => row.code),
      hasCustomShippingMethod: shippingRows.some(
        ({ method }) => method.shippingOptionId === null,
      ),
    };
  },

  async listItemsPage(options: {
    orderId: string;
    page: number;
    limit: number;
    version?: number;
  }) {
    const db = await getDb();
    const [order] = await db
      .select({ version: orders.version })
      .from(orders)
      .where(and(eq(orders.id, options.orderId), isNull(orders.deletedAt)))
      .limit(1);
    if (!order) return { items: [], total: 0 };
    const version = options.version ?? order.version;
    const condition = and(
      eq(orderItems.orderId, options.orderId),
      eq(orderItems.version, version),
      isNull(orderItems.deletedAt),
      isNull(orderLineItems.deletedAt),
    );
    const [totals, rows] = await Promise.all([
      db
        .select({ value: count() })
        .from(orderItems)
        .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
        .where(condition),
      db
        .select({ item: orderLineItems, state: orderItems })
        .from(orderItems)
        .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
        .where(condition)
        .orderBy(asc(orderItems.createdAt), asc(orderItems.id))
        .limit(options.limit)
        .offset((options.page - 1) * options.limit),
    ]);
    return {
      items: rows.map(toOrderItemDTO),
      total: Number(totals[0]?.value ?? 0),
    };
  },

  async listFulfillableItems(orderId: string, limit: number) {
    const db = await getDb();
    const [order] = await db
      .select({ version: orders.version })
      .from(orders)
      .where(and(eq(orders.id, orderId), isNull(orders.deletedAt)))
      .limit(1);
    if (!order) return [];
    const rows = await db
      .select({ item: orderLineItems, state: orderItems })
      .from(orderItems)
      .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
      .where(
        and(
          eq(orderItems.orderId, orderId),
          eq(orderItems.version, order.version),
          isNull(orderItems.deletedAt),
          isNull(orderLineItems.deletedAt),
          sql`${orderItems.fulfilledQuantity} < ${orderItems.quantity}`,
        ),
      )
      .orderBy(asc(orderItems.createdAt), asc(orderItems.id))
      .limit(limit + 1);
    return rows.map(toOrderItemDTO);
  },

  async listFulfillmentsPage(options: {
    orderId: string;
    page: number;
    limit: number;
    fulfillmentId?: string;
    offset?: number;
  }) {
    const db = await getDb();
    const condition = and(
      eq(orderFulfillments.orderId, options.orderId),
      isNull(fulfillments.deletedAt),
      ...(options.fulfillmentId
        ? [eq(fulfillments.id, options.fulfillmentId)]
        : []),
    );
    const [totals, fulfillmentRows] = await Promise.all([
      db
        .select({ value: count() })
        .from(orderFulfillments)
        .innerJoin(
          fulfillments,
          eq(fulfillments.id, orderFulfillments.fulfillmentId),
        )
        .where(condition),
      db
        .select({ fulfillment: fulfillments })
        .from(orderFulfillments)
        .innerJoin(
          fulfillments,
          eq(fulfillments.id, orderFulfillments.fulfillmentId),
        )
        .where(condition)
        .orderBy(desc(fulfillments.createdAt), asc(fulfillments.id))
        .limit(options.limit)
        .offset(options.offset ?? (options.page - 1) * options.limit),
    ]);
    const fulfillmentIds = fulfillmentRows.map((row) => row.fulfillment.id);
    const itemRows =
      fulfillmentIds.length === 0
        ? []
        : await db
            .select()
            .from(fulfillmentItems)
            .where(
              and(
                inArray(fulfillmentItems.fulfillmentId, fulfillmentIds),
                isNull(fulfillmentItems.deletedAt),
              ),
            )
            .orderBy(asc(fulfillmentItems.createdAt));
    const labelRows =
      fulfillmentIds.length === 0
        ? []
        : await db
            .select()
            .from(fulfillmentLabels)
            .where(
              and(
                inArray(fulfillmentLabels.fulfillmentId, fulfillmentIds),
                isNull(fulfillmentLabels.deletedAt),
              ),
            )
            .orderBy(
              asc(fulfillmentLabels.createdAt),
              asc(fulfillmentLabels.id),
            );
    const hydratedRows: FulfillmentRow[] = [];
    for (const { fulfillment } of fulfillmentRows) {
      const items = itemRows.filter(
        (item) => item.fulfillmentId === fulfillment.id,
      );
      if (items.length === 0) {
        hydratedRows.push({ fulfillment, item: null });
      } else {
        hydratedRows.push(...items.map((item) => ({ fulfillment, item })));
      }
    }
    return {
      fulfillments: toOrderFulfillmentDTOs(hydratedRows, labelRows),
      total: Number(totals[0]?.value ?? 0),
    };
  },

  async create(
    data: {
      id: string;
      email?: string;
      customerId?: string;
      regionId?: string;
      salesChannelId?: string;
      shippingAddress: DraftOrderAddressSnapshot | null;
      billingAddress: DraftOrderAddressSnapshot | null;
      currencyCode: string;
      noNotification: boolean;
      metadata?: Metadata;
      items: Array<{
        title: string;
        subtitle?: string | null;
        thumbnail?: string | null;
        variantId?: string | null;
        productId?: string | null;
        productTitle?: string | null;
        productDescription?: string | null;
        productSubtitle?: string | null;
        productType?: string | null;
        productTypeId?: string | null;
        productCollectionId?: string | null;
        productCollection?: string | null;
        productHandle?: string | null;
        variantSku?: string | null;
        variantBarcode?: string | null;
        variantTitle?: string | null;
        variantOptionValues?: JsonValue | null;
        requiresShipping: boolean;
        isDiscountable: boolean;
        isGiftcard: boolean;
        isTaxInclusive: boolean;
        isCustomPrice: boolean;
        unitPrice: number;
        compareAtUnitPrice?: number | null;
        quantity: number;
      }>;
    },
    displayIdRetry = 0,
  ): Promise<{ id: string; displayId: number }> {
    const db = await getDb();
    const nextRows = await db
      .select({ value: max(orders.displayId) })
      .from(orders);
    const displayId = Number(nextRows[0]?.value ?? 0) + 1;
    const now = new Date().toISOString();
    const total = calculateDraftOrderTotal(data.items);
    if (total === null)
      throw new Error("Draft order total exceeds the safe integer range");
    const shippingAddressId = data.shippingAddress ? crypto.randomUUID() : null;
    const billingSharesShipping = sameDraftAddress(
      data.shippingAddress,
      data.billingAddress,
    );
    const billingAddressId = billingSharesShipping
      ? shippingAddressId
      : data.billingAddress
        ? crypto.randomUUID()
        : null;
    const statements: BatchItem<"sqlite">[] = [];
    if (data.shippingAddress && shippingAddressId)
      statements.push(
        db.insert(orderAddresses).values({
          id: shippingAddressId,
          customerId: data.customerId ?? null,
          ...data.shippingAddress,
          createdAt: now,
          updatedAt: now,
        }),
      );
    if (
      data.billingAddress &&
      billingAddressId &&
      billingAddressId !== shippingAddressId
    )
      statements.push(
        db.insert(orderAddresses).values({
          id: billingAddressId,
          customerId: data.customerId ?? null,
          ...data.billingAddress,
          createdAt: now,
          updatedAt: now,
        }),
      );
    statements.push(
      db.insert(orders).values({
        id: data.id,
        displayId,
        status: "draft",
        email: data.email || null,
        customerId: data.customerId ?? null,
        regionId: data.regionId ?? null,
        salesChannelId: data.salesChannelId ?? null,
        currencyCode: data.currencyCode.toLowerCase(),
        isDraftOrder: true,
        noNotification: data.noNotification,
        metadata: data.metadata ?? {},
        shippingAddressId,
        billingAddressId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(orderSummaries).values({
        id: crypto.randomUUID(),
        orderId: data.id,
        version: 1,
        totals: {
          itemsTotal: total,
          subtotal: total,
          discountTotal: 0,
          shippingTotal: 0,
          taxTotal: 0,
          total,
        },
        createdAt: now,
        updatedAt: now,
      }),
    );
    for (const item of data.items) {
      const lineItemId = crypto.randomUUID();
      statements.push(
        db.insert(orderLineItems).values({
          id: lineItemId,
          title: item.title,
          subtitle: item.subtitle ?? null,
          thumbnail: item.thumbnail ?? null,
          variantId: item.variantId ?? null,
          productId: item.productId ?? null,
          productTitle: item.productTitle ?? null,
          productDescription: item.productDescription ?? null,
          productSubtitle: item.productSubtitle ?? null,
          productType: item.productType ?? null,
          productTypeId: item.productTypeId ?? null,
          productCollectionId: item.productCollectionId ?? null,
          productCollection: item.productCollection ?? null,
          productHandle: item.productHandle ?? null,
          variantSku: item.variantSku ?? null,
          variantBarcode: item.variantBarcode ?? null,
          variantTitle: item.variantTitle ?? null,
          variantOptionValues: item.variantOptionValues ?? null,
          requiresShipping: item.requiresShipping,
          isDiscountable: item.isDiscountable,
          isGiftcard: item.isGiftcard,
          isTaxInclusive: item.isTaxInclusive,
          isCustomPrice: item.isCustomPrice,
          unitPrice: item.unitPrice,
          compareAtUnitPrice: item.compareAtUnitPrice ?? null,
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(orderItems).values({
          id: crypto.randomUUID(),
          orderId: data.id,
          itemId: lineItemId,
          version: 1,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          compareAtUnitPrice: item.compareAtUnitPrice ?? null,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    try {
      await db.batch(
        statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );
    } catch (error) {
      if (displayIdRetry < 3 && isOrderDisplayIdConflict(error)) {
        return this.create(data, displayIdRetry + 1);
      }
      throw error;
    }
    return { id: data.id, displayId };
  },

  async update(
    id: string,
    data: {
      email?: string;
      noNotification: boolean;
    },
  ): Promise<{ success: true } | { success: false; reason: "NOT_FOUND" }> {
    const db = await getDb();
    const updated = await db
      .update(orders)
      .set({
        email: data.email || null,
        noNotification: data.noNotification,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)));
    return Number(updated.meta.changes ?? 0) > 0
      ? { success: true }
      : { success: false, reason: "NOT_FOUND" };
  },

  async updateDraftFields(
    id: string,
    expectedUpdatedAt: string,
    data: { email?: string; noNotification?: boolean },
  ): Promise<
    | { success: true }
    | { success: false; reason: "NOT_FOUND" | "NOT_DRAFT" | "CONFLICT" }
  > {
    const db = await getDb();
    const nextTimestamp = new Date(
      Math.max(Date.now(), Date.parse(expectedUpdatedAt) + 1),
    ).toISOString();
    const updated = await db
      .update(orders)
      .set({
        ...(data.email !== undefined ? { email: data.email || null } : {}),
        ...(data.noNotification !== undefined
          ? { noNotification: data.noNotification }
          : {}),
        updatedAt: nextTimestamp,
      })
      .where(
        and(
          eq(orders.id, id),
          eq(orders.updatedAt, expectedUpdatedAt),
          eq(orders.isDraftOrder, true),
          eq(orders.status, "draft"),
          isNull(orders.canceledAt),
          isNull(orders.deletedAt),
        ),
      );
    if (Number(updated.meta.changes ?? 0) > 0) return { success: true };

    const current = firstOrNull(
      await db
        .select({ isDraftOrder: orders.isDraftOrder, status: orders.status })
        .from(orders)
        .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
        .limit(1),
    );
    if (!current) return { success: false, reason: "NOT_FOUND" };
    if (!current.isDraftOrder || current.status !== "draft")
      return { success: false, reason: "NOT_DRAFT" };
    return { success: false, reason: "CONFLICT" };
  },

  async deleteDraftOrder(
    id: string,
    expectedUpdatedAt: string,
  ): Promise<
    | { success: true }
    | {
        success: false;
        reason: "NOT_FOUND" | "NOT_DRAFT" | "CONFLICT" | "HAS_ACTIVITY";
      }
  > {
    const db = await getDb();
    const current = firstOrNull(
      await db
        .select({
          isDraftOrder: orders.isDraftOrder,
          status: orders.status,
          canceledAt: orders.canceledAt,
          updatedAt: orders.updatedAt,
        })
        .from(orders)
        .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
        .limit(1),
    );
    if (!current) return { success: false, reason: "NOT_FOUND" };
    if (
      !current.isDraftOrder ||
      current.status !== "draft" ||
      current.canceledAt
    )
      return { success: false, reason: "NOT_DRAFT" };
    if (current.updatedAt !== expectedUpdatedAt)
      return { success: false, reason: "CONFLICT" };

    const activeTransactions = db
      .select({ id: orderTransactions.id })
      .from(orderTransactions)
      .where(
        and(
          eq(orderTransactions.orderId, id),
          isNull(orderTransactions.deletedAt),
        ),
      )
      .limit(1);
    const paymentLinks = db
      .select({
        paymentCollectionId: orderPaymentCollections.paymentCollectionId,
      })
      .from(orderPaymentCollections)
      .where(eq(orderPaymentCollections.orderId, id))
      .limit(1);
    const fulfillmentLinks = db
      .select({ fulfillmentId: orderFulfillments.fulfillmentId })
      .from(orderFulfillments)
      .where(eq(orderFulfillments.orderId, id))
      .limit(1);
    const [transactions, payments, fulfillments] = await Promise.all([
      activeTransactions,
      paymentLinks,
      fulfillmentLinks,
    ]);
    if (transactions.length || payments.length || fulfillments.length)
      return { success: false, reason: "HAS_ACTIVITY" };

    const deletedAt = new Date(
      Math.max(Date.now(), Date.parse(expectedUpdatedAt) + 1),
    ).toISOString();
    const stillHasTransaction = db
      .select({ id: orderTransactions.id })
      .from(orderTransactions)
      .where(
        and(
          eq(orderTransactions.orderId, id),
          isNull(orderTransactions.deletedAt),
        ),
      )
      .limit(1);
    const stillHasPayment = db
      .select({
        paymentCollectionId: orderPaymentCollections.paymentCollectionId,
      })
      .from(orderPaymentCollections)
      .where(eq(orderPaymentCollections.orderId, id))
      .limit(1);
    const stillHasFulfillment = db
      .select({ fulfillmentId: orderFulfillments.fulfillmentId })
      .from(orderFulfillments)
      .where(eq(orderFulfillments.orderId, id))
      .limit(1);
    const tombstonedOrder = db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.deletedAt, deletedAt)))
      .limit(1);
    const statements: BatchItem<"sqlite">[] = [
      db
        .update(orders)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(
          and(
            eq(orders.id, id),
            eq(orders.updatedAt, expectedUpdatedAt),
            eq(orders.isDraftOrder, true),
            eq(orders.status, "draft"),
            isNull(orders.canceledAt),
            isNull(orders.deletedAt),
            notExists(stillHasTransaction),
            notExists(stillHasPayment),
            notExists(stillHasFulfillment),
          ),
        ),
      db
        .delete(orderPromotions)
        .where(and(eq(orderPromotions.orderId, id), exists(tombstonedOrder))),
      db
        .update(orderChanges)
        .set({
          status: "canceled",
          canceledAt: deletedAt,
          updatedAt: deletedAt,
        })
        .where(
          and(
            eq(orderChanges.orderId, id),
            eq(orderChanges.changeType, "edit"),
            inArray(orderChanges.status, ["pending", "requested"]),
            isNull(orderChanges.deletedAt),
            exists(tombstonedOrder),
          ),
        ),
    ];
    try {
      await db.batch(
        statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );
    } catch (error) {
      const latest = firstOrNull(
        await db
          .select({
            isDraftOrder: orders.isDraftOrder,
            status: orders.status,
            updatedAt: orders.updatedAt,
            canceledAt: orders.canceledAt,
          })
          .from(orders)
          .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
          .limit(1),
      );
      if (!latest) return { success: false, reason: "NOT_FOUND" };
      if (
        !latest.isDraftOrder ||
        latest.status !== "draft" ||
        latest.canceledAt
      )
        return { success: false, reason: "NOT_DRAFT" };
      if (latest.updatedAt !== expectedUpdatedAt)
        return { success: false, reason: "CONFLICT" };
      throw error;
    }

    const remains = firstOrNull(
      await db
        .select({ deletedAt: orders.deletedAt })
        .from(orders)
        .where(eq(orders.id, id))
        .limit(1),
    );
    if (remains?.deletedAt === deletedAt) return { success: true };
    if (!remains) return { success: false, reason: "NOT_FOUND" };
    if (!remains.deletedAt) {
      const [transactionsAfter, paymentsAfter, fulfillmentsAfter] =
        await Promise.all([
          db
            .select({ id: orderTransactions.id })
            .from(orderTransactions)
            .where(
              and(
                eq(orderTransactions.orderId, id),
                isNull(orderTransactions.deletedAt),
              ),
            )
            .limit(1),
          db
            .select({
              paymentCollectionId: orderPaymentCollections.paymentCollectionId,
            })
            .from(orderPaymentCollections)
            .where(eq(orderPaymentCollections.orderId, id))
            .limit(1),
          db
            .select({ fulfillmentId: orderFulfillments.fulfillmentId })
            .from(orderFulfillments)
            .where(eq(orderFulfillments.orderId, id))
            .limit(1),
        ]);
      if (
        transactionsAfter.length ||
        paymentsAfter.length ||
        fulfillmentsAfter.length
      )
        return { success: false, reason: "HAS_ACTIVITY" };
      return { success: false, reason: "CONFLICT" };
    }
    return { success: false, reason: "NOT_FOUND" };
  },

  async updateDraftItems(
    id: string,
    expectedVersion: number,
    orderFields: {
      email?: string;
      noNotification: boolean;
      shippingAddress: DraftOrderAddressSnapshot | null;
      billingAddress: DraftOrderAddressSnapshot | null;
      shippingMethods: Array<{
        id: string;
        shippingOptionId: string;
        name: string;
        description?: JsonValue | null;
        amount: number;
        isCustomAmount: boolean;
      }>;
      promotionEvaluation: Extract<DraftPromotionEvaluation, { success: true }>;
      editConfirmation?: {
        orderChangeId: string;
        expectedUpdatedAt: string;
        actorId?: string;
      };
    },
    items: Array<{
      id: string;
      title: string;
      subtitle?: string | null;
      thumbnail?: string | null;
      variantId?: string | null;
      productId?: string | null;
      productTitle?: string | null;
      productDescription?: string | null;
      productSubtitle?: string | null;
      productType?: string | null;
      productTypeId?: string | null;
      productCollectionId?: string | null;
      productCollection?: string | null;
      productHandle?: string | null;
      variantSku?: string | null;
      variantBarcode?: string | null;
      variantTitle?: string | null;
      variantOptionValues?: JsonValue | null;
      requiresShipping: boolean;
      isDiscountable: boolean;
      isGiftcard: boolean;
      isTaxInclusive: boolean;
      isCustomPrice: boolean;
      unitPrice: number;
      compareAtUnitPrice?: number | null;
      quantity: number;
    }>,
  ): Promise<
    | { success: true; version: number }
    | {
        success: false;
        reason:
          | "NOT_FOUND"
          | "NOT_DRAFT"
          | "VERSION_CONFLICT"
          | "HAS_ADJUSTMENTS"
          | "INVALID_TOTAL"
          | "EDIT_CONFLICT"
          | "EMPTY_EDIT";
      }
  > {
    const db = await getDb();
    const order = firstOrNull(
      await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
        .limit(1),
    );
    if (!order) return { success: false, reason: "NOT_FOUND" };
    if (!order.isDraftOrder || order.status !== "draft" || order.canceledAt)
      return { success: false, reason: "NOT_DRAFT" };
    if (order.version !== expectedVersion)
      return { success: false, reason: "VERSION_CONFLICT" };
    if (!orderFields.editConfirmation) {
      const activeEdit = firstOrNull(
        await db
          .select({ id: orderChanges.id })
          .from(orderChanges)
          .where(
            and(
              eq(orderChanges.orderId, id),
              eq(orderChanges.changeType, "edit"),
              inArray(orderChanges.status, ["pending", "requested"]),
              isNull(orderChanges.deletedAt),
            ),
          )
          .limit(1),
      );
      if (activeEdit) return { success: false, reason: "EDIT_CONFLICT" };
    }

    const [itemRows, summaryRows, shippingRows, transactionRows, creditRows] =
      await Promise.all([
        db
          .select({ item: orderLineItems, state: orderItems })
          .from(orderItems)
          .innerJoin(orderLineItems, eq(orderLineItems.id, orderItems.itemId))
          .where(
            and(
              eq(orderItems.orderId, id),
              eq(orderItems.version, order.version),
              isNull(orderItems.deletedAt),
              isNull(orderLineItems.deletedAt),
            ),
          ),
        db
          .select()
          .from(orderSummaries)
          .where(
            and(
              eq(orderSummaries.orderId, id),
              eq(orderSummaries.version, order.version),
              isNull(orderSummaries.deletedAt),
            ),
          )
          .limit(1),
        db
          .select({
            id: orderShippings.id,
            shippingMethodId: orderShippings.shippingMethodId,
            shippingOptionId: orderShippingMethods.shippingOptionId,
            amount: orderShippingMethods.amount,
          })
          .from(orderShippings)
          .innerJoin(
            orderShippingMethods,
            eq(orderShippingMethods.id, orderShippings.shippingMethodId),
          )
          .where(
            and(
              eq(orderShippings.orderId, id),
              eq(orderShippings.version, order.version),
              isNull(orderShippings.returnId),
              isNull(orderShippings.exchangeId),
              isNull(orderShippings.claimId),
              isNull(orderShippings.deletedAt),
            ),
          ),
        db
          .select({ id: orderTransactions.id })
          .from(orderTransactions)
          .where(
            and(
              eq(orderTransactions.orderId, id),
              eq(orderTransactions.version, order.version),
              isNull(orderTransactions.deletedAt),
            ),
          )
          .limit(1),
        db
          .select({ id: orderCreditLines.id })
          .from(orderCreditLines)
          .where(
            and(
              eq(orderCreditLines.orderId, id),
              eq(orderCreditLines.version, order.version),
              isNull(orderCreditLines.deletedAt),
            ),
          )
          .limit(1),
      ]);
    if (transactionRows.length || creditRows.length)
      return { success: false, reason: "HAS_ADJUSTMENTS" };

    if (orderFields.editConfirmation) {
      const edit = firstOrNull(
        await db
          .select({ id: orderChanges.id, version: orderChanges.version })
          .from(orderChanges)
          .where(
            and(
              eq(orderChanges.id, orderFields.editConfirmation.orderChangeId),
              eq(orderChanges.orderId, id),
              eq(orderChanges.changeType, "edit"),
              eq(
                orderChanges.updatedAt,
                orderFields.editConfirmation.expectedUpdatedAt,
              ),
              inArray(orderChanges.status, ["pending", "requested"]),
              isNull(orderChanges.deletedAt),
            ),
          )
          .limit(1),
      );
      if (!edit || edit.version !== order.version + 1)
        return { success: false, reason: "EDIT_CONFLICT" };
      const actions = await db
        .select({ id: orderChangeActions.id })
        .from(orderChangeActions)
        .where(
          and(
            eq(orderChangeActions.orderChangeId, edit.id),
            eq(orderChangeActions.applied, false),
            isNull(orderChangeActions.deletedAt),
          ),
        )
        .limit(1);
      if (actions.length === 0) return { success: false, reason: "EMPTY_EDIT" };
    }

    const lineIds = itemRows.map(({ item }) => item.id);
    const [adjustmentRows, shippingAdjustmentRows, paymentRows] =
      await Promise.all([
        lineIds.length
          ? db
              .select({
                id: orderLineItemAdjustments.id,
                amount: orderLineItemAdjustments.amount,
                promotionId: orderLineItemAdjustments.promotionId,
              })
              .from(orderLineItemAdjustments)
              .where(
                and(
                  inArray(orderLineItemAdjustments.itemId, lineIds),
                  eq(orderLineItemAdjustments.version, order.version),
                  isNull(orderLineItemAdjustments.deletedAt),
                ),
              )
              .limit(1)
          : Promise.resolve([]),
        shippingRows.length
          ? db
              .select({
                id: orderShippingMethodAdjustments.id,
                amount: orderShippingMethodAdjustments.amount,
                promotionId: orderShippingMethodAdjustments.promotionId,
              })
              .from(orderShippingMethodAdjustments)
              .where(
                and(
                  inArray(
                    orderShippingMethodAdjustments.shippingMethodId,
                    shippingRows.map((row) => row.shippingMethodId),
                  ),
                  eq(orderShippingMethodAdjustments.version, order.version),
                  isNull(orderShippingMethodAdjustments.deletedAt),
                ),
              )
              .limit(1)
          : Promise.resolve([]),
        db
          .select({ id: orderPaymentCollections.paymentCollectionId })
          .from(orderPaymentCollections)
          .where(eq(orderPaymentCollections.orderId, id))
          .limit(1),
      ]);
    if (
      adjustmentRows.some((row) => row.promotionId === null) ||
      shippingAdjustmentRows.some((row) => row.promotionId === null) ||
      paymentRows.length ||
      shippingRows.some((row) => row.shippingOptionId === null)
    )
      return { success: false, reason: "HAS_ADJUSTMENTS" };

    const nextItemTotal = calculateDraftOrderTotal(items);
    const previousItemTotal = calculateDraftOrderTotal(
      itemRows.map(({ item, state }) => ({
        quantity: state.quantity,
        unitPrice: state.unitPrice ?? item.unitPrice ?? 0,
      })),
    );
    const previousTotals = summaryRows[0]?.totals;
    const totalsRecord =
      previousTotals &&
      typeof previousTotals === "object" &&
      !Array.isArray(previousTotals)
        ? (previousTotals as Record<string, unknown>)
        : null;
    if (
      nextItemTotal === null ||
      previousItemTotal === null ||
      !totalsRecord ||
      totalsRecord.itemsTotal !== previousItemTotal ||
      totalsRecord.discountTotal !==
        adjustmentRows.reduce((sum, row) => sum + row.amount, 0) +
          shippingAdjustmentRows.reduce((sum, row) => sum + row.amount, 0) ||
      totalsRecord.shippingTotal !==
        shippingRows.reduce((sum, row) => sum + row.amount, 0) ||
      typeof totalsRecord.total !== "number" ||
      !Number.isSafeInteger(totalsRecord.total)
    )
      return { success: false, reason: "HAS_ADJUSTMENTS" };

    const nextVersion = order.version + 1;
    const now = new Date(
      Math.max(Date.now(), Date.parse(order.updatedAt) + 1 || Date.now()),
    ).toISOString();
    const expectedItemIds = JSON.stringify(
      itemRows.map(({ state }) => state.id),
    );
    const shippingAddressId = orderFields.shippingAddress
      ? crypto.randomUUID()
      : null;
    const billingSharesShipping = sameDraftAddress(
      orderFields.shippingAddress,
      orderFields.billingAddress,
    );
    const billingAddressId = billingSharesShipping
      ? shippingAddressId
      : orderFields.billingAddress
        ? crypto.randomUUID()
        : null;
    const itemSnapshots = items.map((item) => ({
      id: item.id,
      stateId: crypto.randomUUID(),
      item,
    }));
    const shippingSnapshots = orderFields.shippingMethods.map((method) => ({
      ...method,
    }));
    if (
      new Set(itemSnapshots.map((item) => item.id)).size !==
        itemSnapshots.length ||
      itemSnapshots.some((item) => !item.id) ||
      new Set(shippingSnapshots.map((method) => method.shippingOptionId))
        .size !== shippingSnapshots.length ||
      shippingSnapshots.some(
        (method) =>
          !Number.isSafeInteger(method.amount) ||
          method.amount < 0 ||
          typeof method.isCustomAmount !== "boolean",
      )
    )
      return { success: false, reason: "HAS_ADJUSTMENTS" };

    const region = order.regionId
      ? firstOrNull(
          await db
            .select({
              automaticTaxes: regions.automaticTaxes,
              isTaxInclusive: regions.isTaxInclusive,
            })
            .from(regions)
            .where(
              and(eq(regions.id, order.regionId), isNull(regions.deletedAt)),
            )
            .limit(1),
        )
      : null;
    const taxLines =
      region?.automaticTaxes && orderFields.shippingAddress?.countryCode
        ? await calculateTaxLines({
            context: {
              address: {
                address1: orderFields.shippingAddress.address1,
                address2: orderFields.shippingAddress.address2,
                city: orderFields.shippingAddress.city,
                countryCode: orderFields.shippingAddress.countryCode,
                provinceCode: orderFields.shippingAddress.province,
                postalCode: orderFields.shippingAddress.postalCode,
              },
              currencyCode: order.currencyCode,
              customerId: order.customerId,
            },
            itemLines: itemSnapshots.map(({ id, item }) => ({
              id,
              unitAmount: item.unitPrice,
              quantity: item.quantity,
              productId: item.productId ?? undefined,
              productTypeId: item.productTypeId ?? undefined,
            })),
            shippingLines: shippingSnapshots.map((method) => ({
              id: method.id,
              amount: method.amount,
              shippingOptionId: method.shippingOptionId,
            })),
          })
        : [];
    const totals = calculateDraftOrderSummary({
      items: itemSnapshots.map(({ id, item }) => ({
        id,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        isTaxInclusive: item.isTaxInclusive,
      })),
      shippingMethods: shippingSnapshots.map((method) => ({
        id: method.id,
        amount: method.amount,
        isTaxInclusive: region?.isTaxInclusive ?? false,
      })),
      itemAdjustments: orderFields.promotionEvaluation.itemAdjustments.map(
        (adjustment) => ({
          itemId: adjustment.itemId,
          amount: adjustment.amount,
        }),
      ),
      shippingAdjustments:
        orderFields.promotionEvaluation.shippingAdjustments.map(
          (adjustment) => ({
            shippingMethodId: adjustment.shippingMethodId,
            amount: adjustment.amount,
          }),
        ),
      taxLines,
    });
    if (!totals) return { success: false, reason: "INVALID_TOTAL" };

    const statements: BatchItem<"sqlite">[] = [
      batchGuard(
        db,
        sql`EXISTS (
          SELECT 1 FROM orders o
          WHERE o.id = ${id}
            AND o.version = ${order.version}
            AND o.updated_at = ${order.updatedAt}
            AND o.status = 'draft'
            AND o.is_draft_order = 1
            AND o.canceled_at IS NULL
            AND o.deleted_at IS NULL
            AND (
              SELECT COUNT(*) FROM order_items oi
              WHERE oi.order_id = o.id
                AND oi.version = o.version
                AND oi.deleted_at IS NULL
            ) = json_array_length(${expectedItemIds})
            AND NOT EXISTS (
              SELECT 1 FROM json_each(${expectedItemIds}) expected
              LEFT JOIN order_items oi
                -- json_each yields a string element as plain text, not JSON:
                -- json_extract on it raises "malformed JSON".
                ON oi.id = expected.value
               AND oi.order_id = o.id
               AND oi.version = o.version
               AND oi.deleted_at IS NULL
              WHERE oi.id IS NULL
            )
          )`,
      ),
    ];
    if (!orderFields.editConfirmation) {
      const activeEdit = db
        .select({ id: orderChanges.id })
        .from(orderChanges)
        .where(
          and(
            eq(orderChanges.orderId, id),
            eq(orderChanges.changeType, "edit"),
            inArray(orderChanges.status, ["pending", "requested"]),
            isNull(orderChanges.deletedAt),
          ),
        )
        .limit(1);
      statements.push(batchGuard(db, sql`NOT EXISTS ${activeEdit}`));
    }
    if (orderFields.editConfirmation) {
      const confirmation = orderFields.editConfirmation;
      const pendingEdit = db
        .select({ id: orderChanges.id })
        .from(orderChanges)
        .where(
          and(
            eq(orderChanges.id, confirmation.orderChangeId),
            eq(orderChanges.orderId, id),
            eq(orderChanges.changeType, "edit"),
            eq(orderChanges.version, nextVersion),
            eq(orderChanges.updatedAt, confirmation.expectedUpdatedAt),
            inArray(orderChanges.status, ["pending", "requested"]),
            isNull(orderChanges.deletedAt),
          ),
        )
        .limit(1);
      const pendingActions = db
        .select({ id: orderChangeActions.id })
        .from(orderChangeActions)
        .where(
          and(
            eq(orderChangeActions.orderChangeId, confirmation.orderChangeId),
            eq(orderChangeActions.applied, false),
            isNull(orderChangeActions.deletedAt),
          ),
        )
        .limit(1);
      statements.push(
        batchGuard(
          db,
          sql`EXISTS ${pendingEdit}
            AND EXISTS ${pendingActions}`,
        ),
      );
    }
    if (orderFields.shippingAddress && shippingAddressId)
      statements.push(
        db.insert(orderAddresses).values({
          id: shippingAddressId,
          customerId: order.customerId,
          ...orderFields.shippingAddress,
          createdAt: now,
          updatedAt: now,
        }),
      );
    if (
      orderFields.billingAddress &&
      billingAddressId &&
      billingAddressId !== shippingAddressId
    )
      statements.push(
        db.insert(orderAddresses).values({
          id: billingAddressId,
          customerId: order.customerId,
          ...orderFields.billingAddress,
          createdAt: now,
          updatedAt: now,
        }),
      );
    statements.push(
      db
        .update(orders)
        .set({
          version: nextVersion,
          email: orderFields.email?.trim() || null,
          noNotification: orderFields.noNotification,
          shippingAddressId,
          billingAddressId,
          updatedAt: now,
        })
        .where(
          and(
            eq(orders.id, id),
            eq(orders.version, order.version),
            eq(orders.updatedAt, order.updatedAt),
            eq(orders.status, "draft"),
            eq(orders.isDraftOrder, true),
            isNull(orders.canceledAt),
            isNull(orders.deletedAt),
          ),
        ),
    );
    if (orderFields.editConfirmation) {
      const confirmation = orderFields.editConfirmation;
      statements.push(
        db
          .update(orderChanges)
          .set({
            status: "confirmed",
            confirmedBy: confirmation.actorId ?? null,
            confirmedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(orderChanges.id, confirmation.orderChangeId),
              eq(orderChanges.orderId, id),
              eq(orderChanges.changeType, "edit"),
              eq(orderChanges.version, nextVersion),
              eq(orderChanges.updatedAt, confirmation.expectedUpdatedAt),
              inArray(orderChanges.status, ["pending", "requested"]),
              isNull(orderChanges.deletedAt),
            ),
          ),
        db
          .update(orderChangeActions)
          .set({ applied: true, updatedAt: now })
          .where(
            and(
              eq(orderChangeActions.orderChangeId, confirmation.orderChangeId),
              eq(orderChangeActions.applied, false),
              isNull(orderChangeActions.deletedAt),
            ),
          ),
      );
    }
    statements.push(
      db.insert(orderSummaries).values({
        id: crypto.randomUUID(),
        orderId: id,
        version: nextVersion,
        totals,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const lineItemRows = itemSnapshots.map(({ id: lineItemId, item }) => ({
      id: lineItemId,
      title: item.title,
      subtitle: item.subtitle ?? null,
      thumbnail: item.thumbnail ?? null,
      variantId: item.variantId ?? null,
      productId: item.productId ?? null,
      productTitle: item.productTitle ?? null,
      productDescription: item.productDescription ?? null,
      productSubtitle: item.productSubtitle ?? null,
      productType: item.productType ?? null,
      productTypeId: item.productTypeId ?? null,
      productCollectionId: item.productCollectionId ?? null,
      productCollection: item.productCollection ?? null,
      productHandle: item.productHandle ?? null,
      variantSku: item.variantSku ?? null,
      variantBarcode: item.variantBarcode ?? null,
      variantTitle: item.variantTitle ?? null,
      variantOptionValues: item.variantOptionValues ?? null,
      requiresShipping: item.requiresShipping,
      isDiscountable: item.isDiscountable,
      isGiftcard: item.isGiftcard,
      isTaxInclusive: item.isTaxInclusive,
      isCustomPrice: item.isCustomPrice,
      unitPrice: item.unitPrice,
      compareAtUnitPrice: item.compareAtUnitPrice ?? null,
      createdAt: now,
      updatedAt: now,
    }));
    const itemStateRows = itemSnapshots.map(
      ({ id: lineItemId, stateId, item }) => ({
        id: stateId,
        orderId: id,
        itemId: lineItemId,
        version: nextVersion,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        compareAtUnitPrice: item.compareAtUnitPrice ?? null,
        createdAt: now,
        updatedAt: now,
      }),
    );
    for (const group of chunkForInsert(lineItemRows, 27))
      statements.push(db.insert(orderLineItems).values(group));
    for (const group of chunkForInsert(itemStateRows, 9))
      statements.push(db.insert(orderItems).values(group));

    const shippingMethodRows = shippingSnapshots.map((method) => ({
      id: method.id,
      name: method.name,
      description: method.description ?? null,
      amount: method.amount,
      isTaxInclusive: region?.isTaxInclusive ?? false,
      isCustomAmount: method.isCustomAmount,
      shippingOptionId: method.shippingOptionId,
      data: {},
      metadata: {},
      createdAt: now,
      updatedAt: now,
    }));
    const orderShippingRows = shippingSnapshots.map((method) => ({
      id: crypto.randomUUID(),
      orderId: id,
      shippingMethodId: method.id,
      version: nextVersion,
      createdAt: now,
      updatedAt: now,
    }));
    for (const group of chunkForInsert(shippingMethodRows, 10))
      statements.push(db.insert(orderShippingMethods).values(group));
    for (const group of chunkForInsert(orderShippingRows, 6))
      statements.push(db.insert(orderShippings).values(group));
    const itemTaxRows = taxLines.flatMap((line) =>
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
              metadata: {},
              createdAt: now,
              updatedAt: now,
            },
          ]
        : [],
    );
    const shippingTaxRows = taxLines.flatMap((line) =>
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
              metadata: {},
              createdAt: now,
              updatedAt: now,
            },
          ]
        : [],
    );
    for (const group of chunkForInsert(itemTaxRows, 11))
      statements.push(db.insert(orderLineItemTaxLines).values(group));
    for (const group of chunkForInsert(shippingTaxRows, 11))
      statements.push(db.insert(orderShippingMethodTaxLines).values(group));
    statements.push(
      db.delete(orderPromotions).where(eq(orderPromotions.orderId, id)),
    );
    if (orderFields.promotionEvaluation.promotionIds.length)
      statements.push(
        db.insert(orderPromotions).values(
          orderFields.promotionEvaluation.promotionIds.map((promotionId) => ({
            orderId: id,
            promotionId,
            createdAt: now,
            updatedAt: now,
          })),
        ),
      );
    const lineItemAdjustments =
      orderFields.promotionEvaluation.itemAdjustments.map((adjustment) => ({
        id: crypto.randomUUID(),
        itemId: adjustment.itemId,
        version: nextVersion,
        description: adjustment.code,
        code: adjustment.code,
        amount: adjustment.amount,
        promotionId: adjustment.promotionId,
        createdAt: now,
        updatedAt: now,
      }));
    const shippingMethodAdjustments =
      orderFields.promotionEvaluation.shippingAdjustments.map((adjustment) => ({
        id: crypto.randomUUID(),
        shippingMethodId: adjustment.shippingMethodId,
        version: nextVersion,
        description: adjustment.code,
        code: adjustment.code,
        amount: adjustment.amount,
        promotionId: adjustment.promotionId,
        createdAt: now,
        updatedAt: now,
      }));
    for (const group of chunkForInsert(lineItemAdjustments, 8))
      statements.push(db.insert(orderLineItemAdjustments).values(group));
    for (const group of chunkForInsert(shippingMethodAdjustments, 8))
      statements.push(db.insert(orderShippingMethodAdjustments).values(group));
    try {
      await db.batch(
        statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );
    } catch (error) {
      const latest = firstOrNull(
        await db
          .select({
            version: orders.version,
            status: orders.status,
            updatedAt: orders.updatedAt,
          })
          .from(orders)
          .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
          .limit(1),
      );
      if (
        !latest ||
        latest.version !== expectedVersion ||
        latest.status !== "draft" ||
        latest.updatedAt !== order.updatedAt
      )
        return { success: false, reason: "VERSION_CONFLICT" };
      if (!orderFields.editConfirmation) {
        const activeEdit = firstOrNull(
          await db
            .select({ id: orderChanges.id })
            .from(orderChanges)
            .where(
              and(
                eq(orderChanges.orderId, id),
                eq(orderChanges.changeType, "edit"),
                inArray(orderChanges.status, ["pending", "requested"]),
                isNull(orderChanges.deletedAt),
              ),
            )
            .limit(1),
        );
        if (activeEdit) return { success: false, reason: "EDIT_CONFLICT" };
      }
      if (orderFields.editConfirmation) {
        const latestEdit = firstOrNull(
          await db
            .select({
              updatedAt: orderChanges.updatedAt,
              status: orderChanges.status,
            })
            .from(orderChanges)
            .where(
              and(
                eq(orderChanges.id, orderFields.editConfirmation.orderChangeId),
                eq(orderChanges.orderId, id),
                isNull(orderChanges.deletedAt),
              ),
            )
            .limit(1),
        );
        if (
          latestEdit?.updatedAt !==
            orderFields.editConfirmation.expectedUpdatedAt ||
          !latestEdit ||
          !["pending", "requested"].includes(latestEdit.status ?? "")
        )
          return { success: false, reason: "EDIT_CONFLICT" };
      }
      throw error;
    }
    return { success: true, version: nextVersion };
  },

  async convertDraftToOrder(id: string): Promise<
    | { success: true }
    | {
        success: false;
        reason:
          | "NOT_FOUND"
          | "NOT_DRAFT"
          | "INVALID_STATUS"
          | "CANCELED"
          | "EMPTY"
          | "PROMOTION_EXHAUSTED"
          | "CONFLICT";
      }
  > {
    const db = await getDb();
    const order = firstOrNull(
      await db
        .select({
          version: orders.version,
          status: orders.status,
          isDraftOrder: orders.isDraftOrder,
          customerId: orders.customerId,
          email: orders.email,
          canceledAt: orders.canceledAt,
          updatedAt: orders.updatedAt,
        })
        .from(orders)
        .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
        .limit(1),
    );
    if (!order) return { success: false, reason: "NOT_FOUND" };

    const activeEdit = firstOrNull(
      await db
        .select({ id: orderChanges.id })
        .from(orderChanges)
        .where(
          and(
            eq(orderChanges.orderId, id),
            eq(orderChanges.changeType, "edit"),
            inArray(orderChanges.status, ["pending", "requested"]),
            isNull(orderChanges.deletedAt),
          ),
        )
        .limit(1),
    );
    if (activeEdit) return { success: false, reason: "CONFLICT" };

    const lineItem = firstOrNull(
      await db
        .select({ id: orderItems.id })
        .from(orderItems)
        .where(
          and(
            eq(orderItems.orderId, id),
            eq(orderItems.version, order.version),
            isNull(orderItems.deletedAt),
          ),
        )
        .limit(1),
    );
    const preconditionFailure = draftOrderConversionFailure({
      isDraftOrder: order.isDraftOrder,
      status: order.status,
      canceledAt: order.canceledAt,
      hasLineItems: Boolean(lineItem),
    });
    if (preconditionFailure)
      return { success: false, reason: preconditionFailure };

    const [promotionRows, itemAdjustments, shippingAdjustments] =
      await Promise.all([
        db
          .select({ promotion: promotions, budget: promotionCampaignBudgets })
          .from(orderPromotions)
          .innerJoin(promotions, eq(promotions.id, orderPromotions.promotionId))
          .leftJoin(
            promotionCampaignBudgets,
            and(
              eq(promotionCampaignBudgets.campaignId, promotions.campaignId),
              isNull(promotionCampaignBudgets.deletedAt),
            ),
          )
          .where(eq(orderPromotions.orderId, id)),
        db
          .select({
            promotionId: orderLineItemAdjustments.promotionId,
            amount: orderLineItemAdjustments.amount,
          })
          .from(orderLineItemAdjustments)
          .innerJoin(
            orderItems,
            and(
              eq(orderItems.itemId, orderLineItemAdjustments.itemId),
              eq(orderItems.orderId, id),
              eq(orderItems.version, order.version),
              isNull(orderItems.deletedAt),
            ),
          )
          .where(
            and(
              eq(orderLineItemAdjustments.version, order.version),
              isNotNull(orderLineItemAdjustments.promotionId),
              isNull(orderLineItemAdjustments.deletedAt),
            ),
          ),
        db
          .select({
            promotionId: orderShippingMethodAdjustments.promotionId,
            amount: orderShippingMethodAdjustments.amount,
          })
          .from(orderShippingMethodAdjustments)
          .innerJoin(
            orderShippings,
            and(
              eq(
                orderShippings.shippingMethodId,
                orderShippingMethodAdjustments.shippingMethodId,
              ),
              eq(orderShippings.orderId, id),
              eq(orderShippings.version, order.version),
              isNull(orderShippings.returnId),
              isNull(orderShippings.exchangeId),
              isNull(orderShippings.claimId),
              isNull(orderShippings.deletedAt),
            ),
          )
          .where(
            and(
              eq(orderShippingMethodAdjustments.version, order.version),
              isNotNull(orderShippingMethodAdjustments.promotionId),
              isNull(orderShippingMethodAdjustments.deletedAt),
            ),
          ),
      ]);
    const discountsByPromotion = new Map<string, number>();
    for (const adjustment of [...itemAdjustments, ...shippingAdjustments]) {
      if (!adjustment.promotionId) continue;
      discountsByPromotion.set(
        adjustment.promotionId,
        (discountsByPromotion.get(adjustment.promotionId) ?? 0) +
          adjustment.amount,
      );
    }

    const previousTime = Date.parse(order.updatedAt);
    const updatedAt = new Date(
      Math.max(
        Date.now(),
        Number.isFinite(previousTime) ? previousTime + 1 : Date.now(),
      ),
    ).toISOString();
    const statements: BatchItem<"sqlite">[] = [
      batchGuard(
        db,
        sql`EXISTS (
          SELECT 1 FROM orders o
          WHERE o.id = ${id}
            AND o.version = ${order.version}
            AND o.updated_at = ${order.updatedAt}
            AND o.status = 'draft'
            AND o.is_draft_order = 1
            AND o.canceled_at IS NULL
            AND o.deleted_at IS NULL
        ) AND NOT EXISTS (
          SELECT 1 FROM order_changes oc
          WHERE oc.order_id = ${id}
            AND oc.change_type = 'edit'
            AND oc.status IN ('pending', 'requested')
            AND oc.deleted_at IS NULL
        )`,
      ),
    ];
    for (const row of promotionRows) {
      const promotionDiscount = discountsByPromotion.get(row.promotion.id) ?? 0;
      if (promotionDiscount <= 0) continue;
      statements.push(
        db
          .update(promotions)
          .set({ used: sql`${promotions.used} + 1`, updatedAt })
          .where(eq(promotions.id, row.promotion.id)),
      );
      if (!row.budget) continue;
      const budgetUse = row.budget.type.includes("spend")
        ? promotionDiscount
        : 1;
      statements.push(
        db
          .update(promotionCampaignBudgets)
          .set({
            used: sql`${promotionCampaignBudgets.used} + ${budgetUse}`,
            updatedAt,
          })
          .where(eq(promotionCampaignBudgets.id, row.budget.id)),
      );
      if (
        row.budget.type === "use_by_attribute" ||
        row.budget.type === "spend_by_attribute"
      ) {
        const attributeValue =
          row.budget.attribute === "customer_id"
            ? order.customerId
            : row.budget.attribute === "email"
              ? order.email
              : null;
        if (!attributeValue) {
          if (row.budget.limit !== null)
            return { success: false, reason: "PROMOTION_EXHAUSTED" };
          continue;
        }
        // A builder, not db.run(sql): see batchGuard.
        statements.push(
          db
            .insert(promotionCampaignBudgetUsages)
            .values({
              id: crypto.randomUUID(),
              budgetId: row.budget.id,
              attributeValue,
              used: budgetUse,
              limit: row.budget.limit,
              createdAt: updatedAt,
              updatedAt,
            })
            .onConflictDoUpdate({
              target: [
                promotionCampaignBudgetUsages.attributeValue,
                promotionCampaignBudgetUsages.budgetId,
              ],
              targetWhere: sql`deleted_at IS NULL`,
              set: {
                used: sql`${promotionCampaignBudgetUsages.used} + excluded.used`,
                limit: sql`excluded."limit"`,
                updatedAt: sql`excluded.updated_at`,
              },
            }),
        );
      }
    }
    statements.push(
      db
        .update(orders)
        .set({ status: "pending", isDraftOrder: false, updatedAt })
        .where(
          and(
            eq(orders.id, id),
            eq(orders.version, order.version),
            eq(orders.status, "draft"),
            eq(orders.isDraftOrder, true),
            eq(orders.updatedAt, order.updatedAt),
            isNull(orders.canceledAt),
            isNull(orders.deletedAt),
          ),
        ),
    );
    try {
      await db.batch(
        statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );
      return { success: true };
    } catch (error) {
      const message = databaseErrorMessage(error);
      if (
        message.includes("promotions_limit_check") ||
        message.includes("promotion_campaign_budgets_limit_check") ||
        message.includes("promotion_campaign_budget_usages_limit_check")
      )
        return { success: false, reason: "PROMOTION_EXHAUSTED" };
      const latest = firstOrNull(
        await db
          .select({
            version: orders.version,
            status: orders.status,
            updatedAt: orders.updatedAt,
          })
          .from(orders)
          .where(and(eq(orders.id, id), isNull(orders.deletedAt)))
          .limit(1),
      );
      if (
        !latest ||
        latest.version !== order.version ||
        latest.status !== "draft" ||
        latest.updatedAt !== order.updatedAt
      )
        return { success: false, reason: "CONFLICT" };
      const activeEditAfterConflict = firstOrNull(
        await db
          .select({ id: orderChanges.id })
          .from(orderChanges)
          .where(
            and(
              eq(orderChanges.orderId, id),
              eq(orderChanges.changeType, "edit"),
              inArray(orderChanges.status, ["pending", "requested"]),
              isNull(orderChanges.deletedAt),
            ),
          )
          .limit(1),
      );
      if (activeEditAfterConflict)
        return { success: false, reason: "CONFLICT" };
      throw error;
    }
  },

  async updateMetadata(id: string, metadata: Metadata) {
    const db = await getDb();
    await db
      .update(orders)
      .set({ metadata, updatedAt: new Date().toISOString() })
      .where(and(eq(orders.id, id), isNull(orders.deletedAt)));
  },
};
