import { describe, expect, it } from "vitest";
import {
  categoryFormFields,
  emptyCategoryForm,
  toCategoryForm,
} from "./product-category-form";
import type { ProductCategoryDTO } from "@/lib/product/dto/product-taxonomy.dto";

const CATEGORY: ProductCategoryDTO = {
  id: "child-id",
  name: "Shirts",
  description: "Everything with sleeves",
  handle: "shirts",
  mpath: "/root-id/child-id",
  parentCategoryId: "root-id",
  isActive: true,
  isInternal: false,
  rank: 0,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

const fieldNames = (fields: { name: string }[]) =>
  fields.map((field) => field.name);

describe("category form fields", () => {
  it("maps the record's booleans onto the form's select values", () => {
    expect(toCategoryForm(CATEGORY)).toMatchObject({
      status: "active",
      visibility: "public",
      parentCategoryId: "root-id",
    });
  });

  it("offers the parent picker only when requested", () => {
    // Edit omits it: re-parenting would have to rewrite every descendant's
    // materialised path, so the field must not appear there.
    expect(fieldNames(categoryFormFields(emptyCategoryForm()))).not.toContain(
      "parentCategoryId",
    );
    expect(
      fieldNames(
        categoryFormFields(emptyCategoryForm(), { includeParent: true }),
      ),
    ).toContain("parentCategoryId");
  });

  it("carries a validation message onto the named field", () => {
    const fields = categoryFormFields(emptyCategoryForm(), {
      errors: { name: "Name is required" },
    });

    expect(fields.find((field) => field.name === "name")?.error).toBe(
      "Name is required",
    );
  });
});
