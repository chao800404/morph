import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataTablePagination } from "./data-table-pagination";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

describe("DataTablePagination", () => {
  beforeEach(() => {
    navigate.mockClear();
  });

  it("keeps every page control visible when the result has one page", () => {
    render(
      <DataTablePagination
        pagination={{
          page: 1,
          limit: 10,
          total: 3,
          totalPages: 1,
        }}
      />,
    );

    expect(screen.getByTitle("First page").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTitle("Previous page").hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByTitle("Next page").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTitle("Last page").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("1 - 3 of 3 Results")).toBeTruthy();
    expect(screen.getByText("1 of 1 Pages")).toBeTruthy();
  });
});
