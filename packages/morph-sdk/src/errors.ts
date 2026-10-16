/**
 * Why a read failed. A closed set: a site can handle the cases it understands
 * and treat the rest alike.
 *
 * The first ten are the Starter's page codes, word for word, so a page read
 * through the SDK fails the way a page read through the Starter does. One of
 * them is declared but not produced in v0: `no_content_source`, because v0
 * always has a base URL.
 *
 * `invalid_content_origin` also covers `pages.get` called in a browser, where
 * v0 does not read pages at all; see `README.md`.
 */
export type MorphErrorCode =
  | "no_content_source"
  | "invalid_content_origin"
  | "invalid_path"
  | "store_unreachable"
  | "content_not_found"
  | "store_error"
  | "redirect_refused"
  | "invalid_response"
  | "response_too_large"
  | "reserved_slot"
  // Product reads only.
  | "invalid_request"
  | "invalid_store_context";

/** What was being read, or `null` for a configuration error. */
export type MorphErrorResource = "page" | "product" | null;

/**
 * The words for each code. Written here and never taken from a response, so
 * an error that a page renders carries no upstream body, address, query or
 * stack. The detail of a failure is the caller's to log.
 */
const MESSAGES: Record<MorphErrorCode, string> = {
  no_content_source: "No content source was configured.",
  invalid_content_origin: "The content source address is not usable.",
  invalid_path: "A page path starts with / and is at most 500 characters.",
  store_unreachable: "The content service could not be reached.",
  content_not_found: "This address has no published content to read.",
  store_error: "The content service reported an error.",
  redirect_refused: "The content service redirected, which is not followed.",
  invalid_response:
    "The content service sent a response that could not be used.",
  response_too_large: "The content service response was too large.",
  reserved_slot:
    "The content service sent a slot named _hidden, which is reserved.",
  invalid_request: "The request parameters are not supported.",
  invalid_store_context: "The store could not be determined for this request.",
};

export class MorphError extends Error {
  readonly code: MorphErrorCode;
  readonly resource: MorphErrorResource;
  /** The HTTP status when the service answered, otherwise `null`. */
  readonly status: number | null;

  constructor(
    code: MorphErrorCode,
    resource: MorphErrorResource,
    status: number | null = null,
  ) {
    super(MESSAGES[code]);
    this.name = "MorphError";
    this.code = code;
    this.resource = resource;
    this.status = status;
  }
}

export function isMorphError(value: unknown): value is MorphError {
  return value instanceof MorphError;
}
