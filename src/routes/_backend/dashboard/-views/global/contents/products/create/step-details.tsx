import { createSurface } from "@/components/dialog/create-surface";
import {
  parseSelectedAssets,
  serializeSelectedAssets,
} from "@/components/form/asset-select-field";
import { FieldsRenderer } from "@/components/form/fields-renderer";
import { cn } from "@/lib/utils";
import type { FormField, FormFieldValue } from "@/lib/validations/form";
import type { Dispatch } from "react";
import { OptionPicker } from "./option-picker";
import type { DraftAction, ProductDraft } from "./use-product-draft";
import { VariantMatrix } from "./variant-matrix";
import { productGeneralFields } from "../config/product-form-fields";

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
  const generalFields = productGeneralFields({
    title: draft.title,
    subtitle: draft.subtitle,
    handle: draft.handle,
    description: draft.description,
    titleError: issues.title,
    mode: "create",
  });

  const mediaFields: FormField[] = [
    {
      type: "asset-select",
      name: "assets",
      label: "Media",
      optional: true,
      labelHint:
        "Images are stored in the asset library, so the same image can be reused across products.",
      value: serializeSelectedAssets(draft.assets),
      colSpan: 1,
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

  const handleMediaChange = (name: string, value: FormFieldValue | File[]) => {
    if (name !== "assets" || typeof value !== "string") return;
    dispatch({ type: "setAssets", assets: parseSelectedAssets(value) });
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

      {/* No section heading: the field's own label already says "Media", and it
          is the only field here. General and Variants keep theirs because they
          hold several fields that need a name above them. */}
      <section className="flex flex-col gap-4">
        <FieldsRenderer
          fields={mediaFields}
          className="grid-cols-1"
          onChange={handleMediaChange}
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
