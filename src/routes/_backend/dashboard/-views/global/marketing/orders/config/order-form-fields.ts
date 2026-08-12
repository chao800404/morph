import type { FormField } from "@/lib/validations/form";

const notificationField: FormField = {
  type: "switch",
  name: "noNotification",
  label: "Disable notifications",
  description: "Do not send customer emails for this order.",
  defaultValue: false,
  colSpan: 1,
};

const customerEmailField = (value?: string | null): FormField => ({
  type: "input",
  name: "email",
  label: "Customer email",
  inputType: "email",
  defaultValue: value ?? undefined,
  placeholder: value === undefined ? "customer@example.com" : undefined,
  optional: true,
  colSpan: 1,
  autoFocus: true,
});

export const orderFormFields = ({
  mode,
  values,
}: {
  mode: "create" | "edit";
  values?: { email?: string | null; status: string };
}): FormField[] => {
  const sharedFields: FormField[] = [
    customerEmailField(values?.email),
    {
      type: "select",
      name: "status",
      label: "Status",
      defaultValue: values?.status ?? "draft",
      required: true,
      colSpan: 1,
      options:
        mode === "create"
          ? [
              { label: "Draft", value: "draft" },
              { label: "Pending", value: "pending" },
            ]
          : [
              { label: "Draft", value: "draft" },
              { label: "Pending", value: "pending" },
              { label: "Requires action", value: "requires_action" },
              { label: "Completed", value: "completed" },
              { label: "Canceled", value: "canceled" },
              { label: "Archived", value: "archived" },
            ],
    },
    notificationField,
  ];

  if (mode === "edit") return sharedFields;

  return [
    sharedFields[0],
  {
    type: "input",
    name: "currencyCode",
    label: "Currency",
    defaultValue: "usd",
    placeholder: "USD",
    required: true,
    colSpan: 1,
  },
    sharedFields[1],
    sharedFields[2],
  { type: "input", name: "itemTitle", label: "Item title", placeholder: "Custom item", optional: true, colSpan: 1 },
  { type: "input", name: "itemSku", label: "SKU", placeholder: "SKU-001", optional: true, colSpan: 1 },
  { type: "input", name: "quantity", label: "Quantity", inputType: "number", defaultValue: "1", required: true, colSpan: 1 },
  { type: "input", name: "unitPrice", label: "Unit price", inputType: "number", step: "0.01", defaultValue: "0", required: true, colSpan: 1 },
  ];
};
