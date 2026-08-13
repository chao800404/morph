import type { FormField } from "@/lib/validations/form";

export const domainFormFields = (): FormField[] => [
  {
    type: "input",
    name: "hostname",
    label: "Domain",
    placeholder: "shop.example.com",
    description: "Enter the hostname only, without https:// or a path.",
    required: true,
    autoFocus: true,
  },
];
