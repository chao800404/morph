import { describe, expect, it } from "vitest";
import { readSelectionContentValue } from "./selection-content-value";

describe("readSelectionContentValue", () => {
  it("reads the current input value instead of its empty text content", () => {
    const input = document.createElement("input");
    input.defaultValue = "Default input copy";
    input.value = "Default input copy";

    expect(input.textContent).toBe("");
    expect(readSelectionContentValue(input)).toBe("Default input copy");
  });

  it("reads the current textarea value", () => {
    const textarea = document.createElement("textarea");
    textarea.defaultValue = "Default textarea copy";
    textarea.value = "Default textarea copy";

    expect(readSelectionContentValue(textarea)).toBe("Default textarea copy");
  });

  it("reads the selected option value", () => {
    const select = document.createElement("select");
    select.innerHTML = `
      <option value="first">First</option>
      <option value="default-choice" selected>Default choice</option>
    `;

    expect(readSelectionContentValue(select)).toBe("default-choice");
  });

  it("reads ordinary element text and bounds every result", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Rendered copy";
    expect(readSelectionContentValue(paragraph)).toBe("Rendered copy");

    const input = document.createElement("input");
    input.value = "x".repeat(10_001);
    expect(readSelectionContentValue(input)).toHaveLength(10_000);
  });
});
