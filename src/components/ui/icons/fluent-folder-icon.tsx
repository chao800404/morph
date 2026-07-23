import { cn } from "@/lib/utils";

interface FluentFolderIconProps {
  className?: string;
  variant?: "default" | "media" | "code" | "document";
}

export function FluentFolderIcon({
  className,
  variant = "default",
}: FluentFolderIconProps) {
  if (variant === "media") {
    return (
      <svg
        className={cn("w-full h-full select-none", className)}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="fluent-media-back" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#36B5FF" />
            <stop offset="100%" stopColor="#0078D4" />
          </linearGradient>
          <linearGradient id="fluent-media-front" x1="2" y1="10" x2="30" y2="26" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#50E6FF" />
            <stop offset="50%" stopColor="#00A4EF" />
            <stop offset="100%" stopColor="#005A9E" />
          </linearGradient>
          <filter id="fluent-media-shadow" x="0" y="8" width="32" height="22" filterUnits="userSpaceOnUse">
            <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#003566" floodOpacity="0.35" />
          </filter>
        </defs>

        <path
          d="M4 6.5C4 5.39543 4.89543 4.5 6 4.5H12.1716C12.702 4.5 13.2107 4.71071 13.5858 5.08579L15.4142 6.91421C15.7893 7.28929 16.298 7.5 16.8284 7.5H26C27.1046 7.5 28 8.39543 28 9.5V13.5H4V6.5Z"
          fill="url(#fluent-media-back)"
        />
        <rect x="5.5" y="7.5" width="21" height="11" rx="1.5" fill="#FFFFFF" fillOpacity="0.9" />
        <g filter="url(#fluent-media-shadow)">
          <path
            d="M3 11.5C3 10.3954 3.89543 9.5 5 9.5H27C28.1046 9.5 29 10.3954 29 11.5V24.5C29 25.6046 28.1046 26.5 27 26.5H5C3.89543 26.5 3 25.6046 3 24.5V11.5Z"
            fill="url(#fluent-media-front)"
          />
        </g>
      </svg>
    );
  }

  return (
    <svg
      className={cn("w-full h-full select-none", className)}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Fluent Folder Back Gradient */}
        <linearGradient id="fluent-folder-back" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFC83B" />
          <stop offset="100%" stopColor="#FF9500" />
        </linearGradient>

        {/* Fluent Folder Front Flap Gradient */}
        <linearGradient id="fluent-folder-front" x1="2" y1="10" x2="30" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFDB58" />
          <stop offset="50%" stopColor="#FFB300" />
          <stop offset="100%" stopColor="#E67E00" />
        </linearGradient>

        {/* Inner Highlight Edge */}
        <linearGradient id="fluent-folder-highlight" x1="3" y1="10" x2="29" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFEAA7" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#FFB300" stopOpacity="0.3" />
        </linearGradient>

        {/* Drop Shadow Filter */}
        <filter id="fluent-shadow" x="0" y="8" width="32" height="22" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="2.5" stdDeviation="1.5" floodColor="#8B4500" floodOpacity="0.35" />
        </filter>
      </defs>

      {/* Back tab of folder */}
      <path
        d="M4 6.5C4 5.39543 4.89543 4.5 6 4.5H12.1716C12.702 4.5 13.2107 4.71071 13.5858 5.08579L15.4142 6.91421C15.7893 7.28929 16.298 7.5 16.8284 7.5H26C27.1046 7.5 28 8.39543 28 9.5V13.5H4V6.5Z"
        fill="url(#fluent-folder-back)"
      />

      {/* Inner white document paper inside folder */}
      <rect x="5.5" y="7" width="21" height="11" rx="1.5" fill="#FFFFFF" fillOpacity="0.92" />

      {/* Front flap with shadow & Fluent gradient */}
      <g filter="url(#fluent-shadow)">
        <path
          d="M3 11.5C3 10.3954 3.89543 9.5 5 9.5H27C28.1046 9.5 29 10.3954 29 11.5V24.5C29 25.6046 28.1046 26.5 27 26.5H5C3.89543 26.5 3 25.6046 3 24.5V11.5Z"
          fill="url(#fluent-folder-front)"
        />
        {/* Top edge highlight stroke */}
        <path
          d="M4.5 10.5H27.5"
          stroke="url(#fluent-folder-highlight)"
          strokeWidth="1"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
