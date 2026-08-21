import { cn } from "@/lib/utils";
import { fieldControlVariants } from "@/components/ui/field-control";

/**
 * The canonical surface for Inspector field controls.
 *
 * Keep all editable Inspector fields on the same token-backed surface as the
 * shared Input primitive. Individual controls should only add layout and
 * density classes; they must not choose their own background or border.
 */
export const inspectorControlSurface = fieldControlVariants();

/**
 * A quieter surface for a trailing unit segment inside a field control.
 * It remains part of the same neutral palette and intentionally has no
 * SelectTrigger chevron; the unit is a compact adjacent control.
 */
export const inspectorControlSegmentSurface = cn(
  "bg-muted/40 text-muted-foreground",
  "hover:bg-muted/60",
  "focus-visible:outline-none focus-visible:ring-0",
);
