import {
  sameSectionPresentationToken,
  type SectionPresentationToken,
} from "./preview-protocol";

export type ExpectedSectionPresentation = Readonly<{
  workspaceKey: string;
  templateId: string;
  routePath: string;
  sectionId: string;
  documentBasis: SectionPresentationToken["documentBasis"] | null;
  overlayRevision: number;
}>;

export function sectionPresentationKey(templateId: string, sectionId: string) {
  return JSON.stringify([templateId, sectionId]);
}

function matchesExpectedPresentation(
  token: SectionPresentationToken | undefined,
  expected: ExpectedSectionPresentation,
): boolean {
  if (!token || !expected.documentBasis) return false;
  return (
    token.workspaceKey === expected.workspaceKey &&
    token.templateId === expected.templateId &&
    token.routePath === expected.routePath &&
    token.sectionId === expected.sectionId &&
    token.documentBasis.kind === expected.documentBasis.kind &&
    (token.documentBasis.kind === "existing"
      ? expected.documentBasis.kind === "existing" &&
        token.documentBasis.draftGeneration ===
          expected.documentBasis.draftGeneration
      : expected.documentBasis.kind === "new-document" &&
        token.documentBasis.createEpoch === expected.documentBasis.createEpoch) &&
    token.overlayRevision === expected.overlayRevision
  );
}

export function currentAcknowledgedSectionPresentation(args: {
  templateId: string;
  sectionId: string;
  latest: ReadonlyMap<string, SectionPresentationToken>;
  acknowledged: ReadonlyMap<string, SectionPresentationToken>;
}): SectionPresentationToken | null {
  const key = sectionPresentationKey(args.templateId, args.sectionId);
  const latest = args.latest.get(key);
  const acknowledged = args.acknowledged.get(key);
  return latest && acknowledged &&
    sameSectionPresentationToken(latest, acknowledged)
    ? acknowledged
    : null;
}

export function isSectionPresentationPagePresented(args: {
  page: readonly ExpectedSectionPresentation[];
  latest: ReadonlyMap<string, SectionPresentationToken>;
}): boolean {
  return args.page.every((expected) =>
    matchesExpectedPresentation(
      args.latest.get(
        sectionPresentationKey(expected.templateId, expected.sectionId),
      ),
      expected,
    ),
  );
}

export function isSectionPresentationPageReady(args: {
  page: readonly ExpectedSectionPresentation[];
  latest: ReadonlyMap<string, SectionPresentationToken>;
  acknowledged: ReadonlyMap<string, SectionPresentationToken>;
}): boolean {
  return (
    isSectionPresentationPagePresented(args) &&
    args.page.every((expected) => {
      const key = sectionPresentationKey(expected.templateId, expected.sectionId);
      const latest = args.latest.get(key);
      const acknowledged = args.acknowledged.get(key);
      return Boolean(
        latest &&
          acknowledged &&
          sameSectionPresentationToken(latest, acknowledged),
      );
    })
  );
}
