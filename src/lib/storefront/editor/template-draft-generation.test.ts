import { describe, expect, it } from "vitest";
import {
  observeGenerationsAfterPublish,
  resolveTemplateDraftGeneration,
} from "./template-draft-generation";

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

  it("sends the generation a publish left, not the last write's", () => {
    // This session wrote the page (generation 7) and the shell (3), then
    // published both: the server moved them to 8 and 4.
    const observed = new Map([
      ["page", 7],
      ["shell", 3],
    ]);
    observeGenerationsAfterPublish(observed, {
      templateId: "page",
      draftGeneration: 8,
      alsoSealed: ["shell"],
    });
    const refreshed = [
      { id: "page", draftGeneration: 8 },
      { id: "shell", draftGeneration: 4 },
    ];
    expect(
      resolveTemplateDraftGeneration({
        templateId: "page",
        observed,
        templates: refreshed,
      }),
    ).toBe(8);
    expect(
      resolveTemplateDraftGeneration({
        templateId: "shell",
        observed,
        templates: refreshed,
      }),
    ).toBe(4);
  });

  it("falls back to the refreshed context when a publish returns no generation", () => {
    const observed = new Map([["page", 7]]);
    observeGenerationsAfterPublish(observed, {
      templateId: "page",
      draftGeneration: undefined,
      alsoSealed: [],
    });
    expect(
      resolveTemplateDraftGeneration({
        templateId: "page",
        observed,
        templates: [{ id: "page", draftGeneration: 8 }],
      }),
    ).toBe(8);
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
