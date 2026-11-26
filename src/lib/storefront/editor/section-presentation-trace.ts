import type { SectionPresentationToken } from "./preview-protocol";

/**
 * Console lines that follow one section presentation through its life:
 * the editor posts it, the frame queues and answers it, the editor accepts or
 * rejects the answer. Every line names the token's `operationId`, so one grep
 * for it reads the whole path, and a missing step says which side stopped:
 *
 * - no `posted` line: the request was never sent (or sent without a token,
 *   which its own line says, with why);
 * - `posted` but no frame `answered` line: the bridge never answered;
 * - `answered` but `ack rejected`: the editor refused the answer, and the
 *   line names the guard that refused it.
 *
 * What a line may carry is fixed here, so nothing else can reach the console
 * through it: identities only (operation, section, template, route pattern,
 * draft generation, overlay revision, ready round, a per-tab frame ordinal,
 * the first 8 hex of the frame document id). Never section props, field
 * values or draft text, never the preview URL (it can carry an access token)
 * and never the preview session nonce. The operation id is a per-tab counter
 * (`section-presentation-N`): it names a request and proves nothing, since an
 * answer is only taken from the verified frame, session and document.
 *
 * Routine lines (posted, accepted, the frame's expected answers) and
 * anomalies (rejections, posts without a token, stalls) each have a budget
 * per frame round and 10 s window, so typing cannot flood the log; the first
 * line past a budget says the rest are suppressed.
 */
export const SECTION_PRESENTATION_TRACE_PREFIX = "[preview-presentation]";

/**
 * Lines of each kind one frame round may log in one window before the rest
 * of that window are dropped; the window and a new round start it over.
 */
export const SECTION_PRESENTATION_TRACE_BUDGET = 64;
export const SECTION_PRESENTATION_TRACE_WINDOW_MS = 10_000;

export type SectionPresentationTraceScope = Readonly<{
  /** A per-tab ordinal for the frame (`f1`, `f2`, ...), never its URL. */
  frame: string | null;
  readyRound: number | null;
  /** The frame document id as the frame named it; shortened when logged. */
  documentId: string | null;
}>;

/** Why a frame's presentation answer was not taken, in the order checked. */
export type SectionPresentationAckRejection =
  | "no-frame-record"
  | "no-pending"
  | "other-frame"
  | "other-round"
  | "no-ack-capability"
  | "no-document-id"
  | "pending-other-frame"
  | "pending-other-round"
  | "pending-other-document"
  | "unverified-document"
  | "token-mismatch"
  | "not-latest"
  /**
   * Astro basis ack (option B): the frame's stamp or Core's confirmation no
   * longer matches the basis token (`acceptAstroBasisAck`). Checked last.
   */
  | "basis-unconfirmed";

/** The first 8 hex of a frame document id; the id itself is not a secret. */
export function shortPresentationDocumentId(
  documentId: string | null | undefined,
): string {
  if (typeof documentId !== "string" || documentId.length === 0) return "none";
  return /^[0-9a-f]+$/.test(documentId) ? documentId.slice(0, 8) : "invalid";
}

/** `existing:N` or `new-document`; a new document's epoch is not logged. */
export function presentationBasisLabel(
  basis: SectionPresentationToken["documentBasis"] | null | undefined,
): string {
  if (!basis) return "none";
  return basis.kind === "existing"
    ? `existing:${basis.draftGeneration}`
    : "new-document";
}

export function scopeFields(scope: SectionPresentationTraceScope): string {
  return [
    `round=${scope.readyRound ?? "none"}`,
    `frame=${scope.frame ?? "none"}`,
    `doc=${shortPresentationDocumentId(scope.documentId)}`,
  ].join(" ");
}

function tokenFields(token: SectionPresentationToken): string {
  return [
    `op=${token.operationId}`,
    `section=${token.sectionId}`,
    `template=${token.templateId}`,
    `route=${token.routePath}`,
    `basis=${presentationBasisLabel(token.documentBasis)}`,
    `overlay=${token.overlayRevision}`,
  ].join(" ");
}

type Line = Readonly<{ kind: "routine" | "anomaly"; text: string }>;

