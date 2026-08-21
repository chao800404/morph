import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InspectorColorField } from "./inspector-color-field";
import { resolvePickerPosition } from "./inspector-color-picker-popover";

describe("InspectorColorField", () => {
  it("bottom-aligns the picker with its inspector module inside the viewport", () => {
    expect(
      resolvePickerPosition({
        inspectorLeft: 900,
        moduleBottom: 700,
        triggerTop: 620,
        pickerHeight: 500,
        viewportHeight: 800,
      }),
    ).toEqual({ left: 586, top: 200 });
  });

  it("previews while editing and commits only when editing finishes", () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const { rerender } = render(
      <InspectorColorField
        label="Fill"
        value="#fafaf9"
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Fill color value" });

    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "#d8d0c3" } });
    expect(onPreview).toHaveBeenLastCalledWith("#d8d0c3");
    expect(onCommit).not.toHaveBeenCalled();

    rerender(
      <InspectorColorField
        label="Fill"
        value="#fafaf9"
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );
    expect((input as HTMLInputElement).value).toBe("#d8d0c3");

    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("#d8d0c3");
  });

  it("opens the modular picker on the left and clears through the theme palette", () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const onClear = vi.fn();
    const { container } = render(
      <aside data-editor-inspector-panel>
        <InspectorColorField
          label="Text"
          value="#1c1917"
          allowGradient
          onPreview={onPreview}
          onCommit={onCommit}
          onClear={onClear}
          palette={[
            {
              label: "Cream",
              value: "#d8d0c3",
              preview: "bg-[#d8d0c3]",
            },
          ]}
        />
      </aside>,
    );
    const panel = container.querySelector("[data-editor-inspector-panel]");
    Object.defineProperty(panel, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 900,
        top: 0,
        right: 1200,
        bottom: 800,
        width: 300,
        height: 800,
        x: 900,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Open Text color picker" }),
    );

    const picker = screen.getByRole("dialog", { name: "Text color picker" });
    expect(picker.getAttribute("data-side")).toBe("left");
    expect(picker.parentElement).toBe(document.body);
    expect(picker.style.left).toBe("586px");
    expect(picker.style.top).toBe("12px");
    expect(picker.className).not.toContain("animate-in");
    expect(picker.className).not.toContain("slide-in-from-right-4");
    expect(picker.className).toContain("max-h-[calc(100dvh-24px)]");
    expect(screen.getByText("Gradient")).not.toBeNull();
    expect(
      screen.getByRole("combobox", { name: "Text color model" }),
    ).not.toBeNull();
    expect(screen.getByRole("spinbutton", { name: "Text R" })).not.toBeNull();
    expect(screen.getByRole("spinbutton", { name: "Text A" })).not.toBeNull();
    expect(screen.queryByText("Theme palette")).toBeNull();
    expect(screen.queryByText("None")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Use theme color #d8d0c3 for Text",
      }),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Remove Text color" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(
      (
        screen.getByRole("textbox", {
          name: "Text color value",
        }) as HTMLInputElement
      ).value,
    ).toBe("");
    expect(
      (
        container.querySelector(
          "[data-inspector-color-swatch]",
        ) as HTMLSpanElement
      ).style.background,
    ).toBe("transparent");
    expect(
      (
        container.querySelector(
          "[data-inspector-color-clear-indicator]",
        ) as HTMLSpanElement
      ).hidden,
    ).toBe(false);

    fireEvent.pointerDown(
      document.querySelector(
        "[data-inspector-color-picker-dismiss]",
      ) as HTMLDivElement,
    );
    expect(
      screen.queryByRole("dialog", { name: "Text color picker" }),
    ).toBeNull();
  });

  it("accepts gradient paint only when the field enables it", () => {
    const gradient =
      "linear-gradient(90deg, rgba(28,25,23,1) 0%, rgba(216,208,195,1) 100%)";
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    render(
      <InspectorColorField
        label="Background"
        value="#fafaf9"
        allowGradient
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );
    const input = screen.getByRole("textbox", {
      name: "Background color value",
    });

    fireEvent.input(input, { target: { value: gradient } });
    expect(onPreview).toHaveBeenLastCalledWith(gradient);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(gradient);
  });

  it("uses the shared color model controls for the selected gradient stop", () => {
    const gradient =
      "linear-gradient(90deg, rgba(28,25,23,1) 0%, rgba(216,208,195,1) 100%)";
    const onPreview = vi.fn();
    render(
      <InspectorColorField
        label="Background"
        value={gradient}
        allowGradient
        onPreview={onPreview}
        onCommit={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open Background color picker" }),
    );

    const modelSelect = screen.getByRole("combobox", {
      name: "Background color model",
    });
    expect(modelSelect).not.toBeNull();
    fireEvent.change(modelSelect, { target: { value: "hsl" } });
    expect(
      screen.getByRole("spinbutton", { name: "Background H" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("spinbutton", { name: "Background S" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("spinbutton", { name: "Background L" }),
    ).not.toBeNull();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Background L" }), {
      target: { value: "50" },
    });
    expect(onPreview).toHaveBeenLastCalledWith(
      expect.stringMatching(/rgba\(140,125,115,1\)/i),
    );
  });

  it("remembers separate solid and gradient drafts when switching modes", async () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const { rerender } = render(
      <InspectorColorField
        label="Background"
        value="#fafaf9"
        allowGradient
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open Background color picker" }),
    );
    fireEvent.click(screen.getByText("Gradient"));
    await waitFor(() =>
      expect(onPreview).toHaveBeenLastCalledWith(
        expect.stringContaining("linear-gradient"),
      ),
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: "Background R" }), {
      target: { value: "64" },
    });
    expect(onPreview).toHaveBeenLastCalledWith(
      expect.stringMatching(/linear-gradient\(.+rgba\(64,25,23,1\)/i),
    );
    const editedGradient = onPreview.mock.lastCall?.[0] as string;

    fireEvent.click(screen.getByText("Solid"));
    expect(onPreview).toHaveBeenLastCalledWith("#fafaf9");

    // A delayed source response from the previous mode must not replace the
    // active picker session or either of its remembered drafts.
    rerender(
      <InspectorColorField
        label="Background"
        value={editedGradient}
        allowGradient
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: "Background R" }), {
      target: { value: "10" },
    });
    expect(onPreview).toHaveBeenLastCalledWith("rgba(10,250,249,1)");

    fireEvent.click(screen.getByText("Gradient"));
    expect(onPreview).toHaveBeenLastCalledWith(
      expect.stringMatching(/linear-gradient\(.+rgba\(64,25,23,1\)/i),
    );

    fireEvent.click(screen.getByText("Solid"));
    expect(onPreview).toHaveBeenLastCalledWith("rgba(10,250,249,1)");
  });

  it("restores the confirmed value when an invalid color is finished", () => {
    const onCommit = vi.fn();
    render(
      <InspectorColorField
        label="Fill"
        value="#fafaf9"
        onPreview={vi.fn()}
        onCommit={onCommit}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Fill color value" });

    fireEvent.input(input, { target: { value: "not-a-color" } });
    fireEvent.blur(input);

    expect((input as HTMLInputElement).value).toBe("#fafaf9");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancels a text edit without committing on Escape", () => {
    const onCommit = vi.fn();
    render(
      <InspectorColorField
        label="Fill"
        value="#fafaf9"
        onPreview={vi.fn()}
        onCommit={onCommit}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Fill color value" });

    fireEvent.input(input, { target: { value: "#d8d0c3" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect((input as HTMLInputElement).value).toBe("#fafaf9");
    expect(onCommit).not.toHaveBeenCalled();
  });
});
