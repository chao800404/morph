import type { FormField } from "@/lib/validations/form";

type SelectOption = { label: string; value: string };
type OptionValue = { id: string; value: string };

type RegionFormValues = {
  name: string;
  currencyCode: string;
  countries: Array<{ iso2: string }>;
  automaticTaxes: boolean;
  isTaxInclusive: boolean;
  paymentProviderIds: string[];
};

export const regionFormFields = ({
  currencies,
  countries,
  providers,
  values,
}: {
  currencies: SelectOption[];
  countries: OptionValue[];
  providers: OptionValue[];
  values?: RegionFormValues;
}): FormField[] => [
  { type: "input", name: "name", label: "Name", value: values?.name, required: true, autoFocus: true },
  {
    type: "select",
    name: "currencyCode",
    label: "Currency",
    value: values?.currencyCode,
    placeholder: "Select a supported currency",
    options: currencies,
    required: true,
  },
  {
    type: "option-values",
    name: "countries",
    label: "Countries",
    value: values?.countries.map((country) => country.iso2),
    choices: countries,
    maxSelected: 250,
    searchPlaceholder: "Search countries",
  },
  {
    type: "switch",
    name: "automaticTaxes",
    label: "Calculate taxes automatically",
    description: "Apply the region's tax rates automatically at checkout.",
    value: values?.automaticTaxes ?? true,
  },
  {
    type: "switch",
    name: "isTaxInclusive",
    label: "Tax-inclusive pricing",
    description: "Prices displayed in this region already include tax.",
    value: values?.isTaxInclusive ?? false,
  },
  {
    type: "option-values",
    name: "paymentProviderIds",
    label: "Payment providers",
    description: "Customers in this region can pay using these providers.",
    value: values?.paymentProviderIds,
    choices: providers,
    maxSelected: 50,
    searchPlaceholder: "Search payment providers",
    emptyMessage: "No enabled payment providers found",
    required: true,
  },
];
