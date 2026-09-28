import type { FormField } from "@/lib/validations/form";

export const locationFulfillmentProviderFormFields = (values: {
  fulfillmentProviderIds: string[];
  providers: Array<{ id: string; name: string; isAssigned: boolean }>;
}): FormField[] => [
  {
    type: "option-values",
    name: "fulfillmentProviderIds",
    label: "Fulfillment providers",
    description:
      "Shipping options can use only providers assigned to this stock location.",
    value: values.fulfillmentProviderIds,
    choices: values.providers.map((provider) => ({
      id: provider.id,
      value: provider.name,
    })),
    maxSelected: 80,
    searchPlaceholder: "Search fulfillment providers...",
    emptyMessage: "No fulfillment providers are installed",
  },
];
