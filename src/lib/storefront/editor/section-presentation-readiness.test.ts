import { describe, expect, it } from "vitest";
import {
  currentAcknowledgedSectionPresentation,
  isSectionPresentationPageReady,
  presentationShowsWriteBasis,
  sectionPresentationKey,
  type ExpectedSectionPresentation,
} from "./section-presentation-readiness";
import type { SectionPresentationToken } from "./preview-protocol";

type AcknowledgablePresentation = Omit<
  ExpectedSectionPresentation,
  "documentBasis"
> & { documentBasis: SectionPresentationToken["documentBasis"] };

const expected = (
  templateId: string,
  sectionId: string,
): AcknowledgablePresentation => ({
  workspaceKey: "store-1:theme-1",
  templateId,
  routePath: "/about",
  sectionId,
  documentBasis: { kind: "existing", draftGeneration: 3 },
  overlayRevision: 4,
});

const token = (
  projection: AcknowledgablePresentation,
  presentationRevision: number,
): SectionPresentationToken => ({
  ...projection,
  presentationRevision,
  operationId: `presentation-${presentationRevision}`,
});

describe("section presentation readiness", () => {
  it("opens the page only after every current section projection is acknowledged", () => {
    const page = [expected("page", "hero"), expected("layout", "header")];
    const latest = new Map(
      page.map((projection, index) => [
        sectionPresentationKey(projection.templateId, projection.sectionId),
        token(projection, index + 1),
      ]),
    );
    const acknowledged = new Map(latest);

    expect(isSectionPresentationPageReady({ page, latest, acknowledged })).toBe(
      true,
    );
    acknowledged.delete(sectionPresentationKey("layout", "header"));
    expect(isSectionPresentationPageReady({ page, latest, acknowledged })).toBe(
      false,
    );
  });

  it("does not let an older acknowledged projection open the page", () => {
    const current = expected("page", "hero");
    const old = token(current, 1);
    const latest = new Map([
      [sectionPresentationKey("page", "hero"), token(current, 2)],
    ]);
    const acknowledged = new Map([
      [sectionPresentationKey("page", "hero"), old],
    ]);

    expect(
      isSectionPresentationPageReady({
        page: [current],
        latest,
        acknowledged,
      }),
    ).toBe(false);
  });

  it("keeps same-named sections in different template documents separate", () => {
    const page = [expected("page", "header"), expected("layout", "header")];
    const latest = new Map(
      page.map((projection, index) => [
        sectionPresentationKey(projection.templateId, projection.sectionId),
        token(projection, index + 1),
      ]),
    );
    const acknowledged = new Map(latest);

    acknowledged.delete(sectionPresentationKey("layout", "header"));
    expect(isSectionPresentationPageReady({ page, latest, acknowledged })).toBe(
      false,
    );
  });

  it("selects proof only from the requested template when section ids repeat", () => {
    const pageSection = expected("page", "header");
    const layoutSection = expected("layout", "header");
    const pageToken = token(pageSection, 1);
    const layoutToken = token(layoutSection, 2);
    const presentations = new Map([
      [sectionPresentationKey("page", "header"), pageToken],
      [sectionPresentationKey("layout", "header"), layoutToken],
    ]);

    expect(
      currentAcknowledgedSectionPresentation({
        templateId: "layout",
        sectionId: "header",
        latest: presentations,
        acknowledged: presentations,
      }),
    ).toEqual(layoutToken);
  });
});

// Task 40 item 4: the proof is compared with the basis the write sends.
describe("whether an acknowledged presentation shows a write's basis", () => {
  const existing = (draftGeneration: number) =>
    ({ kind: "existing", draftGeneration }) as const;

  it("refuses a write made on a newer copy than the acknowledged presentation showed", () => {
    expect(presentationShowsWriteBasis(existing(3), [4])).toBe(false);
    expect(presentationShowsWriteBasis(existing(3), [3, 4])).toBe(false);
  });

  it("accepts a write made on the copy the presentation showed", () => {
    expect(presentationShowsWriteBasis(existing(3), [3])).toBe(true);
    expect(presentationShowsWriteBasis(existing(3), [2, 3])).toBe(true);
  });

  it("leaves a presentation newer than the basis to the composition rule", () => {
    // Only this session's own steps may lie between (selectCurrentContentFields).
    expect(presentationShowsWriteBasis(existing(4), [3])).toBe(true);
  });

  it("leaves a write with no recorded basis to the stage-1 refusal", () => {
    expect(presentationShowsWriteBasis(existing(3), [undefined])).toBe(true);
    expect(presentationShowsWriteBasis(existing(3), [])).toBe(true);
  });

  it("matches a presentation of a route with no document only to input made with no basis", () => {
    const created = { kind: "new-document", createEpoch: "route:/about" } as const;
    expect(presentationShowsWriteBasis(created, [undefined])).toBe(true);
    expect(presentationShowsWriteBasis(created, [1])).toBe(false);
  });
});
