import type {
  PreviewServedContent,
  SectionPresentationToken,
} from "./preview-protocol";

/**
 * The editor's half of the Astro basis acknowledgement (option B,
 * handoff/2026-11-24/astro-presentation-ack-options.md).
 *
 * An Astro page is server-rendered: an Inspector edit never shows as an
 * overlay, only as saved content after sync -> confirm -> reload. So the
 * frame acknowledges a **basis**, not an overlay: "this document holds the
 * selected boundary once, and was rendered from snapshot (ticket, instance)".
 * The editor issues such a token only when that pair is the one Core itself
 * wrote and confirmed, at Core's draft generation for the template in that
 * snapshot, and accepts the answer only while the pair still matches.
 *
 * The pair is narrowing evidence. The page runs author code and can forge
 * its stamp; nothing here grants a write. Core verifies every write again
 * (identity, component digest, source-generation CAS, draft-generation CAS)
 * and never reads the stamp. Start frames never reach this module: the path
 * is chosen by the frame's `astro-basis-ack-v1` capability together with a
 * reload content refresh, never by a framework name.
 */

/** What Core said about the latest snapshot this editor had it write. */
export type AstroContentBasis = Readonly<{
  ticket: number;
  /** The dev server instance that confirmed reading it; null until known. */
  instance: string | null;
  /** Core's draft generation of each template in that snapshot. */
  draftGenerations: Readonly<Record<string, number>>;
}>;

export type AstroContentBasisEvent =
  /** A start or a sync wrote the snapshot of `ticket` (Core's own answer). */
  | Readonly<{
      kind: "written";
      ticket: number;
      draftGenerations: Readonly<Record<string, number>>;
    }>
  /** Core confirmed that `instance` reads `ticket` or a later one. */
  | Readonly<{ kind: "confirmed"; ticket: number; instance: string }>;

/**
 * The record after one of Core's answers. It only moves forward: an older
 * ticket written is ignored, a newer one forgets the instance until Core
 * confirms it, and a confirmation counts only for the ticket recorded.
 */
