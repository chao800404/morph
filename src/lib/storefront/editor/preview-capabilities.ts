import type { PreviewCapability } from "./preview-protocol";

/**
 * What the built-in client-only preview route advertises on ready.
 *
 * `PREVIEW_CAPABILITIES` is the set of known tokens, not a grant: a page
 * advertises only what its own code handles. This page reads
 * `selection-field-section` only; the Theme bridge declares its own list.
 */
export const CLIENT_ONLY_PREVIEW_CAPABILITIES: readonly PreviewCapability[] = [
  "selection-field-section",
];
