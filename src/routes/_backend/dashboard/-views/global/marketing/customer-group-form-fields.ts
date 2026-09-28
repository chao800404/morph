import type { FormField } from "@/lib/validations/form";

export const customerGroupFormFields = (name?: string): FormField[] => [
  {
    type: "input",
    name: "name",
    label: "Name",
    value: name ?? "",
    placeholder: "Wholesale",
    required: true,
    autoFocus: true,
  },
];
