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
import React from "react";

export const BreadcrumbCollapse = ({
    breadcrumbs,
    className,
}: {
    breadcrumbs?: { label: string; href: string }[];
    className?: string;
}) => {
    const [firstThreeBreadcrumbs, middleBreadcrumbs, lastBreadcrumb] = React.useMemo(() => {
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
        <Breadcrumb className={className}>
            <BreadcrumbList>
                {firstThreeBreadcrumbs && firstThreeBreadcrumbs && (
                    <React.Fragment key={firstThreeBreadcrumbs.href}>
                        <BreadcrumbItem>
                            <BreadcrumbLink asChild>
                                <RouterLink href={firstThreeBreadcrumbs.href}>{firstThreeBreadcrumbs.label}</RouterLink>
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                    </React.Fragment>
                )}
                {middleBreadcrumbs && middleBreadcrumbs.length > 0 && (
                    <React.Fragment>
                        <BreadcrumbItem>
                            <DropdownMenu>
                                <DropdownMenuTrigger className="flex items-center gap-1">
                                    <BreadcrumbEllipsis className="size-4" />
                                    <span className="sr-only">Toggle menu</span>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                    {middleBreadcrumbs.map(breadcrumb => (
                                        <DropdownMenuItem key={breadcrumb.href}>
                                            <RouterLink href={breadcrumb.href}>{breadcrumb.label}</RouterLink>
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                    </React.Fragment>
                )}
                {lastBreadcrumb &&
                    lastBreadcrumb.map((breadcrumb, idx) => (
                        <React.Fragment key={breadcrumb.href}>
                            <BreadcrumbItem>
                                {idx === lastBreadcrumb.length - 1 ? (
                                    <BreadcrumbPage>{breadcrumb.label}</BreadcrumbPage>
                                ) : (
                                    <BreadcrumbLink asChild>
                                        <RouterLink href={breadcrumb.href}>{breadcrumb.label}</RouterLink>
                                    </BreadcrumbLink>
                                )}
                            </BreadcrumbItem>
                            {idx < lastBreadcrumb.length - 1 && <BreadcrumbSeparator />}
                        </React.Fragment>
                    ))}
            </BreadcrumbList>
        </Breadcrumb>
    );
};
