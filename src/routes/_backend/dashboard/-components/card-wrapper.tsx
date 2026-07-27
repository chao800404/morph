import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import React from "react";

// Base props shared by both variants
interface BaseCardWrapperProps {
  children?: React.ReactNode;
  classNames?: {
    headerWrapper?: string;
    contentWrapper?: string;
    cardWrapper?: string;
  };
  id?: string;
}

// Props when using default header
interface DefaultHeaderProps extends BaseCardWrapperProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  headerButton?: React.ReactNode;
  customHeader?: never;
}

// Props when using custom header
interface CustomHeaderProps extends BaseCardWrapperProps {
  customHeader: React.ReactNode;
  label?: never;
  description?: never;
  icon?: never;
  headerButton?: never;
}

type CardWrapperProps = DefaultHeaderProps | CustomHeaderProps;

export const CardWrapper = (props: CardWrapperProps) => {
  const { children, classNames, description, id } = props;

  return (
    <Card
      id={id}
      className={cn(
        "bg-component flex flex-col rounded-lg border-none ring py-0 gap-0 ring-muted-foreground/10 dark:ring-muted-foreground/20",
        classNames?.cardWrapper,
      )}
    >
      <CardHeader className="py-4 [.border-b]:pb-4" data-type="card-header">
        {"customHeader" in props && props.customHeader ? (
          props.customHeader
        ) : (
          <div
            className={cn(
              classNames?.headerWrapper,
              "flex justify-between items-center gap-2",
            )}
          >
            <div
              className={cn(
                "flex items-center gap-2 w-full",
                props.headerButton ? "justify-between" : "justify-start",
              )}
            >
              {"icon" in props &&
                props.icon &&
                React.createElement(props.icon, { className: "w-4 h-4" })}
              <div>
                {"label" in props && (
                  <CardTitle className="text-base font-medium">
                    {props.label}
                  </CardTitle>
                )}
                {"description" in props && (
                  <CardDescription className="text-sm text-zinc-500">
                    {description}
                  </CardDescription>
                )}
              </div>
            </div>
            {"headerButton" in props && props.headerButton}
          </div>
        )}
      </CardHeader>
      {children && (
        <CardContent
          className={cn(
            classNames?.contentWrapper,
            "text-muted-foreground flex-1 px-0",
          )}
        >
          {children}
        </CardContent>
      )}
    </Card>
  );
};
