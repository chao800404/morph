import type { FormField } from "@/lib/validations/form";

/**
 * The metadata editor as a field list.
 *
 * Shared by every resource that exposes metadata, so the label, hint and
 * transport shape cannot drift between them. The warning is part of the field
 * because metadata is readable by a storefront.
 */
export const metadataFields = (
  metadata: Record<string, unknown>,
): FormField[] => [
  {
    type: "metadata",
    name: "metadata",
    label: "Metadata",
    description:
      "Store-defined data the catalogue does not model. Readable by your storefront, so never put secrets here.",
    value: JSON.stringify(metadata ?? {}),
    colSpan: 2,
  },
];
