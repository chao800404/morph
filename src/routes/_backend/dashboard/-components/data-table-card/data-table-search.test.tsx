import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataTableSearch } from "./data-table-search";

const router = vi.hoisted(() => ({
  query: "",
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => router.navigate,
  useSearch: () => ({ q: router.query }),
}));

describe("DataTableSearch", () => {
  beforeEach(() => {
    router.query = "";
    router.navigate.mockReset();
  });

  it("preserves the input node and focus when route search updates", () => {
    const { rerender } = render(<DataTableSearch />);
    const input = screen.getByPlaceholderText("Search");

    input.focus();
    fireEvent.change(input, { target: { value: "red" } });
    router.query = "red";
    rerender(<DataTableSearch />);

    expect(screen.getByPlaceholderText("Search")).toBe(input);
    expect(document.activeElement).toBe(input);
    expect((input as HTMLInputElement).value).toBe("red");
  });

  it("keeps focus in the input after clearing", () => {
    router.query = "red";
    render(<DataTableSearch />);
    const input = screen.getByPlaceholderText("Search");

    input.focus();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Clear search" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(document.activeElement).toBe(input);
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("exposes the configured search label to assistive technology", () => {
    render(<DataTableSearch placeholder="Search users" />);

    expect(screen.getByRole("textbox", { name: "Search users" })).toBeTruthy();
  });
});
