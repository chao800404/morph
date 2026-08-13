import { describe, expect, it } from "vitest";
import {
  formatTaxProviderLabel,
  taxRegionEditFields,
  taxRegionFields,
  taxOverrideFields,
} from "./tax-form-fields";

const country = { label: "Taiwan", value: "tw" };
const providers = [{ label: "system", value: "tp_system" }];

describe("tax region form fields", () => {
  it("keeps optional default-rate fields on the create form", () => {
    expect(
      taxRegionFields([country], providers).map((field) => field.name),
    ).toEqual([
      "countryCode",
      "providerId",
      "defaultRateHelp",
      "defaultRateName",
      "defaultRateCode",
      "defaultRate",
    ]);
  });

  it("only exposes fields that the edit action persists", () => {
    const fields = taxRegionEditFields(country, providers, "tp_system");

    expect(fields.map((field) => field.name)).toEqual([
      "countryCode",
      "providerId",
    ]);
    expect(fields[0]).toMatchObject({ disabled: true, value: "tw" });
    expect(fields[1]).toMatchObject({ value: "tp_system", autoFocus: true });
  });

  it("formats provider handles as human-readable labels", () => {
    expect(formatTaxProviderLabel("tp_system")).toBe("System");
    expect(formatTaxProviderLabel("tp_custom_provider")).toBe(
      "Custom Provider",
    );
  });

  it("uses remote relation sources instead of embedding every product", () => {
    const fields = taxOverrideFields(crypto.randomUUID());
    expect(fields.find((field) => field.name === "products")).toMatchObject({
      type: "option-values",
      remoteSource: "tax-products",
      choices: [],
    });
    expect(fields.find((field) => field.name === "productTypes")).toMatchObject(
      { remoteSource: "tax-product-types" },
    );
    expect(
      fields.find((field) => field.name === "shippingOptions"),
    ).toMatchObject({ remoteSource: "tax-shipping-options" });
  });
});
