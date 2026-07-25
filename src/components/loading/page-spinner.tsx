import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface PageSpinnerProps {
  className?: string;
}

export const PageSpinner = ({ className }: PageSpinnerProps) => {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center h-[calc(100svh-56px)] w-full text-muted-foreground",
        className,
      )}
    >
      <Spinner className="size-6 text-foreground/70" />
    </div>
  );
};
