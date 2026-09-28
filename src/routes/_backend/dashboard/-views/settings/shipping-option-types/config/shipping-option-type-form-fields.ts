import type { ShippingOptionTypeDTO } from "@/lib/shipping/dto/shipping-option-type.dto";
import type { FormField } from "@/lib/validations/form";

export const shippingOptionTypeFormFields = (
  values?: ShippingOptionTypeDTO,
): FormField[] => [
  {
    type: "input",
    name: "label",
    label: "Label",
    description: "The shopper-facing category, such as Standard or Express.",
    value: values?.label,
    required: true,
    autoFocus: true,
  },
  {
    type: "input",
    name: "code",
    label: "Code",
    description: "A stable lowercase identifier used by the commerce API.",
    value: values?.code,
    required: true,
    placeholder: "e.g. express",
  },
  {
    type: "textarea",
    name: "description",
    label: "Description",
    description: "Optional internal note about when this type is used.",
    value: values?.description ?? "",
    optional: true,
    rows: 3,
  },
  ...(values
    ? [
        {
          type: "hidden" as const,
          name: "expectedUpdatedAt",
          value: values.updatedAt,
        },
      ]
    : []),
];
