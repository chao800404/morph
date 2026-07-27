import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataTableFilter } from "./data-table-filter";

const OPTIONS = [
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
] as const;

describe("DataTableFilter", () => {
  it("renders Add filter without an active chip", () => {
    render(
      <DataTableFilter
        label="Add filter"
        filterLabel="Type"
        options={[...OPTIONS]}
        onValueChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Add filter" })).toBeTruthy();
    expect(screen.queryByLabelText(/Remove Type filter/i)).toBeNull();
  });

  it("renders and removes the active filter chip", () => {
    const onValueChange = vi.fn();
    render(
      <DataTableFilter
        label="Add filter"
        filterLabel="Type"
        options={[...OPTIONS]}
        value="image"
        onValueChange={onValueChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Type filter: Images",
      }),
    );

    expect(onValueChange).toHaveBeenCalledWith(undefined);
  });
});
