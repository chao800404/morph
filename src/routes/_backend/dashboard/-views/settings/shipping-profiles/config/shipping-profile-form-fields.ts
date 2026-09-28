import type { FormField } from "@/lib/validations/form";
import type { ShippingProfileType } from "@/lib/shipping/dto/shipping-profile.dto";

export const shippingProfileFormFields = (values?: {
  name: string;
  type: ShippingProfileType;
}): FormField[] => [
  {
    type: "input",
    name: "name",
    label: "Name",
    value: values?.name,
    required: true,
    autoFocus: true,
  },
  {
    type: "select",
    name: "type",
    label: "Type",
    value: values?.type ?? "custom",
    options: [
      ...(values?.type === "default"
        ? [{ value: "default", label: "Default" }]
        : []),
      { value: "custom", label: "Custom" },
      { value: "gift_card", label: "Gift card" },
    ],
    required: true,
    disabled: values?.type === "default",
  },
];
