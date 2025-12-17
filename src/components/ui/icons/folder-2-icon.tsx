import { cn } from "@/lib/utils";

export function Folder2Icon({ className }: { className?: string }) {
    return (
        <svg
            className={cn("w-full h-full", className)}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path
                d="M4 4.5H9.79297L11.793 6.5H20C20.4163 6.5 20.7599 6.64276 21.0586 6.94141C21.3572 7.24005 21.5 7.58366 21.5 8V18C21.5 18.4163 21.3572 18.7599 21.0586 19.0586C20.7599 19.3572 20.4163 19.5 20 19.5H4C3.58366 19.5 3.24005 19.3572 2.94141 19.0586C2.64276 18.7599 2.5 18.4163 2.5 18V6C2.5 5.58366 2.64276 5.24005 2.94141 4.94141C3.24005 4.64276 3.58366 4.5 4 4.5Z"
                stroke="#282828"
                className="fill-[#222222] stroke-[#171717]"
            />
            <rect x="7" y="8" width="16" height="11" rx="1" className="fill-ring" />
            <g filter="url(#filter0_ii_2039_14)">
                <rect x="2" y="9" width="20" height="11" rx="2" className="fill-[#2b2b2b]" />
            </g>
            <defs>
                <filter
                    id="filter0_ii_2039_14"
                    x="2"
                    y="9"
                    width="20"
                    height="11"
                    filterUnits="userSpaceOnUse"
                    colorInterpolationFilters="sRGB"
                >
                    <feFlood floodOpacity="0" result="BackgroundImageFix" />
                    <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
                    <feColorMatrix
                        in="SourceAlpha"
                        type="matrix"
                        values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                        result="hardAlpha"
                    />
                    <feOffset dy="0.5" />
                    <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
                    <feColorMatrix
                        type="matrix"
                        values="0 0 0 0 0.361539 0 0 0 0 0.361539 0 0 0 0 0.361539 0 0 0 1 0"
                    />
                    <feBlend mode="normal" in2="shape" result="effect1_innerShadow_2039_14" />
                    <feColorMatrix
                        in="SourceAlpha"
                        type="matrix"
                        values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                        result="hardAlpha"
                    />
                    <feOffset dy="-0.5" />
                    <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
                    <feColorMatrix
                        type="matrix"
                        values="0 0 0 0 0.103846 0 0 0 0 0.103846 0 0 0 0 0.103846 0 0 0 1 0"
                    />
                    <feBlend mode="normal" in2="effect1_innerShadow_2039_14" result="effect2_innerShadow_2039_14" />
                </filter>
            </defs>
        </svg>
    );
}
