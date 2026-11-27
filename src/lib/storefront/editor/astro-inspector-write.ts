import {
  sameSectionPresentationToken,
  type PreviewServedContent,
  type SectionPresentationToken,
} from "./preview-protocol";
import {
  acceptAstroBasisAck,
  type AstroContentBasis,
} from "./astro-basis-presentation";
import type { ConfirmedAstroDesignSelection } from "./astro-design-focus";

/**
 * The editor's half of an Astro Inspector write (M2 PR 3).
 *
 * An Astro page is server-rendered, so an input never shows as an overlay:
 * the presentation proof of the #399 gate (`commitSectionPending`) is the
 * section's acknowledged **basis** token (option B), and the write carries
 * the instance identity and component digest Core confirmed for it.
 *
 * Narrowing only. Nothing here grants a write: Core verifies the identity,
 * the component digest, the source-generation CAS and the draft-generation
 * CAS on every write again, and never reads the frame's stamp.
 */

/**
 * Whether an acknowledged basis token is still a write proof:
 *
 * - it is a basis token (an overlay token, every Start token, never is);
 * - the frame's stamp and Core's record still name its snapshot, instance
 *   and draft generation (`acceptAstroBasisAck`, the rule its `applied` was
 *   taken by): once Core wrote a newer snapshot for this editor, the page on
 *   screen is not the one an input would be made on;
 * - the editor holds no newer copy of the document than the page shows. Its
 *   own write, answered before the page reloads onto it, makes the token
 *   stale: the next input waits for the reloaded page's new ack.
 *
 * - it is still the section's latest token, and the frame's `applied` taken
 *   for the section is this very token (Codex review P1): a click again
 *   issues a newer token and drops the section's acknowledgement, and an
 *   input staged with the older one is then proven by nothing.
 *
 * `acceptedDraftGeneration` is the editor's accepted copy of the token's
 * document; undefined when it holds none. `latest` and `acknowledged` are
 * the section's latest token and the token its `applied` was taken for.
 */
export function astroBasisProofCurrent(args: {
  token: SectionPresentationToken;
  servedContent: PreviewServedContent | null;
  basis: AstroContentBasis | null;
  acceptedDraftGeneration: number | undefined;
  latest: SectionPresentationToken | undefined;
  acknowledged: SectionPresentationToken | undefined;
  /**
   * For a route placeholder's token: the route's document is known to exist
   * and was not created by this editor's own ensure.
   */
  routeDocumentCreatedElsewhere?: boolean;
}): boolean {
  if (!args.token.basis) return false;
  if (
    !args.latest ||
    !args.acknowledged ||
    !sameSectionPresentationToken(args.latest, args.token) ||
    !sameSectionPresentationToken(args.acknowledged, args.token)
  ) {
    return false;
  }
  const ack = acceptAstroBasisAck({
    token: args.token,
    servedContent: args.servedContent,
    basis: args.basis,
  });
  if (!ack.accept) return false;
  if (args.token.documentBasis.kind === "new-document") {
    // A static route with no Document of its own yet (Codex review P2):
    // proven only while the editor holds no copy of the route's document
    // and no other editor created it (`routeDocumentCreatedElsewhere`); the
    // write path then creates it through the route ensure and sends onto it
    // only as this editor created it.
    return (
      args.acceptedDraftGeneration === undefined &&
      args.routeDocumentCreatedElsewhere !== true
    );
  }
  return (
    args.acceptedDraftGeneration === undefined ||
    args.acceptedDraftGeneration <= args.token.documentBasis.draftGeneration
  );
}

/**
 * The identity fields an Astro write sends: the v2 id the proof's token
 * named and Core's component digest, exactly as Core confirmed them for the
 * selection the token was issued for (`issued`). Null, and nothing is sent,
 * when the token is not a basis token, no confirmed selection was recorded
 * for it, or the token, the selection and the write name different sections
 * or identities. Never read from the frame alone.
 */
export function astroWriteIdentityForProof(args: {
  token: SectionPresentationToken;
  issued: ConfirmedAstroDesignSelection | undefined;
  sectionId: string;
}): Readonly<{ identity: string; componentDigest: string }> | null {
  const basis = args.token.basis;
  const issued = args.issued;
  if (!basis || basis.kind !== "astro-boundary" || !issued) return null;
  if (
    issued.sectionId !== args.sectionId ||
    args.token.sectionId !== args.sectionId ||
    issued.identity !== basis.identity
  ) {
    return null;
  }
  return { identity: issued.identity, componentDigest: issued.componentDigest };
}

/** One content field the Astro Inspector lists for a confirmed section. */
export type AstroInspectorField = Readonly<{
  key: string;
  label: string;
  /** The input it gets; null when `codeOnly` says why there is none. */
  input: "text" | "textarea" | null;
  /**
   * Why the field has no input: the page's code decides its value here
   * (`controlled-by-code`: Core proves no CMS write for this call site), or
   * Design does not edit this type yet (`unsupported-type`). Null with an
   * input.
   */
  codeOnly: "controlled-by-code" | "unsupported-type" | null;
}>;

type FieldDeclaration = Readonly<
  Record<string, Readonly<{ type: string; label?: string }>>
>;

/**
 * The fields the Inspector lists for a confirmed Astro selection, in the
 * `.fields.ts` declaration's order. A field gets an input only when it is
 * declared there **and** proven by Core for this call site
 * (`selection.fields`, the declared fields the B1 claims pass from the
 * section), and, for a claim that holds only while the stored section has
 * the key (`selection.ownKeyFields`, a literal before the spread), only when
 * `storedProps` (the section's accepted props) has its own defined value:
 * Core refuses the write otherwise (`source-key-absent`).
 *
 * A declared field without that proof (a literal, a literal after the
 * spread, a value through author code, a value the page passes itself) is
 * listed as controlled by code, with no input: rule 02 section 5.3.1 asks
 * the Inspector to say so rather than hide it. A proven field the
 * declaration does not name gets nothing. Only plain text gets an input for
 * now; any other declared type is listed with none, for Code mode.
 */
export function astroInspectorFields(
  selection: ConfirmedAstroDesignSelection,
  declaration: FieldDeclaration | null | undefined,
  storedProps?: Readonly<Record<string, unknown>> | null,
): AstroInspectorField[] {
  if (!declaration) return [];
  const proven = new Set(selection.fields);
  const ownKey = new Set(selection.ownKeyFields);
  const fields: AstroInspectorField[] = [];
  for (const [key, definition] of Object.entries(declaration)) {
    const label = definition.label ?? key;
    const stored =
      !!storedProps &&
      Object.prototype.hasOwnProperty.call(storedProps, key) &&
      storedProps[key] !== undefined;
    if (!proven.has(key) || (ownKey.has(key) && !stored)) {
      fields.push({ key, label, input: null, codeOnly: "controlled-by-code" });
      continue;
    }
    const input =
      definition.type === "text" || definition.type === "textarea"
        ? definition.type
        : null;
    fields.push({
      key,
      label,
      input,
      codeOnly: input ? null : "unsupported-type",
    });
  }
  return fields;
}
