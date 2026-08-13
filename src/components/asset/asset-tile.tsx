import { fieldControlVariants, focusRing } from "@/components/ui/field-control";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";
import type { ReactNode } from "react";

/** The shape the asset fields carry: enough to draw a tile and submit an id. */
export interface SelectedAsset {
  id: string;
  name: string;
  url: string;
}

const assetTileCornerControlClassName =
  "absolute right-2 top-2 flex size-6 items-center justify-center rounded-md border bg-background/85 shadow-sm backdrop-blur-sm";

const AssetTileCornerControl = ({
  variant,
  label,
  onClick,
}: {
  variant: "selected" | "remove";
  label?: string;
  onClick?: () => void;
}) => {
  const icon =
    variant === "selected" ? (
      <Check className="size-3.5" strokeWidth={3} />
    ) : (
      <X className="size-3.5" strokeWidth={2.5} />
    );
  const className = cn(
    assetTileCornerControlClassName,
    variant === "selected"
      ? "text-emerald-500 dark:text-emerald-400"
      : "text-destructive opacity-0 transition-[color,opacity] hover:bg-background hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100",
  );

  if (variant === "remove") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={className}
      >
        {icon}
      </button>
    );
  }

  return (
    <span aria-hidden="true" className={className}>
      {icon}
    </span>
  );
};

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
        selected && "border-primary/50 ring-[1.5px] ring-inset ring-primary/50",
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
      {selected ? <AssetTileCornerControl variant="selected" /> : null}
      {onRemove ? (
        // Nested inside a div, never inside the button above: the two wrappers
        // are mutually exclusive, so this never nests interactive elements.
        <AssetTileCornerControl
          variant="remove"
          onClick={onRemove}
          label={`Remove ${asset.name}`}
        />
      ) : null}
    </Wrapper>
  );
};
