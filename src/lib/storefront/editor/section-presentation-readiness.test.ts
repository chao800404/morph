import { describe, expect, it } from "vitest";
import {
  isSectionPresentationPageReady,
  sectionPresentationKey,
  type ExpectedSectionPresentation,
} from "./section-presentation-readiness";
import type { SectionPresentationToken } from "./preview-protocol";

const expected = (
  templateId: string,
  sectionId: string,
  presentationRevision: number,
): ExpectedSectionPresentation => ({
  workspaceKey: "store-1:theme-1",
  templateId,
  routePath: "/about",
  sectionId,
  documentBasis: { kind: "existing", draftGeneration: 3 },
  overlayRevision: 4,
  presentationRevision,
});

const token = (
  projection: ExpectedSectionPresentation,
): SectionPresentationToken => ({
  ...projection,
  operationId: `presentation-${projection.presentationRevision}`,
});

describe("section presentation readiness", () => {
  it("opens the page only after every current section projection is acknowledged", () => {
    const page = [expected("page", "hero", 1), expected("layout", "header", 2)];
    const latest = new Map(
      page.map((projection) => [
        sectionPresentationKey(projection.templateId, projection.sectionId),
        token(projection),
      ]),
    );
    const acknowledged = new Map(latest);

    expect(
      isSectionPresentationPageReady({ page, latest, acknowledged }),
    ).toBe(true);
    acknowledged.delete(sectionPresentationKey("layout", "header"));
    expect(
      isSectionPresentationPageReady({ page, latest, acknowledged }),
    ).toBe(false);
  });

  it("does not let an older acknowledged projection open the page", () => {
    const current = expected("page", "hero", 2);
    const old = token(expected("page", "hero", 1));
    const latest = new Map([
      [sectionPresentationKey("page", "hero"), token(current)],
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
    const page = [expected("page", "header", 1), expected("layout", "header", 2)];
    const latest = new Map(
      page.map((projection) => [
        sectionPresentationKey(projection.templateId, projection.sectionId),
        token(projection),
      ]),
    );
    const acknowledged = new Map(latest);

    acknowledged.delete(sectionPresentationKey("layout", "header"));
    expect(
      isSectionPresentationPageReady({ page, latest, acknowledged }),
    ).toBe(false);
  });
});
