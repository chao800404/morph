import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./route-modal-close", () => ({
  useRouteModalClose: () => vi.fn(),
  useCloseOnEscape: vi.fn(),
}));

const { RouteSurfacePending } = await import("./route-surface-pending");

/**
 * Regression: the fallback used to be an in-flow block, so the page behind an
 * overlay stayed fully visible while its chunk loaded — opening the product
 * wizard from an option showed the product list first.
 */
describe("RouteSurfacePending", () => {
  it("covers the viewport", () => {
    const { container } = render(<RouteSurfacePending />);

    const root = container.firstElementChild;
    expect(root?.className).toContain("fixed");
    expect(root?.className).toContain("inset-0");
  });

  it("uses a form-shaped skeleton instead of a spinner", () => {
    const { getByLabelText, queryByRole } = render(<RouteSurfacePending />);

    expect(getByLabelText("Loading form").getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(queryByRole("status")).toBeNull();
  });
});
