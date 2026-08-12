import type { FormField } from "@/lib/validations/form";

type OptionFormValues = {
  title: string;
  values: string[];
};

export const optionFormFields = (values?: OptionFormValues): FormField[] => [
  {
    type: "input",
    name: "title",
    label: "Title",
    value: values?.title,
    placeholder: "e.g. Size, Colour, Material",
    required: true,
    autoFocus: true,
  },
  {
    type: "option-values",
    name: "values",
    label: "Values",
    value: values?.values,
    placeholder: "Type a value and press Enter...",
  },
];
