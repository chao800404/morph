import type { FormField } from "@/lib/validations/form";

type LocationFormValues = {
  name: string;
  address?: {
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
    countryCode?: string | null;
  } | null;
};

export const locationFormFields = (values?: LocationFormValues): FormField[] => {
  const address = values?.address;
  return [
    { type: "input", name: "name", label: "Name", value: values?.name, required: true, autoFocus: true, colSpan: 2 },
    { type: "input", name: "address1", label: "Street address", value: address?.address1 ?? undefined, required: values === undefined, colSpan: 2 },
    { type: "input", name: "address2", label: "Address line 2", value: address?.address2 ?? undefined, colSpan: 2 },
    { type: "input", name: "city", label: "City", value: address?.city ?? undefined },
    { type: "input", name: "province", label: "Province / State", value: address?.province ?? undefined },
    { type: "input", name: "postalCode", label: "Postal code", value: address?.postalCode ?? undefined },
    { type: "input", name: "countryCode", label: "Country code", value: address?.countryCode ?? undefined, placeholder: "US", required: values === undefined },
  ];
};
