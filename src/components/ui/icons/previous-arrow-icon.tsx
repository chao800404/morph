import { cn } from "@/lib/utils";

export const PreviousArrowIcon = ({ className }: { className?: string }) => {
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
                d="M2.46737 24.0821C-0.822307 22.1494 -0.822311 17.3927 2.46736 15.46L27.5966 0.69653C30.9298 -1.26172 35.1294 1.14172 35.1294 5.00759L35.1294 34.5345C35.1294 38.4004 30.9298 40.8038 27.5967 38.8456L2.46737 24.0821Z"
                className="fill-muted-foreground"
            />
        </svg>
    );
};
