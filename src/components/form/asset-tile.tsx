import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";

/** The shape the asset fields carry: enough to draw a tile and submit an id. */
export interface SelectedAsset {
  id: string;
  name: string;
  url: string;
}

/**
 * One image in an asset grid.
 *
 * Shared by the library grid and the chosen-images grid so a picked image looks
 * the same before and after it is picked — they differ only in which control
 * sits in the corner.
 */
export const AssetTile = ({
  asset,
  selected,
  onClick,
  onRemove,
  disabled,
}: {
  asset: SelectedAsset;
  selected?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  disabled?: boolean;
}) => {
  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      {...(onClick
        ? {
            type: "button" as const,
            onClick,
            disabled,
            "aria-pressed": Boolean(selected),
          }
        : {})}
      className={cn(
        "group relative aspect-square overflow-hidden rounded-md-plus border bg-background",
        "transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected && "border-primary ring-[3px] ring-primary/30",
        disabled && !selected && "cursor-not-allowed opacity-40",
      )}
      title={asset.name}
    >
      <img
        src={asset.url}
        alt={asset.name}
        loading="lazy"
        className="size-full object-cover"
      />
      {selected ? (
        <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
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
          className="absolute right-1 top-1 rounded-full border bg-background/80 p-1 opacity-0 shadow-sm transition-opacity hover:bg-background focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </Wrapper>
  );
};
