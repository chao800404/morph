/**
 * A cart can outlive a shipping option's latest address, profile, or rule
 * configuration. Checkout must only complete when every selected method is
 * still present at the exact amount returned by the current availability
 * calculation.
 */
export const selectedShippingMethodsAreAvailable = (
  selectedMethods: Array<{ shippingOptionId: string | null; amount: number }>,
  availableOptions: Array<{ id: string; amount: number }>,
): boolean => {
  const availableById = new Map(
    availableOptions.map((option) => [option.id, option]),
  );
  return selectedMethods.every((method) => {
    if (method.shippingOptionId === null) return false;
    const option = availableById.get(method.shippingOptionId);
    return option !== undefined && option.amount === method.amount;
  });
};
