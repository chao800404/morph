import type { StoreCurrencyDTO } from "@/lib/currency/dto/currency.dto";
import type {
  FormField,
  GeoZoneFormValue,
  OptionValueChoice,
} from "@/lib/validations/form";

export const locationShippingOptionFormFields = (values: {
  currencies: StoreCurrencyDTO[];
  countries: OptionValueChoice[];
  profiles: OptionValueChoice[];
  optionTypes: OptionValueChoice[];
  providers?: OptionValueChoice[];
  shippingRateProviders?: OptionValueChoice[];
  priceType?: "flat" | "calculated";
  showPriceTypeSelector?: boolean;
  showProviderSelector?: boolean;
  serviceZoneId?: string;
  current?: {
    zoneName?: string;
    geoZones?: GeoZoneFormValue[];
    optionName?: string;
    shippingProfileId?: string;
    shippingOptionTypeId?: string | null;
    providerId?: string | null;
    priceType?: "flat" | "calculated";
    providerData?: unknown;
    rules?: string;
    rates?: Record<string, string>;
  };
}): FormField[] => [
  ...(values.serviceZoneId
    ? [
        {
          type: "hidden" as const,
          name: "serviceZoneId",
          value: values.serviceZoneId,
        },
      ]
    : [
        {
          type: "input" as const,
          name: "zoneName",
          label: "Service zone name",
          description: "A descriptive name for this destination group.",
          value: values.current?.zoneName,
          required: true,
          autoFocus: true,
        },
        {
          type: "geo-zones" as const,
          name: "geoZones",
          label: "Geographic areas",
          description:
            "Add countries, provinces, cities, or postal code patterns that can use this shipping option.",
          value: JSON.stringify(
            values.current?.geoZones ?? [{ type: "country", countryCode: "" }],
          ),
          countries: values.countries,
          maxZones: 250,
          required: true,
        },
      ]),
  {
    type: "input",
    name: "optionName",
    label: "Shipping option name",
    description: "Shown to customers at checkout.",
    value: values.current?.optionName,
    required: true,
  },
  ...(values.showPriceTypeSelector
    ? [
        {
          type: "select" as const,
          name: "priceType",
          label: "Price type",
          description:
            "Fixed prices use the store currency table. Calculated prices ask the selected provider during checkout.",
          value: values.priceType ?? values.current?.priceType ?? "flat",
          options: [
            { label: "Fixed", value: "flat" },
            { label: "Calculated", value: "calculated" },
          ],
          required: true,
        },
      ]
    : [
        {
          type: "hidden" as const,
          name: "priceType",
          value: values.current?.priceType ?? "flat",
        },
      ]),
  {
    type: "select",
    name: "shippingProfileId",
    label: "Shipping profile",
    description: "Products in this profile can use this shipping option.",
    value: values.current?.shippingProfileId,
    options: values.profiles.map((profile) => ({
      label: profile.value,
      value: profile.id,
    })),
    required: true,
  },
  {
    type: "select",
    name: "shippingOptionTypeId",
    label: "Shipping option type",
    description: "Group this option with similar checkout shipping methods.",
    value: values.current?.shippingOptionTypeId ?? "none",
    options: [
      { label: "No type", value: "none" },
      ...values.optionTypes.map((type) => ({
        label: type.value,
        value: type.id,
      })),
    ],
    optional: true,
  },
  ...(values.showProviderSelector
    ? [
        {
          type: "select" as const,
          name: "providerId",
          renderKey: `providerId-${values.priceType ?? values.current?.priceType ?? "flat"}`,
          label: "Fulfillment provider",
          description:
            (values.priceType ?? values.current?.priceType) === "calculated"
              ? "Choose a provider that handles fulfillment and can calculate checkout rates."
              : "The installed provider that will process fulfillments created with this shipping option.",
          value: values.current?.providerId ?? "manual_manual",
          options:
            ((values.priceType ?? values.current?.priceType) === "calculated"
              ? values.providers?.filter((provider) =>
                  values.shippingRateProviders?.some(
                    (rateProvider) => rateProvider.id === provider.id,
                  ),
                )
              : values.providers)?.map((provider) => ({
              label: provider.value,
              value: provider.id,
            })) ?? [],
          required: true,
        },
      ]
    : []),
  ...((values.priceType ?? values.current?.priceType) === "calculated"
    ? [
        {
          type: "textarea" as const,
          name: "providerData",
          label: "Provider data",
          description:
            "Provider-specific JSON settings. The manual rate provider expects an integer `amount` in currency minor units. Keep credentials in server-only provider configuration.",
          value:
            typeof values.current?.providerData === "string"
              ? values.current.providerData
              : values.current?.providerData
                ? JSON.stringify(values.current.providerData, null, 2)
                : "{}",
          rows: 5,
        },
      ]
    : []),
  {
    type: "shipping-rules",
    name: "rules",
    label: "Availability rules",
    description:
      "All rules must match for shoppers to see this option. Cart amount rules use minor currency units (for example, USD 10.00 is 1000).",
    value: values.current?.rules ?? "[]",
    maxRules: 20,
  },
  ...((values.priceType ?? values.current?.priceType) === "calculated"
    ? []
    : values.currencies.map(
        (currency): FormField => ({
          type: "input",
          name: `rate_${currency.code.toLowerCase()}`,
          label: `${currency.code.toUpperCase()} shipping rate`,
          description: `${currency.name}; enter a customer-facing amount.`,
          inputType: "number",
          value: values.current?.rates?.[currency.code.toLowerCase()],
          step: currency.decimalDigits ? 1 / 10 ** currency.decimalDigits : 1,
          required: true,
        }),
      )),
];
