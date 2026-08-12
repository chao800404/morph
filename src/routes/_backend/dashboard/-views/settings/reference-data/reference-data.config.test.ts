import { describe, expect, it } from "vitest";
import {
  referenceDataFields,
  toReferenceDataKind,
} from "./reference-data.config";

describe("reference data configuration", () => {
  it("accepts only registered settings slugs", () => {
    expect(toReferenceDataKind("product-types")).toBe("product-types");
    expect(toReferenceDataKind("product-tags")).toBe("product-tags");
    expect(toReferenceDataKind("return-reasons")).toBe("return-reasons");
    expect(toReferenceDataKind("refund-reasons")).toBe("refund-reasons");
    expect(toReferenceDataKind("unknown")).toBeNull();
  });

  it("keeps all authoring fields full-width in the two-column form grid", () => {
    const fields = referenceDataFields({ kind: "return-reasons" });
    expect(fields).toHaveLength(4);
    expect(fields.every((field) => field.colSpan === 2)).toBe(true);
    expect(fields.find((field) => field.type === "textarea")?.colSpan).toBe(2);
  });

  it("does not expose reason-only fields for product taxonomy", () => {
    expect(
      referenceDataFields({ kind: "product-types" }).map((field) => field.name),
    ).toEqual(["name"]);
    expect(
      referenceDataFields({ kind: "product-tags" }).map((field) => field.name),
    ).toEqual(["name"]);
  });
});
