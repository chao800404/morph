import { describe, expect, it } from "vitest";
import type { SectionPresentationToken } from "./preview-protocol";
import {
  createSectionPresentationTrace,
  formatSectionPresentationTrace,
  SECTION_PRESENTATION_TRACE_BUDGET,
  SECTION_PRESENTATION_TRACE_WINDOW_MS,
  shortPresentationDocumentId,
  type SectionPresentationTraceEvent,
} from "./section-presentation-trace";

const DOCUMENT_ID = "0123456789abcdef0123456789abcdef";
const scope = { frame: "f1", readyRound: 2, documentId: DOCUMENT_ID } as const;
const token: SectionPresentationToken = {
  workspaceKey: "storefront-1:theme-1",
  templateId: "template-1",
  routePath: "/",
  sectionId: "hero",
  documentBasis: { kind: "existing", draftGeneration: 7 },
  overlayRevision: 3,
  presentationRevision: 12,
  operationId: "section-presentation-12",
};

describe("[preview-presentation] lines", () => {
  it("names the operation, section, basis and the frame round on every token line", () => {
    const posted = formatSectionPresentationTrace({
      type: "posted",
      scope,
      token,
      via: "replay",
    });
    expect(posted).toEqual({
      kind: "routine",
      text: "[preview-presentation] posted op=section-presentation-12 section=hero template=template-1 route=/ basis=existing:7 overlay=3 via=replay round=2 frame=f1 doc=01234567",
    });
    expect(
      formatSectionPresentationTrace({
        type: "ack-accepted",
        scope,
        token,
        status: "applied",
        pageReady: false,
        unconfirmed: 2,
      }).text,
    ).toBe(
      "[preview-presentation] ack accepted op=section-presentation-12 section=hero template=template-1 route=/ basis=existing:7 overlay=3 status=applied round=2 frame=f1 doc=01234567 page=waiting unconfirmed=2",
    );
  });

  it("says which guard refused an answer, and only an answer for a replaced token is routine", () => {
    const refused = formatSectionPresentationTrace({
      type: "ack-rejected",
      scope,
      token,
      status: "applied",
      guard: "token-mismatch",
    });
    expect(refused.kind).toBe("anomaly");
    expect(refused.text).toContain(" guard=token-mismatch ");
    expect(refused.text).toContain("op=section-presentation-12");
    expect(
      formatSectionPresentationTrace({
        type: "ack-rejected",
        scope,
        token,
        status: "not-applied",
        reason: "superseded",
        guard: "no-pending",
      }).kind,
    ).toBe("routine");
  });

  it("logs a new document's basis by kind only, and a document id by its first 8 hex", () => {
    const line = formatSectionPresentationTrace({
      type: "posted",
      scope,
      token: {
        ...token,
        documentBasis: { kind: "new-document", createEpoch: "route:/secret-epoch" },
      },
      via: "edit",
    }).text;
    expect(line).toContain("basis=new-document ");
    expect(line).not.toContain("secret-epoch");
    expect(line).not.toContain(DOCUMENT_ID);
    expect(shortPresentationDocumentId(null)).toBe("none");
    expect(shortPresentationDocumentId("not hex!")).toBe("invalid");
  });

  it("never carries the workspace key", () => {
    const events: SectionPresentationTraceEvent[] = [
      { type: "posted", scope, token, via: "edit" },
      { type: "ack-withdrawn", scope, token },
      {
        type: "ack-rejected",
        scope,
        token,
        status: "applied",
        guard: "other-round",
      },
    ];
    for (const event of events) {
      expect(formatSectionPresentationTrace(event).text).not.toContain(
        token.workspaceKey,
      );
    }
  });
});

describe("the trace's budget", () => {
  it("drops routine lines past the budget in one round and says so once; anomalies keep their own budget", () => {
    const lines: string[] = [];
    let now = 0;
    const trace = createSectionPresentationTrace(
      (line) => lines.push(line),
      3,
      () => now,
    );
    for (let index = 0; index < 10; index += 1) {
      trace.record({ type: "posted", scope, token, via: "edit" });
    }
    expect(lines.filter((line) => line.includes(" posted "))).toHaveLength(3);
    expect(lines.filter((line) => line.includes("routine lines suppressed"))).toEqual([
      "[preview-presentation] routine lines suppressed after 3 round=2 frame=f1 doc=01234567",
    ]);
    trace.record({
      type: "ack-rejected",
      scope,
      token,
      status: "applied",
      guard: "not-latest",
    });
    expect(lines.at(-1)).toContain("guard=not-latest");

    // A new round starts the budget over.
    trace.record({
      type: "posted",
      scope: { ...scope, readyRound: 3 },
      token,
      via: "edit",
    });
    expect(lines.at(-1)).toContain("round=3");

    // So does a new window in the same round.
    for (let index = 0; index < 5; index += 1) {
      trace.record({ type: "posted", scope, token, via: "edit" });
    }
    const before = lines.length;
    now += SECTION_PRESENTATION_TRACE_WINDOW_MS;
    trace.record({ type: "posted", scope, token, via: "edit" });
    expect(lines.length).toBe(before + 1);
  });

  it("defaults to a budget that bounds a burst", () => {
    expect(SECTION_PRESENTATION_TRACE_BUDGET).toBeLessThanOrEqual(64);
  });
});
