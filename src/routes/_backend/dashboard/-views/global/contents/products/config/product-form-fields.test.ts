import { describe, expect, it } from "vitest";
import {
  productGeneralFields,
  productOrganizationFields,
} from "./product-form-fields";

describe("product form field factories", () => {
  it("keeps create and edit general fields on the same semantic contract", () => {
    const values = {
      title: "Shirt",
      subtitle: "Summer",
      handle: "shirt",
      description: "Lightweight",
    };
    const create = productGeneralFields({ ...values, mode: "create" });
    const edit = productGeneralFields({ ...values, mode: "edit" });

    expect(create.map((field) => field.name)).toEqual(
      edit.map((field) => field.name),
    );
  });

  it("keeps the shared organization fields in one factory", () => {
    const fields = productOrganizationFields({
      collectionId: null,
      collections: [],
      typeValue: null,
      types: [],
      tagValues: [],
      tags: [],
      categoryIds: [],
      categories: [],
      salesChannelIds: [],
      salesChannels: [],
    });

    expect(fields.map((field) => field.name)).toEqual([
      "collectionId",
      "typeValue",
      "tagValues",
      "categoryIds",
      "salesChannelIds",
    ]);
    expect(fields.find((field) => field.name === "categoryIds")).toMatchObject({
      type: "option-values",
      remoteSource: "product-categories",
    });
  });
});
