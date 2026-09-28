import type {
  OrderClaimDTO,
  OrderExchangeDTO,
} from "@/lib/order/dto/order.dto";
import {
  toStoreCustomerClaim,
  toStoreCustomerExchange,
} from "@/lib/storefront/dto/customer-order-adjustment.dto";

export type CustomerOrderAdjustmentsRequestDependencies = {
  findOwnedOrder(input: {
    orderId: string;
    customerId: string;
    email: string;
    salesChannelId: string | null;
  }): Promise<unknown | null>;
  listClaims(orderId: string): Promise<OrderClaimDTO[]>;
  listExchanges(orderId: string): Promise<OrderExchangeDTO[]>;
};

const privateJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "access-control-allow-headers":
        "content-type, x-publishable-api-key, x-storefront-host",
      "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "access-control-allow-origin": "*",
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
      vary: "x-publishable-api-key, x-storefront-host",
    },
  });

/** Read-only order adjustment surface for an already verified store customer. */
export async function handleCustomerOrderAdjustmentsRequest(
  method: string,
  path: string,
  input: {
    customer: { id: string; email: string };
    salesChannelId: string | null;
  },
  deps: CustomerOrderAdjustmentsRequestDependencies,
): Promise<Response | null> {
  if (method !== "GET") return null;
  const claimMatch = /^customers\/me\/orders\/([^/]+)\/claims$/.exec(path);
  const exchangeMatch =
    /^customers\/me\/orders\/([^/]+)\/exchanges$/.exec(path);
  if (!claimMatch && !exchangeMatch) return null;
  const orderId = (claimMatch ?? exchangeMatch)?.[1];
  if (!orderId) return privateJson({ error: "NOT_FOUND" }, 404);

  const ownedOrder = await deps.findOwnedOrder({
    orderId,
    customerId: input.customer.id,
    email: input.customer.email,
    salesChannelId: input.salesChannelId,
  });
  if (!ownedOrder) return privateJson({ error: "NOT_FOUND" }, 404);

  if (claimMatch) {
    const claims = await deps.listClaims(orderId);
    return privateJson({ claims: claims.map(toStoreCustomerClaim) });
  }
  const exchanges = await deps.listExchanges(orderId);
  return privateJson({ exchanges: exchanges.map(toStoreCustomerExchange) });
}