export function noteAstroContentBasis(
  current: AstroContentBasis | null,
  event: AstroContentBasisEvent,
): AstroContentBasis | null {
  if (event.kind === "written") {
    if (current && current.ticket > event.ticket) return current;
    if (current && current.ticket === event.ticket) {
      return { ...current, draftGenerations: { ...event.draftGenerations } };
    }
    return {
      ticket: event.ticket,
      instance: null,
      draftGenerations: { ...event.draftGenerations },
    };
  }
  if (!current || current.ticket !== event.ticket) return current;
  return { ...current, instance: event.instance };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveTicket(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function draftGenerationsOf(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const generations: Record<string, number> = {};
  for (const [templateId, generation] of Object.entries(value)) {
    const valid = positiveTicket(generation);
    if (templateId.length > 0 && valid !== null) generations[templateId] = valid;
  }
  return generations;
}

function instanceOf(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,64}$/.test(value)
    ? value
    : null;
}

/**
 * The events in a server function's answer, read defensively: a field that
 * is missing or malformed contributes nothing, so an older Core (or a Start
 * answer) adds no record at all.
 *
 * - start: the snapshot it wrote (`contentTicket`, `draftGenerations`);
 * - sync, either outcome: the snapshot it wrote (`sentTicket`,
 *   `draftGenerations`), and on success the instance that confirmed it;
 * - confirm of `ticket`: the instance that confirmed it.
 */
export function astroContentBasisEvents(
  source: "start" | "sync" | "confirm",
  answer: unknown,
  askedTicket?: number,
): AstroContentBasisEvent[] {
  if (!isRecord(answer)) return [];
  const data =
    answer.success === true && isRecord(answer.data) ? answer.data : null;
  const events: AstroContentBasisEvent[] = [];
  if (source === "start") {
    const ticket = data ? positiveTicket(data.contentTicket) : null;
    const draftGenerations = data ? draftGenerationsOf(data.draftGenerations) : null;
    if (ticket !== null && draftGenerations) {
      events.push({ kind: "written", ticket, draftGenerations });
    }
    return events;
  }
  if (source === "sync") {
    const fields = data ?? answer;
    const ticket = positiveTicket(fields.sentTicket);
    const draftGenerations = draftGenerationsOf(fields.draftGenerations);
    if (ticket === null || !draftGenerations) return events;
    events.push({ kind: "written", ticket, draftGenerations });
    const instance = data ? instanceOf(data.instance) : null;
    if (instance) events.push({ kind: "confirmed", ticket, instance });
    return events;
  }
  const ticket = positiveTicket(askedTicket);
  const instance = data ? instanceOf(data.instance) : null;
  if (ticket !== null && instance) {
    events.push({ kind: "confirmed", ticket, instance });
  }
  return events;
}

/** Whether a frame takes the basis path: capability + reload refresh. */
export function isAstroBasisFrame(
  capabilities: ReadonlySet<string>,
  contentRefresh: string | null | undefined,
): boolean {
  return (
    contentRefresh === "reload" &&
    capabilities.has("section-presentation-ack-v1") &&
    capabilities.has("astro-identity-v2") &&
    capabilities.has("astro-basis-ack-v1")
  );
}

/** One ask about a page's stamp: its ticket and the instance it names. */
export function astroBasisConfirmKey(servedContent: PreviewServedContent): string {
  return `${servedContent.ticket}:${servedContent.instance}`;
}

/**
 * The ticket to ask Core about (`confirmThemePreviewContent`) when the frame
 * names Core's latest ticket and Core has not said that the instance the
 * frame names reads it: after a start, whose answer names no instance, or
 * after a dev server restart that kept the ticket and stamped a new
 * instance (the recorded one is then another). Null otherwise.
 *
 * Bounded: once per (ticket, page instance) — `asked` holds the keys
 * (`astroBasisConfirmKey`) already asked — so a page Core does not confirm
 * is left to the next sync, never asked about on every ready. Core's answer
 * replaces the instance for that ticket (`noteAstroContentBasis`); a
 * different answer leaves the page refused.
 */
export function astroBasisInstanceToConfirm(
  servedContent: PreviewServedContent | null,
  basis: AstroContentBasis | null,
  asked: ReadonlySet<string>,
): number | null {
  if (!servedContent || !basis) return null;
  if (servedContent.ticket !== basis.ticket) return null;
  if (basis.instance === servedContent.instance) return null;
  if (asked.has(astroBasisConfirmKey(servedContent))) return null;
  return basis.ticket;
}

export type AstroBasisRefusal =
  | "not-basis-frame"
  | "no-served-content"
  | "no-confirmed-content"
  | "other-ticket"
  | "unconfirmed-instance"
  | "other-instance"
  | "no-core-generation";

/** Checks shared by issuing a token and accepting its answer. */
function astroBasisMismatch(
  servedContent: PreviewServedContent,
  basis: AstroContentBasis | null,
  templateId: string,
): Readonly<{ reason: AstroBasisRefusal }> | Readonly<{ generation: number }> {
  if (!basis) return { reason: "no-confirmed-content" };
  // A document older (or newer) than what Core last wrote for this editor:
  // its generations are not the ones recorded, so it is never the basis.
  if (servedContent.ticket !== basis.ticket) return { reason: "other-ticket" };
  if (basis.instance === null) return { reason: "unconfirmed-instance" };
  if (servedContent.instance !== basis.instance) {
    return { reason: "other-instance" };
  }
  const generation = basis.draftGenerations[templateId];
  if (
    typeof generation !== "number" ||
    !Number.isSafeInteger(generation) ||
    generation < 1
  ) {
    return { reason: "no-core-generation" };
  }
  return { generation };
}

/**
 * The basis token for a confirmed Astro selection on the current frame, or
 * why there is none. `servedContent` is the frame's own stamp (its ready);
 * `basis` is Core's record. The token's `documentBasis` is Core's generation
 * for `templateId` in the confirmed snapshot; `overlayRevision` is 0.
 */
export function astroBasisTokenFor(args: {
  capabilities: ReadonlySet<string>;
  contentRefresh: string | null | undefined;
  servedContent: PreviewServedContent | null;
  basis: AstroContentBasis | null;
  workspaceKey: string;
  templateId: string;
  routePath: string;
  sectionId: string;
  identity: string;
  presentationRevision: number;
}):
  | Readonly<{ status: "token"; token: SectionPresentationToken }>
  | Readonly<{ status: "refused"; reason: AstroBasisRefusal }> {
  if (!isAstroBasisFrame(args.capabilities, args.contentRefresh)) {
    return { status: "refused", reason: "not-basis-frame" };
  }
  if (!args.servedContent) {
    return { status: "refused", reason: "no-served-content" };
  }
  const checked = astroBasisMismatch(
    args.servedContent,
    args.basis,
    args.templateId,
  );
  if ("reason" in checked) return { status: "refused", reason: checked.reason };
  return {
    status: "token",
    token: {
      workspaceKey: args.workspaceKey,
      templateId: args.templateId,
      routePath: args.routePath,
      sectionId: args.sectionId,
      documentBasis: { kind: "existing", draftGeneration: checked.generation },
      overlayRevision: 0,
      presentationRevision: args.presentationRevision,
      operationId: `section-basis-${args.presentationRevision}`,
      basis: {
        kind: "astro-boundary",
        identity: args.identity,
        servedContent: {
          ticket: args.servedContent.ticket,
          instance: args.servedContent.instance,
        },
      },
    },
  };
}

/**
 * Whether an `applied` answer to a basis token may be taken: the frame's
 * stamp is still the token's, and Core's record still names that ticket,
 * that instance and the token's generation. Asked only about basis tokens;
 * every guard of the ordinary ack intake runs as well.
 */
export function acceptAstroBasisAck(args: {
  token: SectionPresentationToken;
  servedContent: PreviewServedContent | null;
  basis: AstroContentBasis | null;
}):
  | Readonly<{ accept: true }>
  | Readonly<{
      accept: false;
      reason: AstroBasisRefusal | "not-a-basis-token" | "other-snapshot";
    }> {
  const tokenBasis = args.token.basis;
  if (!tokenBasis) return { accept: false, reason: "not-a-basis-token" };
  if (!args.servedContent) {
    return { accept: false, reason: "no-served-content" };
  }
  if (
    args.servedContent.ticket !== tokenBasis.servedContent.ticket ||
    args.servedContent.instance !== tokenBasis.servedContent.instance
  ) {
    return { accept: false, reason: "other-snapshot" };
  }
  const checked = astroBasisMismatch(
    tokenBasis.servedContent,
    args.basis,
    args.token.templateId,
  );
  if ("reason" in checked) return { accept: false, reason: checked.reason };
  if (
    args.token.documentBasis.kind !== "existing" ||
    args.token.documentBasis.draftGeneration !== checked.generation
  ) {
    return { accept: false, reason: "no-core-generation" };
  }
  return { accept: true };
}

/**
 * What the author is told when a confirmed Astro selection cannot be
 * presented as its basis (class A of plan v2 §6.2: temporarily
 * unconfirmable; the action is to reload the preview).
 */
export const ASTRO_BASIS_UNCONFIRMED_MESSAGE =
  "The preview is not showing the latest saved content yet. Reload the preview to edit this section.";