export type SectionPresentationTraceEvent =
  | Readonly<{
      type: "round-started";
      scope: SectionPresentationTraceScope;
      acknowledges: boolean;
    }>
  | Readonly<{
      type: "posted";
      scope: SectionPresentationTraceScope;
      token: SectionPresentationToken;
      /** Part of a replay of every bound section (`replay`) or one edit. */
      via: "replay" | "edit" | "resend";
    }>
  | Readonly<{
      type: "posted-without-token";
      scope: SectionPresentationTraceScope;
      sectionId: string;
      reason:
        | "frame-record-stale"
        | "no-document-id"
        | "no-template"
        | "no-document-basis";
    }>
  | Readonly<{
      type: "not-sent";
      scope: SectionPresentationTraceScope;
      sectionId: string;
      reason: "held-for-inline-edit" | "frame-on-another-route";
    }>
  | Readonly<{
      type: "replay";
      scope: SectionPresentationTraceScope;
      sections: number;
      mode: "initial" | "unacked" | "resend";
    }>
  | Readonly<{
      type: "replay-skipped";
      scope: SectionPresentationTraceScope;
      reason:
        | "no-frame-record"
        | "not-round-one"
        | "other-frame"
        | "frame-not-on-editor-page";
    }>
  | Readonly<{
      type: "ack-accepted";
      scope: SectionPresentationTraceScope;
      token: SectionPresentationToken;
      status: "applied" | "not-applied";
      reason?: string;
      pageReady: boolean;
      unconfirmed: number;
    }>
  | Readonly<{
      type: "ack-rejected";
      scope: SectionPresentationTraceScope;
      token: SectionPresentationToken;
      status: "applied" | "not-applied";
      reason?: string;
      guard: SectionPresentationAckRejection;
    }>
  | Readonly<{
      type: "ack-withdrawn";
      scope: SectionPresentationTraceScope;
      token: SectionPresentationToken;
    }>;

/**
 * The line for an event, and whether it is routine or an anomaly. Pure: the
 * caller decides whether it is logged (`createSectionPresentationTrace`).
 */
export function formatSectionPresentationTrace(
  event: SectionPresentationTraceEvent,
): Line {
  const p = SECTION_PRESENTATION_TRACE_PREFIX;
  switch (event.type) {
    case "round-started":
      return {
        kind: "routine",
        text: `${p} round started ${scopeFields(event.scope)} acknowledges=${event.acknowledges ? "yes" : "no"}`,
      };
    case "posted":
      return {
        kind: "routine",
        text: `${p} posted ${tokenFields(event.token)} via=${event.via} ${scopeFields(event.scope)}`,
      };
    case "posted-without-token":
      return {
        kind: "anomaly",
        text: `${p} posted without token section=${event.sectionId} reason=${event.reason} ${scopeFields(event.scope)}`,
      };
    case "not-sent":
      return {
        kind: "routine",
        text: `${p} not sent section=${event.sectionId} reason=${event.reason} ${scopeFields(event.scope)}`,
      };
    case "replay":
      return {
        kind: "routine",
        text: `${p} replay mode=${event.mode} sections=${event.sections} ${scopeFields(event.scope)}`,
      };
    case "replay-skipped":
      return {
        kind: "anomaly",
        text: `${p} replay skipped reason=${event.reason} ${scopeFields(event.scope)}`,
      };
    case "ack-accepted":
      return {
        kind: event.status === "applied" ? "routine" : "anomaly",
        text:
          `${p} ack accepted ${tokenFields(event.token)} status=${event.status}` +
          (event.reason ? ` reason=${event.reason}` : "") +
          ` ${scopeFields(event.scope)} page=${event.pageReady ? "confirmed" : "waiting"} unconfirmed=${event.unconfirmed}`,
      };
    case "ack-rejected":
      return {
        // An answer for a token the editor already replaced is expected
        // while typing; anything else refused is what a stall looks like.
        kind:
          event.guard === "no-pending" && event.reason === "superseded"
            ? "routine"
            : "anomaly",
        text:
          `${p} ack rejected ${tokenFields(event.token)} status=${event.status}` +
          (event.reason ? ` reason=${event.reason}` : "") +
          ` guard=${event.guard} ${scopeFields(event.scope)}`,
      };
    case "ack-withdrawn":
      return {
        kind: "anomaly",
        text: `${p} ack withdrawn ${tokenFields(event.token)} ${scopeFields(event.scope)}`,
      };
  }
}

export type SectionPresentationTrace = Readonly<{
  /** Logs an event within its kind's budget for the scope's round. */
  record: (event: SectionPresentationTraceEvent) => void;
  /** Logs a pre-formatted line as an anomaly (a stall, a resend). */
  anomaly: (scope: SectionPresentationTraceScope, text: string) => void;
}>;

