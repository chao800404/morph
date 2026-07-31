import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * The tile grid every asset surface lays out.
 *
 * Only the track sizing and the gap live here, because that is the part that
 * has to match: the product gallery, the chosen-images strip and the library
 * picker each render a different control on the tile, but three hand-written
 * `grid-cols-*` rules is how they end up with three different image sizes on
 * the same screen. Tiles themselves stay `AssetTile`.
 *
 * `auto-fill` rather than a column count: the same grid sits in a `max-w-3xl`
 * card and in a narrow picker panel, and a fixed count makes the tiles huge in
 * one and cramped in the other.
 */
export const AssetGrid = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3",
      className,
    )}
  >
    {children}
  </div>
);
