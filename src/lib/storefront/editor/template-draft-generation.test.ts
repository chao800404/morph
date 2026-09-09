import { describe, expect, it } from "vitest";
import { resolveTemplateDraftGeneration } from "./template-draft-generation";

const templates = [
  { id: "page", draftGeneration: 7 },
  { id: "shell", draftGeneration: 2 },
];

describe("the draft generation sent with a template write", () => {
  it("answers for the template being written, not the one that is open", () => {
    expect(
      resolveTemplateDraftGeneration({
        templateId: "shell",
        observed: new Map(),
        templates,
      }),
    ).toBe(2);
  });

  it("prefers what this session's own writes returned", () => {
    expect(
      resolveTemplateDraftGeneration({
        templateId: "shell",
        observed: new Map([["shell", 5]]),
        templates,
      }),
    ).toBe(5);
  });

  it("starts at 1 for a template it has never seen", () => {
    expect(
      resolveTemplateDraftGeneration({
        templateId: "unknown",
        observed: new Map(),
        templates,
      }),
    ).toBe(1);
  });
});
