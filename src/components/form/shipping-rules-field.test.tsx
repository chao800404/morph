import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShippingRulesField } from "./shipping-rules-field";

describe("ShippingRulesField", () => {
  it("adds and serializes a checkout rule as the form value changes", () => {
    const onChange = vi.fn();
    render(
      <ShippingRulesField
        field={{
          type: "shipping-rules",
          name: "rules",
          label: "Availability rules",
          maxRules: 2,
        }}
        fieldId="field-rules"
        value="[]"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    const hidden = document.querySelector(
      'input[name="rules"]',
    ) as HTMLInputElement;
    expect(JSON.parse(hidden.value)).toEqual([
      { attribute: "item_count", operator: "gte", value: "1" },
    ]);

    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "3" },
    });
    expect(JSON.parse(hidden.value)).toEqual([
      { attribute: "item_count", operator: "gte", value: "3" },
    ]);
    expect(onChange).toHaveBeenLastCalledWith(hidden.value);
  });
});
