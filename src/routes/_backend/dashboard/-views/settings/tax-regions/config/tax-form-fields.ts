import type { FormField } from "@/lib/validations/form";

export const formatTaxProviderLabel = (providerId: string) =>
  providerId
    .replace(/^tp_/, "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const taxRegionFields = (
  countries: Array<{ label: string; value: string }>,
  providers: Array<{ label: string; value: string }>,
  values?: { countryCode?: string; providerId?: string | null },
): FormField[] => [
  {
    type: "select",
    name: "countryCode",
    label: "Country",
    placeholder: "Select a country",
    options: countries,
    value: values?.countryCode,
    required: true,
    disabled: Boolean(values?.countryCode),
    autoFocus: true,
  },
  {
    type: "select",
    name: "providerId",
    label: "Tax provider",
    placeholder: "Select a provider",
    options: providers,
    value: values?.providerId ?? "tp_system",
    required: true,
  },
  {
    type: "tip",
    name: "defaultRateHelp",
    description:
      "Optionally create the default tax rate with this region. You can also add it later from the region details.",
    colSpan: 2,
  },
  {
    type: "input",
    name: "defaultRateName",
    label: "Default tax rate name",
    placeholder: "Standard VAT",
    optional: true,
  },
  {
    type: "input",
    name: "defaultRateCode",
    label: "Default tax rate code",
    placeholder: "VAT",
    optional: true,
  },
  {
    type: "input",
    inputType: "number",
    step: "any",
    suffix: "%",
    name: "defaultRate",
    label: "Default tax rate",
    placeholder: "5",
    optional: true,
    colSpan: 2,
  },
];

export const taxRegionEditFields = (
  country: { label: string; value: string },
  providers: Array<{ label: string; value: string }>,
  providerId: string | null,
): FormField[] => [
  {
    type: "select",
    name: "countryCode",
    label: "Country",
    options: [country],
    value: country.value,
    disabled: true,
  },
  {
    type: "select",
    name: "providerId",
    label: "Tax provider",
    placeholder: "Select a provider",
    options: providers,
    value: providerId ?? "tp_system",
    required: true,
    autoFocus: true,
  },
];

export const taxProvinceFields = (parentId: string): FormField[] => [
  { type: "hidden", name: "parentId", value: parentId },
  {
    type: "input",
    name: "provinceCode",
    label: "Province / state code",
    description:
      "Enter the ISO 3166-2 subdivision code without the country prefix.",
    placeholder: "CA",
    required: true,
    autoFocus: true,
  },
  {
    type: "input",
    name: "defaultRateName",
    label: "Default tax rate name",
    placeholder: "Provincial tax",
    optional: true,
  },
  {
    type: "input",
    name: "defaultRateCode",
    label: "Default tax rate code",
    placeholder: "PST",
    optional: true,
  },
  {
    type: "input",
    inputType: "number",
    step: "any",
    suffix: "%",
    name: "defaultRate",
    label: "Default tax rate",
    placeholder: "8",
    optional: true,
  },
  {
    type: "switch",
    name: "defaultRateCombinable",
    label: "Combinable",
    description: "Combine this province rate with the country tax rate.",
  },
];
const taxRateBaseFields = (
  taxRegionId: string,
  values?: {
    id: string;
    name: string;
    code: string;
    rate: number | null;
    isDefault: boolean;
    isCombinable: boolean;
  },
): FormField[] => [
  { type: "hidden", name: "taxRegionId", value: taxRegionId },
  ...(values
    ? [{ type: "hidden" as const, name: "rateId", value: values.id }]
    : []),
  {
    type: "input",
    name: "name",
    label: "Name",
    value: values?.name,
    placeholder: "Standard VAT",
    required: true,
    autoFocus: true,
  },
  {
    type: "input",
    name: "code",
    label: "Code",
    value: values?.code,
    placeholder: "VAT",
    required: true,
  },
  {
    type: "input",
    inputType: "number",
    step: "any",
    suffix: "%",
    name: "rate",
    label: "Tax rate",
    value: values?.rate?.toString(),
    placeholder: "20",
    required: true,
  },
  {
    type: "switch",
    name: "isDefault",
    label: "Default tax rate",
    description: "Used when no more specific tax rate applies.",
    value: values?.isDefault ?? false,
  },
  {
    type: "switch",
    name: "isCombinable",
    label: "Combinable",
    description: "Allow a province rate to stack with its country rate.",
    value: values?.isCombinable ?? false,
  },
];

export const taxDefaultRateFields = (
  taxRegionId: string,
  values?: Parameters<typeof taxRateBaseFields>[1],
): FormField[] =>
  taxRateBaseFields(taxRegionId, values).map((field) =>
    field.name === "isDefault"
      ? { ...field, type: "hidden", value: "true" }
      : field,
  );

export const taxOverrideFields = (
  taxRegionId: string,
  values?: Parameters<typeof taxRateBaseFields>[1] & {
    rules: Array<{ reference: string; referenceId: string; label: string }>;
  },
): FormField[] => [
  ...taxRateBaseFields(taxRegionId, values)
    .filter((field) => field.name !== "isDefault")
    .map((field) =>
      field.name === "isCombinable"
        ? {
            ...field,
            description:
              "Combine this province override with the matching country rate.",
          }
        : field,
    ),
  { type: "hidden", name: "isDefault", value: "false" },
  {
    type: "tip",
    name: "targetHelp",
    description:
      "Select at least one product, product type, or shipping option. Product rules take priority over product type rules, followed by the region default.",
    colSpan: 2,
  },
  {
    type: "option-values",
    name: "products",
    label: "Products",
    optional: true,
    remoteSource: "tax-products",
    choices:
      values?.rules
        .filter((rule) => rule.reference === "product")
        .map((rule) => ({ id: rule.referenceId, value: rule.label })) ?? [],
    value:
      values?.rules
        .filter((rule) => rule.reference === "product")
        .map((rule) => rule.referenceId) ?? [],
    searchPlaceholder: "Search products...",
    emptyMessage: "No products found",
  },
  {
    type: "option-values",
    name: "productTypes",
    label: "Product types",
    optional: true,
    remoteSource: "tax-product-types",
    choices:
      values?.rules
        .filter((rule) => rule.reference === "product_type")
        .map((rule) => ({ id: rule.referenceId, value: rule.label })) ?? [],
    value:
      values?.rules
        .filter((rule) => rule.reference === "product_type")
        .map((rule) => rule.referenceId) ?? [],
    searchPlaceholder: "Search product types...",
    emptyMessage: "No product types found",
  },
  {
    type: "option-values",
    name: "shippingOptions",
    label: "Shipping options",
    optional: true,
    remoteSource: "tax-shipping-options",
    choices:
      values?.rules
        .filter((rule) => rule.reference === "shipping_option")
        .map((rule) => ({ id: rule.referenceId, value: rule.label })) ?? [],
    value:
      values?.rules
        .filter((rule) => rule.reference === "shipping_option")
        .map((rule) => rule.referenceId) ?? [],
    searchPlaceholder: "Search shipping options...",
    emptyMessage: "No shipping options found",
    colSpan: 2,
  },
];
