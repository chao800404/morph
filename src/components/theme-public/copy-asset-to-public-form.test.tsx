import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CopyAssetToPublicForm } from "./copy-asset-to-public-form";

const asset = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Hero",
  url: "/assets/33333333-3333-4333-8333-333333333333.png",
};

function renderForm(existing: string[] = []) {
  const onConfirm = vi.fn();
  render(
    <CopyAssetToPublicForm
      asset={asset}
      suggestedPath="public/images/hero.png"
      existingPaths={new Set(existing)}
      onCancel={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
  return { onConfirm };
}

describe("CopyAssetToPublicForm", () => {
  it("says the copy is the site's, public once published, and apart from the library", () => {
    renderForm();
    const notice = document.querySelector("[data-copy-asset-notice]")!;
    expect(notice.textContent).toContain("anyone can open it");
    expect(notice.textContent).toContain("cannot be made private");
    expect(notice.textContent).toContain("does not change this copy");
    expect(screen.getByText("/images/hero.png")).toBeTruthy();
  });

  it("copies to the path shown, or to one the author types", () => {
    const { onConfirm } = renderForm();
    fireEvent.change(screen.getByRole("textbox", { name: "Path in public/" }), {
      target: { value: "banners/hero.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy to public/" }));
    expect(onConfirm).toHaveBeenCalledWith("public/banners/hero.png");
  });

  it("will not copy onto a path in use, or one public/ does not serve", () => {
    const { onConfirm } = renderForm(["public/images/hero.png"]);
    const copy = screen.getByRole("button", {
      name: "Copy to public/",
    }) as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    expect(
      document.querySelector("[data-copy-asset-problem]")?.textContent,
    ).toContain("already exists");

    fireEvent.change(screen.getByRole("textbox", { name: "Path in public/" }), {
      target: { value: "images/hero.svg" },
    });
    expect(copy.disabled).toBe(true);
    fireEvent.submit(copy.closest("form")!);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
