import { describe, expect, it } from "vitest";
import {
  confirmPreviewContent,
  type PreviewContentConfirmDeps,
} from "./preview-content-confirm";
import {
  previewContentDraftGenerations,
  withConfirmingInstance,
} from "./preview-content-basis";

/**
 * What Core tells the editor about a snapshot it wrote (option B): the draft
 * generation of each template in it, read from the versions the snapshot was
 * built at, and the dev server instance that confirmed reading it. The editor
 * compares the frame's stamp with these; Core itself never reads the stamp.
 */

describe("previewContentDraftGenerations", () => {
  it("reads each template's draft generation from the snapshot's versions", () => {
    expect(
      previewContentDraftGenerations(
        JSON.stringify({
          templates: [
            { id: "template-1", generation: 3, revision: "r1" },
            { id: "template-2", generation: 1, revision: null },
          ],
          pages: [{ handle: "about", revision: "p1", updatedAt: 1 }],
        }),
      ),
    ).toEqual({ "template-1": 3, "template-2": 1 });
  });

  it("names nothing it cannot read as a generation", () => {
    for (const text of [
      undefined,
      "",
      "not json",
      "null",
      JSON.stringify({}),
      JSON.stringify({ templates: "x" }),
    ]) {
      expect(previewContentDraftGenerations(text), String(text)).toEqual({});
    }
    expect(
      previewContentDraftGenerations(
        JSON.stringify({
          templates: [
            { id: "", generation: 3 },
            { id: "a", generation: 0 },
            { id: "b", generation: 1.5 },
            { id: "c", generation: "3" },
            { id: "d", generation: 2 },
          ],
        }),
      ),
    ).toEqual({ d: 2 });
  });
});

describe("withConfirmingInstance", () => {
  it("names the instance whose Worker confirmed the ticket", async () => {
    const probes = [
      { ticket: 4, instance: "server-a" },
      { ticket: 9, instance: "server-before-restart" },
      { ticket: 5, instance: "server-a" },
    ];
    const deps: PreviewContentConfirmDeps = {
      run: async () => {
        throw new Error("unused");
      },
      probe: async () => probes.shift() ?? null,
      sleep: async () => {},
    };
    const recorded = withConfirmingInstance(deps);
    const result = await confirmPreviewContent(recorded.deps, {
      ticket: 5,
      instance: "server-a",
    });
    expect(result).toEqual({ applied: true, ticket: 5 });
    expect(recorded.instance()).toBe("server-a");
  });

  it("names none before any probe answered", () => {
    const recorded = withConfirmingInstance({
      run: async () => {
        throw new Error("unused");
      },
      probe: async () => null,
    });
    expect(recorded.instance()).toBe(null);
  });
});
