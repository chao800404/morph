import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

/**
 * Regression: closing a create page showed a validation error.
 *
 * A `<button>` inside a `<form>` defaults to `type="submit"`, so the create
 * page's Close button submitted the empty form instead of navigating away, and
 * the failed submit surfaced as an error toast. `Button` now defaults to
 * `type="button"`; anything that means to submit says so.
 */
describe("Button", () => {
  it("does not submit the surrounding form when no type is given", () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <Button>Close</Button>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("still submits when asked to", () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Create</Button>
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("leaves the type alone when rendering as another element", () => {
    render(
      <Button asChild>
        <a href="/somewhere">Go</a>
      </Button>,
    );

    expect(screen.getByRole("link", { name: "Go" }).hasAttribute("type")).toBe(
      false,
    );
  });
});
