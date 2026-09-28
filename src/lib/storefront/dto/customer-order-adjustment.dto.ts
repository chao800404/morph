import type {
  OrderClaimDTO,
  OrderExchangeDTO,
} from "@/lib/order/dto/order.dto";

/** Customer-visible claim data; internal notes and payment amounts stay private. */
export function toStoreCustomerClaim(claim: OrderClaimDTO) {
  return {
    id: claim.id,
    displayId: claim.displayId,
    type: claim.type,
    returnId: claim.returnId,
    createdAt: claim.createdAt,
    canceledAt: claim.canceledAt,
    items: claim.items.map((item) => ({
      id: item.id,
      title: item.title,
      sku: item.sku,
      quantity: item.quantity,
      reason: item.reason,
      isAdditionalItem: item.isAdditionalItem,
    })),
  };
}

/** Customer-visible exchange progress without internal location or payment data. */
export function toStoreCustomerExchange(exchange: OrderExchangeDTO) {
  return {
    id: exchange.id,
    displayId: exchange.displayId,
    returnId: exchange.returnId,
    createdAt: exchange.createdAt,
    canceledAt: exchange.canceledAt,
    returnStatus: exchange.returnStatus,
    inboundItems: exchange.inboundItems.map((item) => ({
      id: item.id,
      title: item.title,
      sku: item.sku,
      quantity: item.quantity,
      receivedQuantity: item.receivedQuantity,
    })),
    items: exchange.items.map((item) => ({
      id: item.id,
      title: item.title,
      sku: item.sku,
      quantity: item.quantity,
    })),
  };
}
