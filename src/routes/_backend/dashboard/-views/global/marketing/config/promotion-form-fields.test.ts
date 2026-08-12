import { describe, expect, it } from "vitest";
import {
  promotionCommonFields,
  promotionFields,
} from "./promotion-form-fields";

describe("promotion form field factories", () => {
  it("shares the common create and edit field names", () => {
    const values = {
      code: "SUMMER20",
      status: "draft" as const,
      isAutomatic: false,
      value: "20",
      currencyCode: "usd",
      limit: "",
      maxQuantity: "",
      isTaxInclusive: false,
    };
    const create = promotionCommonFields({ ...values, mode: "create" });
    const edit = promotionCommonFields({ ...values, mode: "edit" });

    expect(create.map((field) => field.name)).toEqual(
      edit.map((field) => field.name),
    );
  });

  it("builds the edit form from the same shared fields", () => {
    const names = promotionFields().map((field) => field.name);

    for (const name of [
      "code",
      "status",
      "isAutomatic",
      "value",
      "currencyCode",
      "limit",
      "maxQuantity",
      "isTaxInclusive",
    ]) {
      expect(names).toContain(name);
    }
  });
});
