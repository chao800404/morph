import { cartDal } from "@/lib/cart/dal/cart.dal";
import { cartReservationDal } from "@/lib/inventory/dal/cart-reservation.dal";
import { cartPaymentDal } from "@/lib/payment/dal/cart-payment.dal";
import { checkoutDal } from "@/lib/order/dal/checkout.dal";
import { cartPromotionDal } from "@/lib/promotion/dal/cart-promotion.dal";
import { cartShippingDal } from "@/lib/shipping/dal/cart-shipping.dal";
import { regionDal } from "@/lib/region/dal/region.dal";
import { storeCatalogDal } from "@/lib/storefront/dal/store-catalog.dal";
import { storeContextDal } from "@/lib/storefront/dal/store-context.dal";
import type { StoreContextDTO, StoreCatalogContextDTO } from "@/lib/storefront/dto/store-context.dto";
import { storeContextParamsSchema } from "@/lib/validations/store-api";
import {
  addStoreCartItemInputSchema,
  applyStoreCartPromotionInputSchema,
  cartIdSchema,
  cartItemIdSchema,
  createStoreCartInputSchema,
  createStorePaymentSessionInputSchema,
  paymentSessionIdSchema,
  promotionCodeSchema,
  selectStoreShippingMethodInputSchema,
  updateStoreCartItemInputSchema,
  updateStoreCartInputSchema,
} from "@/lib/validations/store-cart";
import { createFileRoute } from "@tanstack/react-router";

const jsonHeaders = {
  "access-control-allow-headers":
    "content-type, x-publishable-api-key, x-storefront-host",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
  "content-type": "application/json; charset=utf-8",
  vary: "x-publishable-api-key, x-storefront-host",
};

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders });

const privateResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders, "cache-control": "private, no-store" },
  });

function contextOf(request: Request, catalog: true): Promise<StoreCatalogContextDTO | null>;
function contextOf(request: Request, catalog?: false): Promise<StoreContextDTO | null>;
async function contextOf(request: Request, catalog = false): Promise<StoreCatalogContextDTO | null> {
  const url = new URL(request.url);
  const publishableKey =
    request.headers.get("x-publishable-api-key") ?? undefined;
  const parsed = storeContextParamsSchema.safeParse({
    regionId: url.searchParams.get("region_id") ?? undefined,
    countryCode: url.searchParams.get("country_code") ?? undefined,
  });
  if (!parsed.success) return null;
  const input = {
    publishableKey,
    hostname:
      request.headers.get("x-storefront-host") ??
      (!publishableKey ? request.headers.get("host") : null) ??
      undefined,
    regionId: parsed.data.regionId,
    countryCode: parsed.data.countryCode,
  };
  return catalog ? storeContextDal.resolveCatalog(input) : storeContextDal.resolve(input);
}

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const invalidContext = () =>
  privateResponse(
    {
      error: "INVALID_STORE_CONTEXT",
      message: "A valid publishable key or storefront domain is required",
    },
    401,
  );

const mutationResponse = (
  result: Awaited<ReturnType<typeof cartDal.addItem>>,
) => {
  if (result.success) return privateResponse({ cart: result.cart });
  const message = {
    NOT_FOUND: "Cart or line item not found",
    COMPLETED: "A completed cart cannot be changed",
    UNAVAILABLE: "The requested quantity is not available",
    NO_PRICE: "This variant has no price in the cart currency",
    INVALID_ADDRESS: "The address country is not available in this region",
  }[result.reason];
  return privateResponse(
    { error: result.reason, message },
    result.reason === "NOT_FOUND"
      ? 404
      : result.reason === "INVALID_ADDRESS"
        ? 422
        : 409,
  );
};