/**
 * A bounded logger for one editor tab. Budgets are per frame round (frame
 * ordinal + ready round + document) and window: either starts them over.
 */
export function createSectionPresentationTrace(
  log: (line: string) => void = (line) => console.info(line),
  budget = SECTION_PRESENTATION_TRACE_BUDGET,
  now: () => number = () => Date.now(),
): SectionPresentationTrace {
  let roundKey: string | null = null;
  let windowStart = 0;
  const spent = { routine: 0, anomaly: 0 };
  const suppressed = { routine: false, anomaly: false };
  const emit = (
    scope: SectionPresentationTraceScope,
    kind: "routine" | "anomaly",
    text: string,
  ) => {
    const key = `${scope.frame}|${scope.readyRound}|${scope.documentId}`;
    const at = now();
    if (
      key !== roundKey ||
      at - windowStart >= SECTION_PRESENTATION_TRACE_WINDOW_MS
    ) {
      roundKey = key;
      windowStart = at;
      spent.routine = 0;
      spent.anomaly = 0;
      suppressed.routine = false;
      suppressed.anomaly = false;
    }
    if (spent[kind] >= budget) {
      if (!suppressed[kind]) {
        suppressed[kind] = true;
        log(
          `${SECTION_PRESENTATION_TRACE_PREFIX} ${kind} lines suppressed after ${budget} ${scopeFields(scope)}`,
        );
      }
      return;
    }
    spent[kind] += 1;
    log(text);
  };
  return {
    record: (event) => {
      const line = formatSectionPresentationTrace(event);
      emit(event.scope, line.kind, line.text);
    },
    anomaly: (scope, text) =>
      emit(scope, "anomaly", `${SECTION_PRESENTATION_TRACE_PREFIX} ${text} ${scopeFields(scope)}`),
  };
}

/**
 * `[preview-frame]` lines: one frame load followed from the editor's side,
 * beside the bridge's own `[preview-frame] frame ...` lines (bridge start,
 * hydration, ready, structure). Ready received and taken or not, structure
 * taken or set aside and why, and whether the section tree can be used.
 *
 * Same rules as the presentation trace: identities and counts only, never
 * node labels, content, the preview URL or the session. Bounded twice: a
 * line keyed by what it describes is said only when its summary changes
 * (a structure report repeats on every DOM commit), and at most `budget`
 * lines per 10 s window, the first one past that saying so.
 */
export const PREVIEW_FRAME_TRACE_PREFIX = "[preview-frame]";

export type PreviewFrameTrace = Readonly<{
  /** Says `text`, within the window's budget. */
  say: (text: string) => void;
  /** Says `text` only when `summary` differs from the last one for `key`. */
  changed: (key: string, summary: string, text: string) => void;
}>;

export function createPreviewFrameTrace(
  log: (line: string) => void = (line) => console.info(line),
  budget = SECTION_PRESENTATION_TRACE_BUDGET,
  now: () => number = () => Date.now(),
): PreviewFrameTrace {
  const last = new Map<string, string>();
  let windowStart = Number.NEGATIVE_INFINITY;
  let spent = 0;
  let suppressed = false;
  const say = (text: string) => {
    const at = now();
    if (at - windowStart >= SECTION_PRESENTATION_TRACE_WINDOW_MS) {
      windowStart = at;
      spent = 0;
      suppressed = false;
    }
    if (spent >= budget) {
      if (!suppressed) {
        suppressed = true;
        log(`${PREVIEW_FRAME_TRACE_PREFIX} lines suppressed after ${budget} in 10 s`);
      }
      return;
    }
    spent += 1;
    log(`${PREVIEW_FRAME_TRACE_PREFIX} ${text}`);
  };
  return {
    say,
    changed: (key, summary, text) => {
      if (last.get(key) === summary) return;
      last.set(key, summary);
      while (last.size > 64) {
        const oldest = last.keys().next().value;
        if (oldest === undefined) break;
        last.delete(oldest);
      }
      say(text);
    },
  };
}

/** `sections=N nodes=M` for a structure report's nodes; never their labels. */
export function previewStructureCounts(
  nodes: ReadonlyArray<{ sectionId?: unknown }> | undefined,
): string {
  const list = Array.isArray(nodes) ? nodes : [];
  return `sections=${new Set(list.map((node) => node?.sectionId)).size} nodes=${list.length}`;
}
