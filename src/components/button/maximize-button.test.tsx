import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FormEvent } from "react";
import { MaximizeButton } from "./maximize-button";

describe("MaximizeButton", () => {
  it("never submits a surrounding form", () => {
    const submit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <MaximizeButton onMaximize={() => undefined} />
      </form>,
    );

    screen.getByRole("button", { name: "Maximize media" }).click();
    expect(submit).not.toHaveBeenCalled();
  });
});
