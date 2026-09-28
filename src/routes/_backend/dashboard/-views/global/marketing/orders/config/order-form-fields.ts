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
  values?: { email?: string | null };
}): FormField[] => {
  const email = customerEmailField(values?.email);
  if (mode === "edit") return [email, notificationField];

  return [
    email,
    {
      type: "input",
      name: "currencyCode",
      label: "Currency",
      defaultValue: "usd",
      placeholder: "USD",
      required: true,
      colSpan: 1,
    },
    notificationField,
    {
      type: "input",
      name: "itemTitle",
      label: "Item title",
      placeholder: "Custom item",
      optional: true,
      colSpan: 1,
    },
    {
      type: "input",
      name: "itemSku",
      label: "SKU",
      placeholder: "SKU-001",
      optional: true,
      colSpan: 1,
    },
    {
      type: "input",
      name: "quantity",
      label: "Quantity",
      inputType: "number",
      defaultValue: "1",
      required: true,
      colSpan: 1,
    },
    {
      type: "input",
      name: "unitPrice",
      label: "Unit price",
      inputType: "number",
      step: "0.01",
      defaultValue: "0",
      required: true,
      colSpan: 1,
    },
  ];
};
