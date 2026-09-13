import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorAddPageDialog } from "./editor-add-page-dialog";

const existingPaths = [
  "src/routes/index.tsx",
  "src/routes/lookbook.tsx",
  "src/routes/products.$slug.tsx",
];

function renderDialog(
  onAddPage: (routePath: string) => Promise<{ ok: boolean; reason?: string }>,
) {
  const onOpenChange = vi.fn();
  render(
    <EditorAddPageDialog
      open
      onOpenChange={onOpenChange}
      existingPaths={existingPaths}
      onAddPage={onAddPage}
    />,
  );
  return {
    onOpenChange,
    input: screen.getByLabelText("Path"),
    submit: screen.getByRole("button", { name: "Add page" }),
  };
}

describe("asking for a page in the editor", () => {
  it("cannot be submitted until a usable path is typed", () => {
    const { input, submit } = renderDialog(async () => ({ ok: true }));
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: "/lookbook" } });
    expect(screen.getByRole("alert").textContent).toContain("already exists");
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: "/about" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("submits the address, not the characters the author typed", async () => {
    // Someone describing an address types it loosely; the page they meant is
    // the same one either way.
    const onAddPage = vi.fn(async () => ({ ok: true }));
    const { input, submit } = renderDialog(onAddPage);

    fireEvent.change(input, { target: { value: " about/ " } });
    fireEvent.click(submit);

    await waitFor(() => expect(onAddPage).toHaveBeenCalledWith("/about"));
  });

  it("keeps what the author typed when the server refuses", async () => {
    // A refusal they can act on — someone else changed the theme — must not
    // also cost them the path they had entered.
    const onAddPage = vi.fn(async () => ({
      ok: false,
      reason: "Remote source changes detected",
    }));
    const { input, submit, onOpenChange } = renderDialog(onAddPage);

    fireEvent.change(input, { target: { value: "/about" } });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Remote source changes detected",
      ),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect((input as HTMLInputElement).value).toBe("/about");
  });

  it("clears a stale refusal as soon as the path changes", async () => {
    const onAddPage = vi.fn(async () => ({ ok: false, reason: "Nope" }));
    const { input, submit } = renderDialog(onAddPage);

    fireEvent.change(input, { target: { value: "/about" } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    fireEvent.change(input, { target: { value: "/contact" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
