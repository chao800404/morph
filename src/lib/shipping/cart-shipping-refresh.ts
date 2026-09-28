export interface SelectedCartShippingMethod {
  id: string;
  shippingOptionId: string | null;
  name: string;
  amount: number;
  updatedAt: string;
}

export interface AvailableCartShippingOption {
  id: string;
  name: string;
  amount: number;
}

export type CartShippingRefreshPlan =
  | {
      methodId: string;
      expectedUpdatedAt: string;
      expectedOptionId: string;
      expectedAmount: number;
      kind: "remove";
    }
  | {
      methodId: string;
      expectedUpdatedAt: string;
      expectedOptionId: string;
      expectedAmount: number;
      kind: "update";
      name: string;
      amount: number;
    };

/**
 * Keep selected cart shipping methods aligned with the latest rates and rules.
 * Methods without an option reference are preserved for their owning workflow.
 */
export const planCartShippingRefresh = (
  selectedMethods: SelectedCartShippingMethod[],
  availableOptions: AvailableCartShippingOption[],
): CartShippingRefreshPlan[] => {
  const optionsById = new Map(
    availableOptions.map((option) => [option.id, option]),
  );

  return selectedMethods.flatMap<CartShippingRefreshPlan>((method) => {
    if (!method.shippingOptionId) return [];

    const option = optionsById.get(method.shippingOptionId);
    if (!option)
      return [
        {
          methodId: method.id,
          expectedUpdatedAt: method.updatedAt,
          expectedOptionId: method.shippingOptionId,
          expectedAmount: method.amount,
          kind: "remove" as const,
        },
      ];

    if (option.amount === method.amount && option.name === method.name)
      return [];

    return [
      {
        methodId: method.id,
        expectedUpdatedAt: method.updatedAt,
        expectedOptionId: method.shippingOptionId,
        expectedAmount: method.amount,
        kind: "update" as const,
        name: option.name,
        amount: option.amount,
      },
    ];
  });
};