export const Route = createFileRoute("/_backend/api/store/$")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: jsonHeaders }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const path = url.pathname
          .replace(/^\/api\/store\/?/, "")
          .replace(/\/$/, "");
        if (/^(?:products(?:\/|$)|assets\/)/.test(path)) {
          const catalogContext = await contextOf(request, true);
          if (!catalogContext) return invalidContext();
          return (await handleStoreCatalogGet(request, catalogContext)) ?? response({ error: "NOT_FOUND" }, 404);
        }
        const context = await contextOf(request);
        if (!context) {
          return response(
            {
              error: "INVALID_STORE_CONTEXT",
              message:
                "A valid publishable key or storefront domain is required",
            },
            401,
          );
        }


        if (path === "collections") {
          return response({
            collections: await storeCatalogDal.listCollections(
              context.salesChannelId,
            ),
            context,
          });
        }

        if (path === "categories") {
          return response({
            categories: await storeCatalogDal.listCategories(
              context.salesChannelId,
            ),
            context,
          });
        }

        if (path === "regions") {
          const region = await regionDal.findDetail(context.regionId);
          if (!region)
            return response(
              { error: "NOT_FOUND", message: "Region not found" },
              404,
            );
          return response({
            region: {
              id: region.id,
              name: region.name,
              currencyCode: region.currencyCode,
              automaticTaxes: region.automaticTaxes,
              isTaxInclusive: region.isTaxInclusive,
              countries: region.countries.map((country) => ({
                code: country.iso2,
                name: country.displayName,
              })),
            },
            context,
          });
        }

        const shippingOptionsMatch = /^carts\/([^/]+)\/shipping-options$/.exec(
          path,
        );
        if (shippingOptionsMatch) {
          const cartId = cartIdSchema.safeParse(shippingOptionsMatch[1]);
          if (!cartId.success)
            return privateResponse(
              { error: "INVALID_REQUEST", message: "Invalid cart ID" },
              400,
            );
          const cart = await cartDal.findById(
            cartId.data,
            context.salesChannelId,
          );
          if (!cart)
            return privateResponse(
              { error: "NOT_FOUND", message: "Cart not found" },
              404,
            );
          return privateResponse({
            shippingOptions: await cartShippingDal.listAvailable(
              cartId.data,
              context.salesChannelId,
            ),
          });
        }

        const paymentProvidersMatch =
          /^carts\/([^/]+)\/payment-providers$/.exec(path);
        if (paymentProvidersMatch) {
          const cartId = cartIdSchema.safeParse(paymentProvidersMatch[1]);
          if (!cartId.success)
            return privateResponse(
              { error: "INVALID_REQUEST", message: "Invalid cart ID" },
              400,
            );
          const cart = await cartDal.findById(
            cartId.data,
            context.salesChannelId,
          );
          if (!cart)
            return privateResponse(
              { error: "NOT_FOUND", message: "Cart not found" },
              404,
            );
          return privateResponse({
            paymentProviderIds: await cartPaymentDal.listProviders(
              cart.regionId,
            ),
          });
        }

        const cartMatch = /^carts\/([^/]+)$/.exec(path);
        if (cartMatch) {
          const cartId = cartIdSchema.safeParse(cartMatch[1]);
          if (!cartId.success)
            return privateResponse(
              { error: "INVALID_REQUEST", message: "Invalid cart ID" },
              400,
            );
          // Scope first: renewing before the channel-scoped lookup extended
          // another channel's reservations for anyone who knew a cart id, even
          // though the response was still a 404.
          const cart = await cartDal.findById(
            cartId.data,
            context.salesChannelId,
          );
          if (cart) await cartReservationDal.renewCart(cartId.data);
          return cart
            ? privateResponse({ cart })
            : privateResponse(
                { error: "NOT_FOUND", message: "Cart not found" },
                404,
              );
        }

        return response(
          { error: "NOT_FOUND", message: "Store API endpoint not found" },
          404,
        );
      },
      POST: async ({ request }) => {
        const path = new URL(request.url).pathname
          .replace(/^\/api\/store\/?/, "")
          .replace(/\/$/, "");
        const context = await contextOf(request);
        if (!context) return invalidContext();
        if (path === "carts") {
          const parsed = createStoreCartInputSchema.safeParse(
            (await readJson(request)) ?? {},
          );
          if (!parsed.success)
            return privateResponse(
              {
                error: "INVALID_REQUEST",
                message: "Invalid cart data",
                details: parsed.error.flatten().fieldErrors,
              },
              400,
            );
          return privateResponse(
            { cart: await cartDal.create(context, parsed.data.email) },
            201,
          );
        }
        const promotionMatch = /^carts\/([^/]+)\/promotions$/.exec(path);
        if (promotionMatch) {
          const cartId = cartIdSchema.safeParse(promotionMatch[1]);
          const parsed = applyStoreCartPromotionInputSchema.safeParse(
            await readJson(request),
          );
          if (!cartId.success || !parsed.success)
            return privateResponse(
              { error: "INVALID_REQUEST", message: "Invalid promotion code" },
              400,
            );
          const cart = await cartDal.findById(
            cartId.data,
            context.salesChannelId,
          );
          if (!cart)
            return privateResponse(
              { error: "NOT_FOUND", message: "Cart not found" },
              404,
            );
          if (cart.completedAt)
            return privateResponse(
              {
                error: "COMPLETED",
                message: "A completed cart cannot be changed",
              },
              409,
            );
          const result = await cartPromotionDal.applyCode(
            cartId.data,
            parsed.data.code,
          );
          if (!result.success)
            return privateResponse(
              {
                error: result.reason,
                message:
                  result.reason === "NOT_FOUND"
                    ? "Promotion code not found"
                    : "Promotion code is not active",
              },
              result.reason === "NOT_FOUND" ? 404 : 409,
            );
          return privateResponse({
            cart: await cartDal.findById(cartId.data, context.salesChannelId),
          });
        }
        const shippingMatch = /^carts\/([^/]+)\/shipping-methods$/.exec(path);
        if (shippingMatch) {
          const cartId = cartIdSchema.safeParse(shippingMatch[1]);
          const parsed = selectStoreShippingMethodInputSchema.safeParse(
            await readJson(request),
          );
          if (!cartId.success || !parsed.success)
            return privateResponse(
              { error: "INVALID_REQUEST", message: "Invalid shipping method" },
              400,
            );
          const result = await cartShippingDal.select(
            cartId.data,
            context.salesChannelId,
            parsed.data.optionId,
          );
          if (!result.success)
            return privateResponse(
              {
                error: result.reason,
                message:
                  result.reason === "NOT_FOUND"
                    ? "Cart not found"
                    : result.reason === "ADDRESS_REQUIRED"
                      ? "A shipping address is required"
                      : "Shipping option is not available",
              },
              result.reason === "NOT_FOUND" ? 404 : 409,
            );
          return privateResponse({
            cart: await cartDal.findById(cartId.data, context.salesChannelId),
          });
        }
        const collectionMatch = /^carts\/([^/]+)\/payment-collections$/.exec(
          path,
        );
        if (collectionMatch) {
          const cartId = cartIdSchema.safeParse(collectionMatch[1]);
          if (!cartId.success)
            return privateResponse(
              { error: "INVALID_REQUEST", message: "Invalid cart ID" },
              400,
            );
          const result = await cartPaymentDal.ensureCollection(
            cartId.data,
            context.salesChannelId,
          );
          return result.success
            ? privateResponse({ paymentCollection: result.value }, 201)
            : privateResponse(
                {
                  error: result.reason,
                  message: "Payment collection could not be created",
                },
                result.reason === "NOT_FOUND" ? 404 : 409,
              );
        }
        const sessionMatch = /^carts\/([^/]+)\/payment-sessions$/.exec(path);
        if (sessionMatch) {
          const cartId = cartIdSchema.safeParse(sessionMatch[1]);
          const parsed = createStorePaymentSessionInputSchema.safeParse(
            await readJson(request),
          );
          if (!cartId.success || !parsed.success)
            return privateResponse(
              { error: "INVALID_REQUEST", message: "Invalid payment session" },
              400,
            );
          const result = await cartPaymentDal.createSession(
            cartId.data,
            context.salesChannelId,
            parsed.data.providerId,
          );
          return result.success
            ? privateResponse({ paymentCollection: result.value }, 201)
            : privateResponse(
                {
                  error: result.reason,
                  message: "Payment session could not be created",
                },
                result.reason === "NOT_FOUND" ? 404 : 409,
              );
        }
        const authorizeMatch =
          /^carts\/([^/]+)\/payment-sessions\/([^/]+)\/authorize$/.exec(path);
        if (authorizeMatch) {
          const cartId = cartIdSchema.safeParse(authorizeMatch[1]);
          const sessionId = paymentSessionIdSchema.safeParse(authorizeMatch[2]);
          if (!cartId.success || !sessionId.success)
            return privateResponse(
              { error: "INVALID_REQUEST", message: "Invalid payment session" },
              400,
            );
          const result = await cartPaymentDal.authorizeSession(
            cartId.data,
            context.salesChannelId,
            sessionId.data,
          );
          return result.success
            ? privateResponse({ paymentCollection: result.value })
            : privateResponse(
                {
                  error: result.reason,
                  message: "Payment could not be authorized",
                },
                result.reason === "NOT_FOUND" ? 404 : 409,
              );
        }
        const completeMatch = /^carts\/([^/]+)\/complete$/.exec(path);
        if (completeMatch) {
          const cartId = cartIdSchema.safeParse(completeMatch[1]);
          if (!cartId.success)
            return privateResponse(
              { error: "INVALID_REQUEST", message: "Invalid cart ID" },
              400,
            );
          const result = await checkoutDal.complete(
            cartId.data,
            context.salesChannelId,
          );
          return result.success
            ? privateResponse(
                { order: { id: result.orderId, displayId: result.displayId } },
                201,
              )
            : privateResponse(
                {
                  error: result.reason,
                  message: {
                    NOT_FOUND: "Cart not found",
                    EMPTY_CART: "Cart is empty",
                    EMAIL_REQUIRED: "Customer email is required",
                    ADDRESS_REQUIRED: "Shipping address is required",
                    SHIPPING_REQUIRED: "Shipping method is required",
                    PAYMENT_REQUIRED: "An authorized payment is required",
                    PAYMENT_MISMATCH:
                      "Payment amount no longer matches the cart",
                    PROMOTION_EXHAUSTED:
                      "A promotion reached its usage or campaign budget limit",
                    RESERVATION_EXPIRED: "Inventory reservation has expired",
                  }[result.reason],
                },
                result.reason === "NOT_FOUND" ? 404 : 409,
              );
        }
        const match = /^carts\/([^/]+)\/line-items$/.exec(path);
        const cartId = cartIdSchema.safeParse(match?.[1]);
        const parsed = addStoreCartItemInputSchema.safeParse(
          await readJson(request),
        );
        if (!match || !cartId.success || !parsed.success)
          return privateResponse(
            { error: "INVALID_REQUEST", message: "Invalid cart line item" },
            400,
          );
        return mutationResponse(
          await cartDal.addItem(
            cartId.data,
            context,
            parsed.data.variantId,
            parsed.data.quantity,
          ),
        );
      },
      PATCH: async ({ request }) => {
        const path = new URL(request.url).pathname
          .replace(/^\/api\/store\/?/, "")
          .replace(/\/$/, "");
        const context = await contextOf(request);
        if (!context) return invalidContext();
        const cartMatch = /^carts\/([^/]+)$/.exec(path);
        if (cartMatch) {
          const cartId = cartIdSchema.safeParse(cartMatch[1]);
          const parsed = updateStoreCartInputSchema.safeParse(
            await readJson(request),
          );
          if (!cartId.success || !parsed.success)
            return privateResponse(
              { error: "INVALID_REQUEST", message: "Invalid cart data" },
              400,
            );
          return mutationResponse(
            await cartDal.updateDetails(
              cartId.data,
              context.salesChannelId,
              parsed.data,
            ),
          );
        }
        const match = /^carts\/([^/]+)\/line-items\/([^/]+)$/.exec(path);
        const cartId = cartIdSchema.safeParse(match?.[1]);
        const itemId = cartItemIdSchema.safeParse(match?.[2]);
        const parsed = updateStoreCartItemInputSchema.safeParse(
          await readJson(request),
        );
        if (!match || !cartId.success || !itemId.success || !parsed.success)
          return privateResponse(
            { error: "INVALID_REQUEST", message: "Invalid cart line item" },
            400,
          );
        return mutationResponse(
          await cartDal.updateItem(
            cartId.data,
            context.salesChannelId,
            itemId.data,
            parsed.data.quantity,
          ),
        );
      },
      DELETE: async ({ request }) => {
        const path = new URL(request.url).pathname
          .replace(/^\/api\/store\/?/, "")
          .replace(/\/$/, "");
        const context = await contextOf(request);
        if (!context) return invalidContext();
        const promotionMatch = /^carts\/([^/]+)\/promotions\/([^/]+)$/.exec(
          path,
        );
        if (promotionMatch) {
          const cartId = cartIdSchema.safeParse(promotionMatch[1]);
          const code = promotionCodeSchema.safeParse(
            decodeURIComponent(promotionMatch[2]),
          );
          if (!cartId.success || !code.success)
            return privateResponse(
              { error: "INVALID_REQUEST", message: "Invalid promotion code" },
              400,
            );
          const cart = await cartDal.findById(
            cartId.data,
            context.salesChannelId,
          );
          if (!cart)
            return privateResponse(
              { error: "NOT_FOUND", message: "Cart not found" },
              404,
            );
          if (cart.completedAt)
            return privateResponse(
              {
                error: "COMPLETED",
                message: "A completed cart cannot be changed",
              },
              409,
            );
          await cartPromotionDal.removeCode(cartId.data, code.data);
          return privateResponse({
            cart: await cartDal.findById(cartId.data, context.salesChannelId),
          });
        }
        const match = /^carts\/([^/]+)\/line-items\/([^/]+)$/.exec(path);
        const cartId = cartIdSchema.safeParse(match?.[1]);
        const itemId = cartItemIdSchema.safeParse(match?.[2]);
        if (!match || !cartId.success || !itemId.success)
          return privateResponse(
            { error: "INVALID_REQUEST", message: "Invalid cart line item" },
            400,
          );
        return mutationResponse(
          await cartDal.removeItem(
            cartId.data,
            context.salesChannelId,
            itemId.data,
          ),
        );
      },
    },
  },
});
import { handleStoreCatalogGet } from "@/lib/storefront/service/store-catalog-request";
