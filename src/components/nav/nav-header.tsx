"use client";

import { Ellipsis, LogOut, Settings } from "lucide-react";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";

import Link from "next/link";
import { useRouter } from "nextjs-toploader/app";

export type NavUserProps = {
    signout?: () => void;
    children: React.ReactNode;
};

export function NavHeader({ signout, children }: NavUserProps) {
    const { isMobile } = useSidebar();
    const router = useRouter();

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <SidebarMenuButton size="sm" className="flex overflow-visible items-center justify-between">
                            {children}
                            <Ellipsis />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className="w-(--radix-dropdown-menu-trigger-width) rounded-lg"
                        side={isMobile ? "bottom" : "top"}
                        align="end"
                        sideOffset={4}
                    >
                        <DropdownMenuLabel className="font-normal p-0">
                            <Link
                                href="/dashboard"
                                className="p-2 block hover:bg-neutral-100 dark:hover:bg-neutral-600/50 rounded-md"
                            >
                                {children}
                            </Link>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="cursor-pointer p-0">
                            <Link
                                className="flex rounded-md py-1.5 px-2 w-full items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-600/50"
                                href="/dashboard/settings"
                            >
                                <Settings />
                                Settings
                            </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="cursor-pointer p-0">
                            <Link
                                className="flex rounded-md py-1.5 px-2 w-full items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-600/50"
                                href="/auth/sign-out"
                                onClick={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    signout?.();
                                }}
                            >
                                <LogOut className="scale-x-[-1]" />
                                Log out
                            </Link>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
