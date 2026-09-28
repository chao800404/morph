import type { PriceListDTO } from "@/lib/pricing/dto/price-list.dto";
import type { FormField, OptionValueChoice } from "@/lib/validations/form";

export interface PriceListFormValues {
  title: string;
  description: string;
  type: "sale" | "override";
  status: "draft" | "active";
  startsAt: string | null;
  endsAt: string | null;
  customerGroupIds: string[];
  regionIds: string[];
}

export const priceListFormValues = (priceList?: PriceListDTO): PriceListFormValues => ({
  title: priceList?.title ?? "",
  description: priceList?.description ?? "",
  type: priceList?.type ?? "sale",
  status: priceList?.status ?? "draft",
  startsAt: priceList?.startsAt ?? null,
  endsAt: priceList?.endsAt ?? null,
  customerGroupIds: priceList?.customerGroupIds ?? [],
  regionIds: priceList?.regionIds ?? [],
});

const toLocalInputValue = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};

export const priceListFormFields = (
  groups: OptionValueChoice[],
  regions: OptionValueChoice[],
  values: PriceListFormValues = priceListFormValues(),
): FormField[] => [
  {
    type: "input",
    name: "title",
    label: "Name",
    value: values.title,
    placeholder: "Summer sale",
    required: true,
    autoFocus: true,
  },
  {
    type: "textarea",
    name: "description",
    label: "Description",
    value: values.description,
    optional: true,
  },
  {
    type: "choice-cards",
    name: "type",
    label: "Price list type",
    value: values.type,
    options: [
      { value: "sale", label: "Sale", description: "Show the original price beside the reduced price." },
      { value: "override", label: "Override", description: "Replace the ordinary price, often for contract pricing." },
    ],
  },
  {
    type: "select",
    name: "status",
    label: "Status",
    value: values.status,
    options: [
      { value: "draft", label: "Draft" },
      { value: "active", label: "Active" },
    ],
  },
  {
    type: "input",
    name: "startsAt",
    label: "Starts at",
    inputType: "datetime-local",
    value: toLocalInputValue(values.startsAt),
    optional: true,
  },
  {
    type: "input",
    name: "endsAt",
    label: "Ends at",
    inputType: "datetime-local",
    value: toLocalInputValue(values.endsAt),
    optional: true,
  },
  {
    type: "option-values",
    name: "customerGroupIds",
    label: "Customer groups",
    description: "Leave empty to apply this list to all customers. Group prices require the customer's verified account to be attached to the cart.",
    value: values.customerGroupIds,
    choices: groups,
    maxSelected: 100,
    searchPlaceholder: "Search customer groups",
    emptyMessage: "No customer groups found",
  },
  {
    type: "option-values",
    name: "regionIds",
    label: "Regions",
    description: "Leave empty to apply this list in every region. When selected, a customer's cart must use one of these regions.",
    value: values.regionIds,
    choices: regions,
    maxSelected: 100,
    searchPlaceholder: "Search regions",
    emptyMessage: "No regions found",
  },
];

export const parseFormGroupIds = (value: FormDataEntryValue | null): string[] => {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
};

export const parseFormRegionIds = (value: FormDataEntryValue | null): string[] => {
  return parseFormGroupIds(value);
};

export const parseFormDate = (value: FormDataEntryValue | null): string => {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
};
