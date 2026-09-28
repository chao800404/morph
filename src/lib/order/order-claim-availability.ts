export const availableRefundClaimQuantity = (input: {
  deliveredQuantity: number;
  returnRequestedQuantity: number;
  returnReceivedQuantity: number;
  returnDismissedQuantity: number;
  activeNoReturnClaimQuantity: number;
}) =>
  Math.max(
    0,
    input.deliveredQuantity -
      input.returnRequestedQuantity -
      input.returnReceivedQuantity -
      input.returnDismissedQuantity -
      input.activeNoReturnClaimQuantity,
  );
