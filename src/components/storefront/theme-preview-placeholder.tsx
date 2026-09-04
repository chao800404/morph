/**
 * Stands in for a release that has no captured picture.
 *
 * Drawn rather than photographed on purpose. The photograph it replaces showed
 * a styled ceramics shop that was never the user's, captioned with copy that
 * was never theirs — at a glance it read as "this is your storefront", and it
 * was wrong every time. A flat wireframe cannot be mistaken for a capture, so
 * it says "nothing here yet" without having to be labelled.
 *
 * `currentColor` throughout, so it inherits the surrounding text colour and
 * needs no separate treatment in light and dark.
 */

const shell = "text-foreground/70";

/**
 * The frame-and-mountain glyph every tool uses to mean "an image goes here".
 *
 * Traced from Lucide's `image` (ISC), which this project already depends on,
 * rather than imported: the icon component renders its own `<svg>` root with a
 * fixed size, and this needs to sit inside a parent `<svg>`'s coordinate space.
 * An invented shape was tried first and read as a blob — this is a convention
 * people already know, which is the whole job of a placeholder.
 */
function ImageGlyph({ x, y, size }: { x: number; y: number; size: number }) {
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.35"
      >
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </g>
    </svg>
  );
}

export function ThemePreviewPlaceholderDesktop({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 800 350"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="No preview captured yet"
      className={`${shell} ${className ?? ""}`}
      fill="currentColor"
    >
      {/* Hero: copy on the left, product image on the right. */}
      <rect x="48" y="60" width="86" height="7" rx="3.5" opacity="0.3" />
      <rect x="48" y="86" width="268" height="19" rx="6" opacity="0.16" />
      <rect x="48" y="115" width="204" height="19" rx="6" opacity="0.16" />
      <rect x="48" y="156" width="104" height="24" rx="12" opacity="0.22" />

      <rect x="404" y="46" width="348" height="150" rx="10" opacity="0.07" />
      <ImageGlyph x={550} y={93} size={56} />

      {/* Product row, the part of a storefront that says "shop". */}
      {[48, 236, 424, 612].map((x) => (
        <g key={x}>
          <rect x={x} y="230" width="140" height="72" rx="8" opacity="0.09" />
          <ImageGlyph x={x + 55} y={251} size={30} />
          <rect x={x} y="312" width="92" height="7" rx="3.5" opacity="0.2" />
          <rect x={x} y="326" width="52" height="7" rx="3.5" opacity="0.12" />
        </g>
      ))}
    </svg>
  );
}

export function ThemePreviewPlaceholderMobile({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 320 400"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="No preview captured yet"
      className={`${shell} ${className ?? ""}`}
      fill="currentColor"
    >
      <rect x="24" y="26" width="272" height="132" rx="10" opacity="0.07" />
      <ImageGlyph x={138} y={70} size={44} />

      <rect x="24" y="178" width="150" height="13" rx="5" opacity="0.16" />
      <rect x="24" y="199" width="104" height="13" rx="5" opacity="0.16" />

      {/* Two-up grid: the shape a storefront takes on a phone. */}
      {[
        [24, 240],
        [172, 240],
        [24, 330],
        [172, 330],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width="124" height="60" rx="8" opacity="0.09" />
          <ImageGlyph x={x + 49} y={y + 15} size={26} />
          <rect x={x} y={y + 68} width="80" height="6" rx="3" opacity="0.2" />
        </g>
      ))}
    </svg>
  );
}
