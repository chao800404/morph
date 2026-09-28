import {
  sendOrderClaimCreatedEmail,
  sendOrderExchangeCreatedEmail,
} from "@/lib/email";
import { orderReturnDal } from "@/lib/order/dal/order-return.dal";
import { orderDal } from "@/lib/order/dal/order.dal";

export const hasOrderChangeNotificationEmail = async (orderId: string) => {
  const order = await orderDal.findById(orderId);
  return Boolean(order?.email);
};

export async function notifyOrderClaimCreated(input: {
  orderId: string;
  claimId: string;
  type: "refund" | "replace";
}): Promise<boolean> {
  const [order, claims] = await Promise.all([
    orderDal.findById(input.orderId),
    orderReturnDal.listClaims(input.orderId),
  ]);
  const claim = claims.find((candidate) => candidate.id === input.claimId);
  if (!order?.email || !claim) return false;
  const delivery = await sendOrderClaimCreatedEmail({
    email: order.email,
    orderId: order.id,
    customerId: order.customerId,
    claimId: claim.id,
    currencyCode: order.currencyCode,
    orderDisplayId: order.displayId,
    claimDisplayId: claim.displayId,
    claimType: input.type,
    requiresReturn: Boolean(claim.returnId),
    refundAmount: input.type === "refund" ? claim.refundAmount : null,
    inboundItems: claim.items
      .filter((item) => !item.isAdditionalItem)
      .map((item) => ({
        title: item.title,
        sku: item.sku,
        quantity: item.quantity,
      })),
    outboundItems: claim.items
      .filter((item) => item.isAdditionalItem)
      .map((item) => ({
        title: item.title,
        sku: item.sku,
        quantity: item.quantity,
      })),
    returnShipping: claim.returnShipping,
    outboundShipping: claim.outboundShipping,
  });
  return delivery.success;
}

export async function notifyOrderExchangeCreated(input: {
  orderId: string;
  returnId: string;
}): Promise<boolean> {
  const [order, exchanges] = await Promise.all([
    orderDal.findById(input.orderId),
    orderReturnDal.listExchanges(input.orderId),
  ]);
  const exchange = exchanges.find(
    (candidate) => candidate.returnId === input.returnId,
  );
  if (!order?.email || !exchange) return false;
  const delivery = await sendOrderExchangeCreatedEmail({
    email: order.email,
    orderId: order.id,
    customerId: order.customerId,
    returnId: input.returnId,
    currencyCode: order.currencyCode,
    orderDisplayId: order.displayId,
    exchangeDisplayId: exchange.displayId,
    differenceDue: exchange.differenceDue,
    inboundItems: exchange.inboundItems.map((item) => ({
      title: item.title,
      sku: item.sku,
      quantity: item.quantity,
    })),
    outboundItems: exchange.items.map((item) => ({
      title: item.title,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    })),
    returnShipping: exchange.returnShipping,
    outboundShipping: exchange.outboundShipping,
  });
  return delivery.success;
}
