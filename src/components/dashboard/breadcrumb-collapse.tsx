"use client";

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RouterLink } from "@/components/router-link";
import { cn } from "@/lib/utils";
import React from "react";

const crumbTextClass =
  "block max-w-24 truncate sm:max-w-40 lg:max-w-64 xl:max-w-96";

export const BreadcrumbCollapse = ({
  breadcrumbs,
  className,
}: {
  breadcrumbs?: { label: string; href: string }[];
  className?: string;
}) => {
  const [firstBreadcrumb, middleBreadcrumbs, lastBreadcrumbs] =
    React.useMemo(() => {
      if (!breadcrumbs || breadcrumbs.length === 0) {
        return [undefined, undefined, undefined];
      }
      const [first, ...rest] = breadcrumbs;
      if (breadcrumbs.length === 1) {
        return [undefined, [], [first]];
      }

      if (breadcrumbs.length <= 3) {
        return [first, [], [...rest]];
      }

      const middle = rest.slice(0, breadcrumbs.length - 3);
      const last = rest.slice(rest.length - 2, rest.length);
      return [first, middle, last];
    }, [breadcrumbs]);

  return (
    <Breadcrumb className={cn("min-w-0 overflow-hidden", className)}>
      <BreadcrumbList className="flex-nowrap overflow-hidden">
        {firstBreadcrumb && (
          <React.Fragment key={firstBreadcrumb.href}>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <RouterLink
                  href={firstBreadcrumb.href}
                  className={crumbTextClass}
                >
                  {firstBreadcrumb.label}
                </RouterLink>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </React.Fragment>
        )}
        {middleBreadcrumbs && middleBreadcrumbs.length > 0 && (
          <React.Fragment>
            <BreadcrumbItem>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Show hidden breadcrumb items"
                  className="flex shrink-0 items-center gap-1"
                >
                  <BreadcrumbEllipsis className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {middleBreadcrumbs.map((breadcrumb) => (
                    <DropdownMenuItem key={breadcrumb.href}>
                      <RouterLink href={breadcrumb.href}>
                        {breadcrumb.label}
                      </RouterLink>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </React.Fragment>
        )}
        {lastBreadcrumbs &&
          lastBreadcrumbs.map((breadcrumb, idx) => (
            <React.Fragment key={breadcrumb.href}>
              <BreadcrumbItem>
                {idx === lastBreadcrumbs.length - 1 ? (
                  <BreadcrumbPage
                    className={crumbTextClass}
                    title={breadcrumb.label}
                  >
                    {breadcrumb.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <RouterLink
                      href={breadcrumb.href}
                      className={crumbTextClass}
                    >
                      {breadcrumb.label}
                    </RouterLink>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {idx < lastBreadcrumbs.length - 1 && <BreadcrumbSeparator />}
            </React.Fragment>
          ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
};
