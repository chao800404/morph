import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { storefrontPageDocumentSchema } from "@/lib/validations/storefront-page";
import {
  SHOW_AGAIN_DOCUMENT_INVALID,
  SHOW_AGAIN_VALUE_NOT_PRESERVED,
} from "../theme-write-errors";

type StoredSection = Readonly<Record<string, unknown>>;

/**
 * "Show again" (M3 stage 1): the one change it makes to a stored draft.
 *
 * Only `enabled: false` → `enabled: true` on the one section named, and
 * nothing else. The stored document is edited as stored, not as parsed:
 * parsing would fill defaults, trim strings, drop keys the schema does not
 * declare and give rows their in-memory ids (`normalizeDocumentRowIds`), and
 * every one of those would reach the draft as a change the author never
 * made. The section keeps its props, its ref, its name and its place; the
 * other sections are untouched.
 *
 * The draft is stored as JSON text and written back as JSON text, so the
 * write re-serialises the whole document. That may change whitespace, string
 * escapes (`é` → `é`) and how a number is spelled (`1.0` → `1`,
 * `1E2` → `100`); none of those is a value, and they are accepted. It must
 * never change a value, which JavaScript's numbers would do to an integer
 * beyond `Number.MAX_SAFE_INTEGER` (`9007199254740993` → `…992`), to `-0`
 * (→ `0`) or to a number too large for a double (→ `null`), and parsing
 * would do to a key stored twice (one is dropped). Any of those refuses the
 * write (`SHOW_AGAIN_VALUE_NOT_PRESERVED`) and nothing is written.
 *
 * The section is matched by its stored id exactly — never trimmed — so
 * `" hero "` names only the section stored as `" hero "`. A section that
 * only exists as a route's virtual slot was never stored, so it was never
 * hidden either: only stored sections are looked at.
 *
 * - `refused`: the stored draft is not a document every reader accepts
 *   (`SHOW_AGAIN_DOCUMENT_INVALID`, judged before anything else, so
 *   `enabled: null` is not read as shown), or its values would not survive
 *   the write (`SHOW_AGAIN_VALUE_NOT_PRESERVED`).
 * - `not-found`: no stored section has that id, or more than one does.
 * - `already-shown`: the section is stored and not hidden. Nothing to write.
 * - `shown`: the document to write, and the section as stored.
 */
export type ShowSectionAgainOutcome =
  | Readonly<{
      kind: "refused";
      code:
        | typeof SHOW_AGAIN_DOCUMENT_INVALID
        | typeof SHOW_AGAIN_VALUE_NOT_PRESERVED;
    }>
  | Readonly<{ kind: "not-found"; reason: "missing" | "ambiguous" }>
  | Readonly<{ kind: "already-shown" }>
  | Readonly<{
      kind: "shown";
      document: StorefrontPageDocument;
      section: StoredSection;
    }>;

export function showSectionAgainInDocument(
  stored: string,
  sectionId: string,
): ShowSectionAgainOutcome {
  let document: unknown;
  try {
    document = JSON.parse(stored);
  } catch {
    return { kind: "refused", code: SHOW_AGAIN_DOCUMENT_INVALID };
  }
  if (!storefrontPageDocumentSchema.safeParse(document).success) {
    return { kind: "refused", code: SHOW_AGAIN_DOCUMENT_INVALID };
  }
  if (!sameJsonValues(stored, JSON.stringify(document))) {
    return { kind: "refused", code: SHOW_AGAIN_VALUE_NOT_PRESERVED };
  }

  const sections = (document as { sections: StoredSection[] }).sections;
  const matches = sections.flatMap((section, index) =>
    section.id === sectionId ? [index] : [],
  );
  if (matches.length === 0) return { kind: "not-found", reason: "missing" };
  if (matches.length > 1) return { kind: "not-found", reason: "ambiguous" };
  const index = matches[0]!;
  const target = sections[index]!;
  if (target.enabled !== false) return { kind: "already-shown" };

  // A fresh copy of the parsed value, so nothing the caller holds changes;
  // the spread keeps the section's keys in their stored order.
  const next = structuredClone(document) as { sections: StoredSection[] };
  next.sections[index] = { ...next.sections[index], enabled: true };
  return {
    kind: "shown",
    document: next as unknown as StorefrontPageDocument,
    section: target,
  };
}

/**
 * The exact decimal value of a JSON number literal, spelled one way:
 * `1`, `1.0`, `10e-1` and `0.1e1` agree; `-0` and `0` do not, and neither do
 * two integers a double cannot tell apart.
 */
function canonicalNumber(literal: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(literal);
  if (!match) return `?${literal}`;
  const [, sign, whole, fraction = "", exponent = "0"] = match;
  let digits = `${whole}${fraction}`.replace(/^0+/, "");
  if (!digits) return `${sign}0`;
  let power = BigInt(exponent) - BigInt(fraction.length);
  while (digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    power += 1n;
  }
  return `${sign}${digits}e${power}`;
}

/** Sticky: matched at `lastIndex` without slicing the text. */
const LITERAL = /(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/y;

/**
 * The tokens of valid JSON text by value: whitespace dropped, strings
 * decoded, numbers by their exact decimal value.
 */
function tokens(text: string): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    const char = text[at]!;
    if (char === " " || char === "\n" || char === "\r" || char === "\t") {
      at += 1;
    } else if ("{}[]:,".includes(char)) {
      out.push(char);
      at += 1;
    } else if (char === '"') {
      let end = at + 1;
      while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      out.push(`s${JSON.parse(text.slice(at, end + 1)) as string}`);
      at = end + 1;
    } else {
      LITERAL.lastIndex = at;
      const literal = LITERAL.exec(text)?.[0];
      if (!literal) return [`?${at}`];
      out.push(
        /^[-\d]/.test(literal) ? `n${canonicalNumber(literal)}` : `l${literal}`,
      );
      at += literal.length;
    }
  }
  return out;
}

/** Whether two JSON texts hold the same values, token for token. */
function sameJsonValues(stored: string, reserialised: string): boolean {
  const before = tokens(stored);
  const after = tokens(reserialised);
  return (
    before.length === after.length &&
    before.every((token, index) => token === after[index])
  );
}
