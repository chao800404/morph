import { calculateAmountLine } from "@/lib/cart/cart-totals";

export interface OrderClaimRefundLine {
  quantity: number;
  unitPrice: number;
  isTaxInclusive: boolean;
  adjustments: number[];
  taxes: Array<{ rate: number }>;
}

/** Return the historical, post-discount item amount for a claim. */
export const calculateOrderClaimRefundAmount = (
  lines: OrderClaimRefundLine[],
) =>
  lines.reduce(
    (sum, line) =>
      sum +
      calculateAmountLine({
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        isTaxInclusive: line.isTaxInclusive,
        adjustments: line.adjustments,
        taxes: line.taxes,
      }).total,
    0,
  );
