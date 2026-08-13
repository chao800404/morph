export interface CartAmountLine {
  quantity: number;
  unitPrice: number;
  isTaxInclusive?: boolean;
  adjustments: number[];
  taxes: Array<{ rate: number }>;
}

export const calculateAmountLine = (line: CartAmountLine) => {
  const subtotal = line.quantity * line.unitPrice;
  const discountTotal = Math.min(
    subtotal,
    line.adjustments.reduce((sum, amount) => sum + Math.max(0, amount), 0),
  );
  const taxable = Math.max(0, subtotal - discountTotal);
  const combinedRate = line.taxes.reduce((sum, tax) => sum + tax.rate, 0);
  const taxTotal = line.isTaxInclusive
    ? Math.round(taxable - taxable / (1 + combinedRate / 100))
    : Math.round(taxable * (combinedRate / 100));
  return {
    subtotal,
    discountTotal,
    taxTotal,
    total: taxable + (line.isTaxInclusive ? 0 : taxTotal),
  };
};

export const sumCartTotals = (input: {
  items: CartAmountLine[];
  shipping: CartAmountLine[];
  credits: number[];
}) => {
  const items = input.items.map(calculateAmountLine);
  const shipping = input.shipping.map(calculateAmountLine);
  const itemSubtotal = items.reduce((sum, line) => sum + line.subtotal, 0);
  const itemDiscountTotal = items.reduce(
    (sum, line) => sum + line.discountTotal,
    0,
  );
  const itemTaxTotal = items.reduce((sum, line) => sum + line.taxTotal, 0);
  const shippingSubtotal = shipping.reduce(
    (sum, line) => sum + line.subtotal,
    0,
  );
  const shippingDiscountTotal = shipping.reduce(
    (sum, line) => sum + line.discountTotal,
    0,
  );
  const shippingTaxTotal = shipping.reduce(
    (sum, line) => sum + line.taxTotal,
    0,
  );
  const creditTotal = input.credits.reduce(
    (sum, amount) => sum + Math.max(0, amount),
    0,
  );
  const subtotal = itemSubtotal + shippingSubtotal;
  const discountTotal = itemDiscountTotal + shippingDiscountTotal;
  const taxTotal = itemTaxTotal + shippingTaxTotal;
  const inclusiveTaxTotal = [
    ...items.map((line, index) =>
      input.items[index].isTaxInclusive ? line.taxTotal : 0,
    ),
    ...shipping.map((line, index) =>
      input.shipping[index].isTaxInclusive ? line.taxTotal : 0,
    ),
  ].reduce((sum, amount) => sum + amount, 0);
  return {
    itemSubtotal,
    itemDiscountTotal,
    itemTaxTotal,
    shippingSubtotal,
    shippingDiscountTotal,
    shippingTaxTotal,
    creditTotal,
    subtotal,
    discountTotal,
    taxTotal,
    total: Math.max(
      0,
      subtotal - discountTotal + taxTotal - inclusiveTaxTotal - creditTotal,
    ),
  };
};
