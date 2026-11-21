/**
 * Codes a theme content write can come back with.
 *
 * The DAL raises one inside its error message, the server function turns the
 * one it recognises into a structured `error`, and the editor decides what to
 * offer the author from that. Defined once because a code that drifts from the
 * one being matched degrades silently: the server stops recognising its own
 * conflict and the editor is handed a plain "save failed" with no way to tell
 * that the author's edit is still valid against a document that has moved.
 */
export const TEMPLATE_DRAFT_CONFLICT = "TEMPLATE_DRAFT_CONFLICT";

/**
 * What the document write raises when the draft generation it was given is
 * no longer the document's. A server function that writes a document turns it
 * into `TEMPLATE_DRAFT_CONFLICT`.
 */
export const TEMPLATE_DRAFT_GENERATION_MISMATCH =
  "CONFLICT_DRAFT_GENERATION_MISMATCH";

/**
 * A content write the saved source cannot vouch for.
 *
 * The section's route (or layout) decides its structure through `content(...)`,
 * yet the source does not confirm this section renders there — the route has
 * diagnostics, does not declare the slot, or is not the route the editor named.
 * Refused rather than checked against the component the Document last stored:
 * that ref describes what rendered then, not what renders now.
 */
export const SECTION_SOURCE_UNCONFIRMED = "SECTION_SOURCE_UNCONFIRMED";

/**
 * A hide the saved source cannot carry out (M3 Hide).
 *
 * The section would stay visible, show its component's defaults, or crash the
 * page while hidden, because something reads its content where Morph cannot
 * omit it. Refused before anything is written; showing a section is never
 * refused with it. See `theme-hide-capability.ts`. Raised as
 * `SECTION_HIDE_UNSUPPORTED: reason-code: text` and read back, with the
 * other section-source refusals, by `parseSectionSourceRefusal`.
 */
export const SECTION_HIDE_UNSUPPORTED = "SECTION_HIDE_UNSUPPORTED";

/** The source used for a visual selection is no longer the saved source. */
export const SELECTION_SOURCE_CONFLICT = "SELECTION_SOURCE_CONFLICT";
export const SELECTION_SOURCE_CONFLICT_MESSAGE =
  "The source code has changed. Select the field again. Your changes are kept.";

/**
 * A Design write the Theme's recorded framework does not take
 * (`designWritesUnavailableReason`): the DAL raises it as
 * `THEME_FRAMEWORK_UNAVAILABLE: reason`, and a server function answers it
 * with the reason. The code page creation already answers with.
 */
export const THEME_FRAMEWORK_UNAVAILABLE = "THEME_FRAMEWORK_UNAVAILABLE";

/**
 * A content write the source cannot be confirmed for *right now* (M2 C7):
 * the `.astro` parser could not be asked or did not answer in its contract,
 * or the preview's instance identity or component version is not the saved
 * source's. The source is not at fault; retrying, or reloading the preview,
 * may succeed. Never retried by itself: the author saves again.
 *
 * `SECTION_SOURCE_UNCONFIRMED` stays for what retrying cannot change: a
 * capability limit, an author syntax error, or a source that decides the
 * content in code.
 */
export const SECTION_SOURCE_UNCONFIRMABLE = "SECTION_SOURCE_UNCONFIRMABLE";

/** A reason code: kebab-case, as the plan's §6 codes are. */
const SECTION_SOURCE_REASON = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*): ([\s\S]*)$/;

/**
 * Reads a section-source refusal out of a write error's message, the only
 * part of an error that survives the RPC hop. The DAL writes
 * `CODE: reason-code: text`, or, as Start's refusals always have,
 * `CODE: text`; `reason` is null for the latter. Null when the message is
 * no section-source refusal.
 */
export function parseSectionSourceRefusal(message: string): Readonly<{
  code:
    | typeof SECTION_HIDE_UNSUPPORTED
    | typeof SECTION_SOURCE_UNCONFIRMABLE
    | typeof SECTION_SOURCE_UNCONFIRMED;
  reason: string | null;
  text: string;
}> | null {
  for (const code of [
    SECTION_HIDE_UNSUPPORTED,
    SECTION_SOURCE_UNCONFIRMABLE,
    SECTION_SOURCE_UNCONFIRMED,
  ] as const) {
    const at = message.indexOf(`${code}: `);
    if (at < 0) continue;
    const rest = message.slice(at + code.length + 2);
    const coded = SECTION_SOURCE_REASON.exec(rest);
    return coded
      ? { code, reason: coded[1]!, text: coded[2]! }
      : { code, reason: null, text: rest };
  }
  return null;
}

/**
 * The message a DAL throws for a section-source refusal with a reason code:
 * temporarily unconfirmable refusals as `SECTION_SOURCE_UNCONFIRMABLE`,
 * every other class as `SECTION_SOURCE_UNCONFIRMED`.
 */
export function sectionSourceRefusalMessage(
  temporarily: boolean,
  reason: string,
  text: string,
): string {
  return `${temporarily ? SECTION_SOURCE_UNCONFIRMABLE : SECTION_SOURCE_UNCONFIRMED}: ${reason}: ${text}`;
}
