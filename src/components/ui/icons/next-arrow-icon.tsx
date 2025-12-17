import { cn } from "@/lib/utils";

export const NextArrowIcon = ({ className }: { className?: string }) => {
    return (
        <svg
            className={cn(className)}
            width="36"
            height="40"
            viewBox="0 0 36 40"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path
                d="M32.662 15.46C35.9517 17.3927 35.9517 22.1494 32.662 24.0821L7.53275 38.8456C4.19956 40.8038 9.00283e-07 38.4004 1.06926e-06 34.5345L2.35993e-06 5.00759C2.52891e-06 1.14172 4.19956 -1.26172 7.53275 0.696529L32.662 15.46Z"
                className="fill-muted-foreground"
            />
        </svg>
    );
};
