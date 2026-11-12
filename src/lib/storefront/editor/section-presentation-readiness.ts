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

/**
 * Whether the presentation a proof acknowledged shows the copy a write says
 * it was made on (Task 40 item 4). `bases` are the copies the write's
 * fields were first made on (`basisDraftGeneration`); the newest decides.
 *
 * - A presentation older than that basis showed the author something other
 *   than what the write claims: refused, as a write with no basis is.
 * - A presentation newer than the basis is left to the composition rule
 *   (`selectCurrentContentFields`: only this session's own steps may lie
 *   between), which refuses it as out of date otherwise.
 * - No recorded basis is left to the stage-1 refusal.
 * - A presentation of a route before its document existed (`new-document`)
 *   shows only input made with no basis.
 */
export function presentationShowsWriteBasis(
  documentBasis: SectionPresentationToken["documentBasis"],
  bases: readonly (number | undefined)[],
): boolean {
  const known = bases.filter(
    (basis): basis is number => typeof basis === "number",
  );
  if (documentBasis.kind === "new-document") return known.length === 0;
  if (known.length === 0) return true;
  return Math.max(...known) <= documentBasis.draftGeneration;
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
