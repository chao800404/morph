import type { CartDTO } from "./dto/cart.dto";

/**
 * Compare the customer-visible money state while ignoring cart timestamps and
 * presentation fields. Checkout uses this to require a fresh confirmation if
 * current price-list, promotion, or tax rules changed the cart.
 */
export const hasCartPricingChanged = (before: CartDTO, after: CartDTO) => {
  const state = (cart: CartDTO) => ({
    currencyCode: cart.currencyCode,
    items: cart.items
      .map((item) => ({
        id: item.id,
        variantId: item.variantId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: item.subtotal,
        discountTotal: item.discountTotal,
        taxTotal: item.taxTotal,
        total: item.total,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    shippingMethods: cart.shippingMethods
      .map((method) => ({
        id: method.id,
        shippingOptionId: method.shippingOptionId,
        amount: method.amount,
        discountTotal: method.discountTotal,
        taxTotal: method.taxTotal,
        total: method.total,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    promotions: cart.promotions.map((promotion) => promotion.id).sort(),
    totals: {
      itemSubtotal: cart.itemSubtotal,
      itemDiscountTotal: cart.itemDiscountTotal,
      itemTaxTotal: cart.itemTaxTotal,
      shippingSubtotal: cart.shippingSubtotal,
      shippingDiscountTotal: cart.shippingDiscountTotal,
      shippingTaxTotal: cart.shippingTaxTotal,
      creditTotal: cart.creditTotal,
      subtotal: cart.subtotal,
      discountTotal: cart.discountTotal,
      taxTotal: cart.taxTotal,
      totalBeforeCredits: cart.totalBeforeCredits,
      total: cart.total,
    },
  });

  return JSON.stringify(state(before)) !== JSON.stringify(state(after));
};
