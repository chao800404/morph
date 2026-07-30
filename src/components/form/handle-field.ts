import type { InputFormField } from "@/lib/validations/form";

/**
 * The handle input, shared by every resource that has one.
 *
 * A handle is a URL segment, so the field shows the `/` it will sit behind.
 * Products, collections and categories all render it, and each hand-written
 * copy was already drifting in placeholder wording — the affix, the hint and
 * the "(Optional)" marker belong to one definition.
 */
export const handleField = ({
  value,
  derivedFrom,
  error,
  colSpan,
}: {
  value?: string;
  /** The field the server falls back to when this is left blank. */
  derivedFrom: string;
  error?: string;
  colSpan?: number;
}): InputFormField => ({
  type: "input",
  name: "handle",
  label: "Handle",
  labelHint:
    "The part of the storefront URL that identifies this record. Changing it breaks links that already point here.",
  prefix: "/",
  optional: true,
  placeholder: `Derived from the ${derivedFrom}`,
  value,
  error,
  colSpan,
});
