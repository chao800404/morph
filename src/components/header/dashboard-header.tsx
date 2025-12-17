// import { AdminProtect } from "@/components/auth/admin-protect";
import {
    Breadcrumb,
    BreadcrumbItem as BreadcrumbItemUI,
    BreadcrumbLink,
    BreadcrumbList,
} from "@/components/ui/breadcrumb";
import { TriangleRightIcon } from "@/components/ui/icons/triangle-right-icon";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { BreadcrumbItem } from "@/lib/cms/navigation";
import Link from "next/link";
import React from "react";

interface DashboardHeaderProps {
    items?: BreadcrumbItem[];
}

export const DashboardHeader = ({ items }: DashboardHeaderProps) => {
    return (
        <header className="fixed w-full top-0 bg-sidebar z-30 flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Breadcrumb>
                <BreadcrumbList>
                    {items?.map((item, idx) => (
                        <React.Fragment key={idx}>
                            <BreadcrumbItemUI>
                                <BreadcrumbLink asChild>
                                    <Link href={item.href}>{item.name}</Link>
                                </BreadcrumbLink>
                            </BreadcrumbItemUI>
                            {idx + 1 !== items.length && <TriangleRightIcon />}
                        </React.Fragment>
                    ))}
                </BreadcrumbList>
            </Breadcrumb>
        </header>
    );
};
