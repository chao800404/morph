import type { FormField } from "@/lib/validations/form";

export const locationSalesChannelFormFields = (values: {
  salesChannelIds: string[];
  channels: Array<{ id: string; name: string; isDisabled: boolean }>;
}): FormField[] => [
  {
    type: "option-values",
    name: "salesChannelIds",
    label: "Sales channels",
    description:
      "Only linked sales channels can fulfill orders from this location.",
    value: values.salesChannelIds,
    choices: values.channels.map((channel) => ({
      id: channel.id,
      value: channel.isDisabled ? `${channel.name} (disabled)` : channel.name,
    })),
    maxSelected: 100,
    searchPlaceholder: "Search sales channels...",
    emptyMessage: "No sales channels found",
  },
];
