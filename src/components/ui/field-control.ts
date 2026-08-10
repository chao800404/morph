import { cva } from "class-variance-authority";

/**
 * Shared visual surface for every editable field control.
 *
 * Structural concerns such as height, padding, and layout stay in each
 * primitive. Background, border, radius, elevation, and interaction states
 * live here so Input remains the visual baseline without duplicating its class
 * list across Select, Dropzone, and future field types.
 */
/**
 * The dashboard's focus ring.
 *
 * Split out because selectable surfaces that are not field controls — an image
 * tile, a folder row inside a picker — need the same ring without the rest of
 * a field's box model. Two definitions of it drift on the first change to the
 * ring width.
 */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]";

/**
 * Form-field density rules.
 *
 * Density follows information structure, never the feature that owns a field:
 * - `control`: one-line inputs, selects and buttons.
 * - `compact`: a two-line summary or disclosure trigger.
 * - `default`: a descriptive card containing a control, title and supporting
 *   copy.
 *
 * Content-sized controls — textarea, dropzone, asset grid and wrapping token
 * picker — deliberately keep their intrinsic height. They still use
 * `fieldControlVariants` for the shared surface, but forcing one of these
 * vertical metrics on them would clip content or create unexplained whitespace.
 */
export const fieldControlDensity = {
  control: "h-9 px-3 py-1.5",
  compact: "min-h-14 px-3 py-2",
  default: "p-4",
} as const;

export const fieldControlVariants = cva(
  [
    "rounded-md-plus border border-input bg-background text-foreground shadow-xs",
    "transition-[color,box-shadow] outline-none placeholder:text-muted-foreground",
    focusRing,
    "focus-visible:border-ring",
    "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
    "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
    "data-[disabled=true]:pointer-events-none data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50",
    "dark:bg-input/30",
  ],
  {
    variants: {
      variant: {
        default: "",
        /**
         * An image tile: a surface that sits on a card rather than a control
         * you type into, so it keeps the shared radius and focus behaviour but
         * carries its own edge and drop shadow. The two colours come from
         * `--tile-border` / `--tile-shadow` so a re-theme reaches them.
         */
        tile: [
          "border-tile-border bg-background shadow-sm shadow-tile-shadow",
          "dark:bg-background",
        ],
        card: [
          "border-border bg-zinc-100 text-foreground shadow-sm shadow-zinc-300",
          "inset-shadow-xs inset-shadow-white placeholder:text-zinc-400",
          "hover:bg-zinc-300/40",
          "dark:border-border dark:border-b-0 dark:bg-zinc-700/30",
          "dark:placeholder:text-zinc-500 dark:shadow-sm dark:shadow-zinc-900",
          "dark:inset-shadow-none dark:inset-ring dark:inset-ring-zinc-600/20",
          "dark:hover:bg-zinc-700/40",
        ],
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);
