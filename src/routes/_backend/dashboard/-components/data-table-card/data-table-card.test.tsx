import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DataTableCard } from "./data-table-card";

vi.mock("./data-table-search", () => ({
  DataTableSearch: () => <div>Search control</div>,
}));

vi.mock("./data-table-sort", () => ({
  DataTableSort: () => <div>Sort control</div>,
}));

const rows = [
  { id: "twd", name: "New Taiwan Dollar", locked: true },
  { id: "usd", name: "US Dollar", locked: false },
];

const SelectableTable = () => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  return (
    <DataTableCard
      label="Currencies"
      columns={[
        {
          key: "name",
          header: "Name",
          cell: (row) => row.name,
        },
      ]}
      rows={rows}
      getRowId={(row) => row.id}
      emptyTitle="No currencies"
      emptyDescription="Add a currency."
      selection={{
        selectedIds,
        onChange: setSelectedIds,
        isRowSelectable: (row) => !row.locked,
      }}
    />
  );
};

describe("DataTableCard selection", () => {
  it("selects eligible rows while keeping locked rows disabled", () => {
    const { container } = render(<SelectableTable />);

    const cardClassName =
      container.querySelector("[data-slot='card']")?.className ?? "";
    expect(cardClassName).toContain("h-auto");
    expect(cardClassName).not.toContain("h-content");
    const locked = screen.getByRole("checkbox", {
      name: "Select row twd",
    });
    const selectable = screen.getByRole("checkbox", {
      name: "Select row usd",
    });

    expect(locked.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows" }));
    expect(selectable.getAttribute("data-state")).toBe("checked");
    expect(locked.getAttribute("data-state")).toBe("unchecked");
  });

  it("keeps filters, search and sort in the shared toolbar", () => {
    render(
      <DataTableCard
        label="Options"
        columns={[
          {
            key: "name",
            header: "Name",
            cell: (row: (typeof rows)[number]) => row.name,
          },
        ]}
        rows={rows}
        getRowId={(row) => row.id}
        emptyTitle="No options"
        emptyDescription="Create an option."
        toolbarLeading={<button type="button">Add filter</button>}
        searchPlaceholder="Search"
        sortOptions={[{ value: "name", label: "Name" }]}
        headerActions={<button type="button">Create</button>}
      />,
    );

    const addFilter = screen.getByRole("button", { name: "Add filter" });
    const create = screen.getByRole("button", { name: "Create" });
    const toolbar = addFilter.closest("div.border-y");
    const header = create.closest("[data-type='card-header']");

    expect(toolbar?.textContent).toContain("Add filter");
    expect(toolbar?.textContent).toContain("Search control");
    expect(toolbar?.textContent).toContain("Sort control");
    expect(header?.textContent).toContain("Create");
    expect(header?.textContent).not.toContain("Search control");
  });

  it("preloads clickable rows on pointer, focus, and touch intent", () => {
    const onRowClick = vi.fn();
    const onRowPreload = vi.fn();
    render(
      <DataTableCard
        label="Currencies"
        columns={[{ key: "name", header: "Name", cell: (row) => row.name }]}
        rows={[rows[0]]}
        getRowId={(row) => row.id}
        emptyTitle="No currencies"
        emptyDescription="Add a currency."
        onRowClick={onRowClick}
        onRowPreload={onRowPreload}
      />,
    );

    const row = screen.getByRole("link");
    fireEvent.mouseEnter(row);
    fireEvent.focus(row);
    fireEvent.touchStart(row);
    expect(onRowPreload).toHaveBeenCalledTimes(3);

    fireEvent.keyDown(row, { key: "Enter" });
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });
});
