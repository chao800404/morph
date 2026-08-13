import { describe, expect, it } from "vitest";
import { salesChannelFormFields } from "./sales-channel-form-fields";

describe("salesChannelFormFields", () => {
  it("defaults new channels to custom and lets the author choose a type", () => {
    const typeField = salesChannelFormFields().find(
      (field) => field.name === "type",
    );

    expect(typeField).toMatchObject({
      type: "select",
      value: "custom",
      disabled: false,
    });
  });

  it("shows but locks the persisted type while editing", () => {
    const typeField = salesChannelFormFields({
      name: "Online Store",
      type: "storefront",
      description: null,
      isDisabled: false,
    }).find((field) => field.name === "type");

    expect(typeField).toMatchObject({
      type: "select",
      value: "storefront",
      disabled: true,
    });
  });
});
