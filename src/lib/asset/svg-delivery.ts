import { SVG_VALIDATOR_VERSION } from "@/lib/security/svg-validation";
import { SVG_ISOLATION_HEADERS } from "@/lib/storefront/theme-svg-isolation";

/**
 * How a media-library SVG is recorded when stored, and sent when served.
 *
 * An upload records the version of the rules it passed (`validateSvg`).
 * Only a file that passed the rules in force now may be shown inline when
 * opened directly; any other — one checked by the string rules before the
 * parser (`svgValidated: "true"`), one checked by an older version, one
 * never checked — is sent as a download until it is validated again. Every
 * SVG, whichever it is, carries the isolation headers: the verdict decides
 * what is stored, the headers what a browser may do with it, and neither
 * stands in for the other.
 */

/** The R2 custom-metadata key an upload records its validator version under. */
export const SVG_VALIDATOR_METADATA_KEY = "svgValidatorVersion";

export function svgValidationMetadata(
  validatorVersion: number,
): Record<string, string> {
  return { [SVG_VALIDATOR_METADATA_KEY]: String(validatorVersion) };
}

/** Whether a stored SVG passed the validator's current rules. */
export function passedCurrentSvgRules(
  customMetadata: Record<string, string> | null | undefined,
): boolean {
  return (
    customMetadata?.[SVG_VALIDATOR_METADATA_KEY] ===
    String(SVG_VALIDATOR_VERSION)
  );
}

/**
 * Gives a media-library SVG response its headers: always the isolation
 * headers, and `inline` only where the route allows it and the file passed
 * the current rules; otherwise `attachment`.
 */
export function applyLibrarySvgHeaders(
  headers: Headers,
  customMetadata: Record<string, string> | null | undefined,
  options: Readonly<{ inlineAllowed: boolean }>,
): void {
  for (const [name, value] of Object.entries(SVG_ISOLATION_HEADERS)) {
    headers.set(name, value);
  }
  headers.set(
    "content-disposition",
    options.inlineAllowed && passedCurrentSvgRules(customMetadata)
      ? "inline"
      : "attachment",
  );
}
