import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardPagination } from "./card-pagination";

describe("CardPagination", () => {
  it("stacks page metadata above controls for narrow cards", () => {
    render(
      <CardPagination
        page={1}
        totalPages={6}
        itemsLength={66}
        startItem={1}
        endItem={12}
        layout="stacked"
        onPageChange={vi.fn()}
      />,
    );

    const navigation = screen.getByRole("navigation", {
      name: "pagination",
    });

    expect(navigation.getAttribute("data-pagination-layout")).toBe("stacked");
    expect(screen.getByText("1 - 12 of 66 Results")).toBeTruthy();
    expect(screen.getByText("1 of 6 Pages")).toBeTruthy();
    expect(screen.getByTitle("First page")).toBeTruthy();
    expect(screen.getByTitle("Last page")).toBeTruthy();
  });
});
