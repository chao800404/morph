import {
  fieldControlVariants,
  focusRing,
} from "@/components/ui/field-control";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";
import type { ReactNode } from "react";

/** The shape the asset fields carry: enough to draw a tile and submit an id. */
export interface SelectedAsset {
  id: string;
  name: string;
  url: string;
}

/**
 * One image in an asset grid.
 *
 * Shared by the library grid, the chosen-images grid and the product detail
 * gallery, so an image looks the same wherever it is shown — they differ only
 * in which control sits in the corner.
 */
export const AssetTile = ({
  asset,
  selected,
  onClick,
  onRemove,
  disabled,
  badge,
  dragging,
  sortable,
  ref,
}: {
  asset: SelectedAsset;
  selected?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  disabled?: boolean;
  /** Marker in the leading corner, e.g. "this is the thumbnail". */
  badge?: ReactNode;
  /** Set by the sortable wrapper while this tile is the drag source. */
  dragging?: boolean;
  /**
   * Makes the tile a keyboard-operable drag source.
   *
   * dnd-kit's keyboard plugin listens on the element, and the non-clickable
   * tile is a `div` — without this the gallery could only be reordered with a
   * pointer.
   */
  sortable?: boolean;
  ref?: (element: HTMLElement | null) => void;
}) => {
  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      ref={ref as never}
      {...(sortable
        ? {
            tabIndex: 0,
            role: "button" as const,
            "aria-roledescription": "Sortable image",
          }
        : {})}
      {...(onClick
        ? {
            type: "button" as const,
            onClick,
            disabled,
            "aria-pressed": Boolean(selected),
          }
        : {})}
      className={cn(
        fieldControlVariants({ variant: "tile" }),
        "group relative aspect-square overflow-hidden",
        "transition-[border-color,box-shadow]",
        focusRing,
        selected && "border-primary ring-[3px] ring-primary/30",
        dragging && "opacity-50",
      )}
      title={asset.name}
    >
      <img
        src={asset.url}
        alt={asset.name}
        loading="lazy"
        className="size-full object-cover"
      />
      {badge ? <span className="absolute left-2 top-2">{badge}</span> : null}
      {selected ? (
        <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
          <Check className="size-3" />
        </span>
      ) : null}
      {onRemove ? (
        // Nested inside a div, never inside the button above: the two wrappers
        // are mutually exclusive, so this never nests interactive elements.
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${asset.name}`}
          className="absolute right-2 top-2 rounded-full border bg-background/80 p-1 opacity-0 shadow-sm transition-opacity hover:bg-background focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </Wrapper>
  );
};
