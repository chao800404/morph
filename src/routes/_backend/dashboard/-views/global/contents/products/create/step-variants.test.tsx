import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StepVariants } from "./step-variants";
import type { ProductDraft } from "./use-product-draft";

const draft: ProductDraft = {
  title: "Shirt",
  subtitle: "",
  handle: "shirt",
  description: "",
  collectionId: "",
  typeValue: "",
  tagValues: [],
  categoryIds: [],
  salesChannelIds: [],
  discountable: true,
  hasVariants: true,
  currencies: ["twd"],
  assets: [],
  defaultVariant: {
    key: "__default__",
    optionValues: [],
    included: true,
    title: "Default",
    sku: "",
    manageInventory: true,
    allowBackorder: false,
    inventoryQuantity: "0",
    prices: {},
  },
  options: [
    {
      key: "color",
      optionId: "option-color",
      title: "Color",
      available: [{ id: "red", value: "Red" }],
      selectedValueIds: ["red"],
    },
  ],
  variants: [
    {
      key: "Red",
      optionValues: ["Red"],
      included: true,
      title: "Red",
      sku: "",
      manageInventory: true,
      allowBackorder: false,
      inventoryQuantity: "0",
      prices: {},
    },
  ],
};

const currencies = [
  {
    code: "twd",
    symbol: "NT$",
    symbolNative: "$",
    name: "New Taiwan Dollar",
    decimalDigits: 0,
    rounding: 0,
    isDefault: true,
    isTaxInclusive: false,
  },
];

describe("StepVariants", () => {
  it("uses the option axes as the Medusa-style grid header", () => {
    render(
      <StepVariants draft={draft} dispatch={vi.fn()} currencies={currencies} />,
    );

    expect(screen.getByRole("columnheader", { name: "Color" })).toBeTruthy();
    expect(
      screen.getByRole("columnheader", { name: "Price TWD" }),
    ).toBeTruthy();
  });

  it("dispatches edits from borderless data-grid cells", () => {
    const dispatch = vi.fn();
    render(
      <StepVariants
        draft={draft}
        dispatch={dispatch}
        currencies={currencies}
      />,
    );

    const title = screen.getByLabelText("Title for Red");
    expect(title.className).toContain("bg-transparent");
    fireEvent.change(title, { target: { value: "Crimson" } });

    expect(dispatch).toHaveBeenCalledWith({
      type: "setVariantField",
      key: "Red",
      field: "title",
      value: "Crimson",
    });
  });

  it("uses the same data grid for the default variant", () => {
    render(
      <StepVariants
        draft={{ ...draft, hasVariants: false }}
        dispatch={vi.fn()}
        currencies={currencies}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Options" })).toBeTruthy();
    expect(screen.getByDisplayValue("Default")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "SKU" })).toBeTruthy();
    expect(
      screen.getByRole("columnheader", { name: "Managed inventory" }),
    ).toBeTruthy();
  });
});
