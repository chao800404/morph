import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InspectorLengthControl } from "./inspector-length-control";

describe("InspectorLengthControl", () => {
  const openSelect = (name: string) => {
    const trigger = screen.getByRole("combobox", { name });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
  };

  it("previews and commits a unit switch once", async () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    render(
      <InspectorLengthControl
        label="W"
        ariaLabel="Element width"
        value={{ unit: "px", value: 24 }}
        allowAuto
        disabled={false}
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );

    const unitTriggerClasses = screen
      .getByRole("combobox", { name: "Element width unit" })
      .className.split(" ");
    const row = screen
      .getByRole("spinbutton", { name: "Element width" })
      .closest('[data-slot="inspector-control-row"]');
    expect(row).toBeTruthy();
    expect(
      row?.querySelector('[data-slot="inspector-control-row-label"]'),
    )?.toHaveProperty("textContent", "W");
    expect(
      row
        ?.querySelector('[data-slot="inspector-control-row-unit"]')
        ?.contains(
          screen.getByRole("combobox", { name: "Element width unit" }),
        ),
    ).toBe(true);
    expect(unitTriggerClasses).toEqual(
      expect.arrayContaining(["w-auto", "min-w-0", "px-2", "[&>svg]:hidden"]),
    );

    openSelect("Element width unit");
    const unitMenu = await screen.findByRole("listbox");
    expect(
      unitMenu.closest('[data-slot="select-content"]')?.className.split(" "),
    ).toEqual(expect.arrayContaining(["w-16", "min-w-16"]));
    expect(
      screen.getByRole("option", { name: "rem" }).className.split(" "),
    ).toEqual(expect.arrayContaining(["min-h-7", "pr-7", "text-xs"]));
    fireEvent.click(await screen.findByRole("option", { name: "rem" }));

    expect(onPreview).toHaveBeenCalledWith("24rem", 24);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("24rem", 24);
  });

  it("uses the active unit scrub increment while allowing free typed precision", () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    render(
      <InspectorLengthControl
        label="Padding"
        ariaLabel="Section padding"
        value={{ unit: "rem", value: 1 }}
        steps={{
          px: 4,
          "%": 1,
          rem: 0.25,
          em: 0.25,
          vw: 1,
          vh: 1,
        }}
        disabled={false}
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );

    const input = screen.getByRole("spinbutton", {
      name: "Section padding",
    }) as HTMLInputElement;
    expect(input.getAttribute("step")).toBe("any");
    Object.defineProperty(input, "setPointerCapture", { value: vi.fn() });
    fireEvent.pointerDown(input, {
      button: 0,
      pointerId: 1,
      clientX: 100,
    });
    fireEvent.pointerMove(input, {
      pointerId: 1,
      clientX: 104,
    });
    fireEvent.pointerUp(input, {
      pointerId: 1,
      clientX: 104,
    });

    expect(onPreview).toHaveBeenLastCalledWith("1.25rem", 1.25);
    expect(onCommit).toHaveBeenLastCalledWith("1.25rem", 1.25);
  });

  it("switches an automatic size back to a concrete unit", async () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    render(
      <InspectorLengthControl
        label="H"
        ariaLabel="Element height"
        value={{ unit: "auto", value: null }}
        computedValue="320px"
        allowAuto
        disabled={false}
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );

    expect(
      screen.queryByRole("spinbutton", { name: "Element height" }),
    ).toBeNull();
    expect(screen.getByText("Auto")).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Element height unit" }).textContent,
    ).toBe("-");
    openSelect("Element height unit");
    fireEvent.click(await screen.findByRole("option", { name: "px" }));

    expect(onPreview).toHaveBeenCalledWith("320px", 320);
    expect(onCommit).toHaveBeenCalledWith("320px", 320);
  });

  it("allows Margin to switch from a length to Auto", async () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const { rerender } = render(
      <InspectorLengthControl
        label="Margin"
        ariaLabel="Section margin"
        value={{ unit: "px", value: 24 }}
        allowAuto
        disabled={false}
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );

    openSelect("Section margin unit");
    fireEvent.click(await screen.findByRole("option", { name: "Auto" }));

    expect(onPreview).toHaveBeenCalledWith("auto", null);
    expect(onCommit).toHaveBeenCalledWith("auto", null);
    rerender(
      <InspectorLengthControl
        label="Margin"
        ariaLabel="Section margin"
        value={{ unit: "auto", value: null }}
        allowAuto
        disabled={false}
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );
    expect(
      screen.queryByRole("spinbutton", { name: "Section margin" }),
    ).toBeNull();
  });

  it("limits border width units and renders the selected unit as secondary text", async () => {
    render(
      <InspectorLengthControl
        label="Border"
        ariaLabel="Border width"
        value={{ unit: "px", value: 2 }}
        allowedUnits={["px", "rem", "em"]}
        disabled={false}
        onPreview={vi.fn()}
        onCommit={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("combobox", {
      name: "Border width unit",
    });
    expect(trigger.className.split(" ")).toContain("text-muted-foreground");

    openSelect("Border width unit");
    expect(await screen.findByRole("option", { name: "px" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "rem" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "em" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "%" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Auto" })).toBeNull();
  });

  it("shows None as the maximum value and a dash as its unit", async () => {
    render(
      <InspectorLengthControl
        label="Max W"
        ariaLabel="Element maximum width"
        value={{ unit: "none", value: null }}
        allowNone
        disabled={false}
        onPreview={vi.fn()}
        onCommit={vi.fn()}
      />,
    );

    expect(screen.getByText("None")).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Element maximum width unit" })
        .textContent,
    ).toBe("-");
    openSelect("Element maximum width unit");
    expect(await screen.findByRole("option", { name: "None" })).toBeTruthy();
  });
});
