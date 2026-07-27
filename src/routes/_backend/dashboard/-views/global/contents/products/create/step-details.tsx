import { createSurface } from "@/components/dialog/create-surface";
import { FieldsRenderer } from "@/components/form/fields-renderer";
import { cn } from "@/lib/utils";
import type { FormField, FormFieldValue } from "@/lib/validations/form";
import type { Dispatch } from "react";
import { OptionPicker } from "./option-picker";
import type { DraftAction, ProductDraft } from "./use-product-draft";
import { VariantMatrix } from "./variant-matrix";

const detailFieldNames = [
  "title",
  "subtitle",
  "handle",
  "description",
] as const;

type DetailFieldName = (typeof detailFieldNames)[number];

const isDetailFieldName = (name: string): name is DetailFieldName =>
  detailFieldNames.some((fieldName) => fieldName === name);

export const StepDetails = ({
  draft,
  dispatch,
  issues = {},
}: {
  draft: ProductDraft;
  dispatch: Dispatch<DraftAction>;
  /** Empty until the author tries to leave the step. */
  issues?: { title?: string; options?: string };
}) => {
  const generalFields: FormField[] = [
    {
      type: "input",
      name: "title",
      label: "Title",
      placeholder: "e.g. Summer T-Shirt",
      value: draft.title,
      autoFocus: true,
      required: true,
      error: issues.title,
      colSpan: 1,
    },
    {
      type: "input",
      name: "subtitle",
      label: "Subtitle",
      optional: true,
      value: draft.subtitle,
      colSpan: 1,
    },
    {
      type: "input",
      name: "handle",
      label: "Handle",
      placeholder: "Derived from the title",
      optional: true,
      value: draft.handle,
      colSpan: 1,
    },
    {
      type: "textarea",
      name: "description",
      label: "Description",
      optional: true,
      value: draft.description,
      rows: 4,
      colSpan: 1,
      className: "sm:col-span-3",
    },
  ];

  const variantFields: FormField[] = [
    {
      type: "switch",
      name: "hasVariants",
      label: "Yes, this is a product with variants",
      description: "When off, a single default variant is created for you.",
      value: draft.hasVariants,
      colSpan: 1,
    },
  ];

  const handleGeneralChange = (
    name: string,
    value: FormFieldValue | File[],
  ) => {
    if (!isDetailFieldName(name) || typeof value !== "string") return;
    dispatch({ type: "setField", field: name, value });
  };

  const handleVariantChange = (
    name: string,
    value: FormFieldValue | File[],
  ) => {
    if (name !== "hasVariants" || typeof value !== "boolean") return;
    dispatch({ type: "setHasVariants", value });
  };

  return (
    <div className={cn(createSurface.content, "flex w-full flex-col gap-10")}>
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium text-foreground">General</h2>

        <FieldsRenderer
          fields={generalFields}
          className="grid-cols-1 sm:grid-cols-3"
          onChange={handleGeneralChange}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium text-foreground">Variants</h2>

        <FieldsRenderer
          fields={variantFields}
          className="grid-cols-1"
          onChange={handleVariantChange}
        />

        {draft.hasVariants && (
          <div className="flex flex-col gap-6">
            <OptionPicker options={draft.options} dispatch={dispatch} />
            {issues.options ? (
              <p role="alert" className="text-xs text-destructive">
                {issues.options}
              </p>
            ) : null}
            {draft.variants.length > 0 && (
              <VariantMatrix
                options={draft.options}
                variants={draft.variants}
                dispatch={dispatch}
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
};
