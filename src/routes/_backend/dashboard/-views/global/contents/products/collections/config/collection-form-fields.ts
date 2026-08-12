import { handleField } from "@/components/form/handle-field";
import type { FormField } from "@/lib/validations/form";

type CollectionFormValues = {
  title: string;
  handle: string;
  description?: string | null;
};

export const collectionFormFields = (
  values?: CollectionFormValues,
): FormField[] => [
  {
    type: "input",
    name: "title",
    label: "Title",
    value: values?.title,
    placeholder: "e.g. Summer Release",
    required: true,
    autoFocus: true,
  },
  handleField({ derivedFrom: "title", value: values?.handle }),
  {
    type: "textarea",
    name: "description",
    label: "Description",
    value: values?.description ?? undefined,
    placeholder: "Short collection description...",
    rows: 3,
  },
];
