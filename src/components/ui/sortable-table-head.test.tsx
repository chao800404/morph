import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SortableTableHead } from "./sortable-table-head";

const renderHead = (
  props: Partial<React.ComponentProps<typeof SortableTableHead>> = {},
) =>
  render(
    <table>
      <thead>
        <tr>
          <SortableTableHead sortLabel="Name" onSort={vi.fn()} {...props}>
            Name
          </SortableTableHead>
        </tr>
      </thead>
    </table>,
  );

describe("SortableTableHead", () => {
  it("exposes the current direction and triggers sorting", () => {
    const onSort = vi.fn();
    const { container } = renderHead({ direction: "desc", onSort });

    const button = screen.getByRole("button", {
      name: /Name, sort priority 1, sorted descending/i,
    });
    fireEvent.click(button);

    expect(onSort).toHaveBeenCalledTimes(1);
    expect(button.closest("th")?.getAttribute("aria-sort")).toBe("descending");
    expect(
      container
        .querySelector("[data-sort-indicator]")
        ?.getAttribute("data-direction"),
    ).toBe("asc");
    expect(
      container.querySelector("[data-sort-indicator]")?.className,
    ).toContain("opacity-0");
    expect(
      container.querySelector("[data-sort-indicator]")?.className,
    ).toContain("group-hover/sort:opacity-100");
  });

  it("announces secondary sort priority without claiming aria-sort", () => {
    const { container } = renderHead({
      direction: "asc",
      sortPriority: 2,
    });

    expect(
      screen.getByRole("button", {
        name: /Name, sort priority 2, sorted ascending/i,
      }),
    ).toBeTruthy();
    expect(container.querySelector("th")?.getAttribute("aria-sort")).toBe(
      "none",
    );
  });

  it("keeps the first-click direction available for hover and focus", () => {
    const { container } = renderHead({ nextDirection: "asc" });
    const indicator = container.querySelector("[data-sort-indicator]");

    expect(indicator?.getAttribute("data-direction")).toBe("asc");
    expect(indicator?.className).toContain("group-hover/sort:opacity-100");
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain(
      "Activate to sort ascending",
    );
  });

  it("previews the opposite direction when the active heading is hovered", () => {
    const { container } = renderHead({ direction: "asc" });

    expect(
      container
        .querySelector("[data-sort-indicator]")
        ?.getAttribute("data-direction"),
    ).toBe("desc");
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain(
      "Activate to sort descending",
    );
  });
});
