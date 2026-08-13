export const SALES_CHANNEL_TYPES = [
  "storefront",
  "mobile",
  "pos",
  "marketplace",
  "social",
  "agentic",
  "custom",
] as const;

export type SalesChannelType = (typeof SALES_CHANNEL_TYPES)[number];

export const SALES_CHANNEL_TYPE_OPTIONS: Array<{
  value: SalesChannelType;
  label: string;
}> = [
  { value: "storefront", label: "Online Store" },
  { value: "mobile", label: "Mobile App" },
  { value: "pos", label: "Point of Sale" },
  { value: "marketplace", label: "Marketplace" },
  { value: "social", label: "Social Commerce" },
  { value: "agentic", label: "Agentic Storefront" },
  { value: "custom", label: "Custom" },
];

export const salesChannelTypeLabel = (type: SalesChannelType) =>
  SALES_CHANNEL_TYPE_OPTIONS.find((option) => option.value === type)?.label ??
  type;
