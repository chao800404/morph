import { handleField } from "@/components/form/handle-field";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import type { FormField } from "@/lib/validations/form";

export const pageFormFields = (values?: {
  id?: string;
  title?: string;
  handle?: string;
  publish?: boolean;
  document?: StorefrontPageDocument;
}): FormField[] => [
  ...(values?.id
    ? [{ type: "hidden" as const, name: "id", value: values.id }]
    : []),
  {
    type: "input",
    name: "title",
    label: "Title",
    placeholder: "e.g. About us",
    value: values?.title,
    required: true,
    autoFocus: true,
  },
  handleField({ derivedFrom: "title", value: values?.handle }),
  {
    type: "switch",
    name: "publish",
    label: "Publish page",
    description: "Published pages are available to the storefront renderer.",
    value: values?.publish ?? false,
  },
  ...(values?.document
    ? [
        {
          type: "hidden" as const,
          name: "document",
          value: JSON.stringify(values.document),
        },
      ]
    : []),
];
