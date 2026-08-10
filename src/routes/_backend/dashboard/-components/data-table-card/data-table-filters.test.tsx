import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DataTableFilters } from "./data-table-filters";

const CurrencyFilters = () => {
  const [currencies, setCurrencies] = useState<string[]>([]);

  return (
    <DataTableFilters
      filters={[
        {
          key: "currency",
          label: "Currency",
          options: [
            { value: "twd", label: "TWD" },
            { value: "usd", label: "USD" },
          ],
          values: currencies,
          onValuesChange: setCurrencies,
        },
      ]}
    />
  );
};

describe("DataTableFilters", () => {
  it("uses the Medusa field-first Add filter flow", async () => {
    render(<CurrencyFilters />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Add filter" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Currency" }));

    expect(await screen.findByRole("button", { name: "Currency filter" })).toBeTruthy();
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(await screen.findByText("TWD")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Add filter" }),
    ).toBeNull();
  });

  it("returns a removed field to the Add filter menu", async () => {
    render(<CurrencyFilters />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Add filter" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Currency" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Currency filter" }),
    );

    expect(screen.getByRole("button", { name: "Add filter" })).toBeTruthy();
  });

  it("supports multiple values and a removable segmented pill", async () => {
    render(<CurrencyFilters />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Add filter" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Currency" }));
    fireEvent.click(await screen.findByText("TWD"));
    fireEvent.click(screen.getByText("USD"));

    expect(screen.getByRole("button", { name: "Currency filter" }).textContent).toContain(
      "isTWD, USD",
    );
    expect(screen.getByRole("button", { name: "Clear all" })).toBeTruthy();
  });

  it("clears all configured filters", () => {
    const onValuesChange = vi.fn();
    render(
      <DataTableFilters
        filters={[
          {
            key: "currency",
            label: "Currency",
            options: [{ value: "twd", label: "TWD" }],
            values: ["twd"],
            onValuesChange,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onValuesChange).toHaveBeenCalledWith([]);
  });

  it("replaces the value for single-select filters", () => {
    const onValuesChange = vi.fn();
    render(
      <DataTableFilters
        filters={[
          {
            key: "changedAt",
            label: "Changed at",
            options: [
              { value: "7d", label: "Last 7 days" },
              { value: "30d", label: "Last 30 days" },
            ],
            values: ["7d"],
            multiple: false,
            onValuesChange,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Changed at filter" }));
    fireEvent.click(screen.getByText("Last 30 days"));
    expect(onValuesChange).toHaveBeenCalledWith(["30d"]);
  });
});
