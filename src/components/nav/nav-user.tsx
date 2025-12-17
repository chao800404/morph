"use client";

import { Ellipsis, LogOut } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";

import Link from "next/link";
import { ThemeSwitch } from "../switch/theme-switch";
import { UserIcon } from "../ui/icons/user-icon";

export type NavUserProps = {
    user: {
        name: string;
        email: string;
        avatar?: string | null;
    };
    signout?: () => void;
};

export function NavUser({ user, signout }: NavUserProps) {
    const { isMobile } = useSidebar();
    const firstNameWord = user.name[0];

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <SidebarMenuButton className="overflow-visible relative data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                            <Avatar className="h-7 absolute z-20 left-1 w-7 rounded-full border-input border bg-card/50 p-[2px]">
                                {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
                                <AvatarFallback className="rounded-full bg-input">{firstNameWord}</AvatarFallback>
                            </Avatar>
                            <div className="grid relative left-8 flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-medium text-zinc-600 dark:text-zinc-300">
                                    {user.name}
                                </span>
                            </div>
                            <Ellipsis />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className="w-(--radix-dropdown-menu-trigger-width) rounded-lg"
                        side={isMobile ? "bottom" : "top"}
                        align="end"
                        sideOffset={4}
                    >
                        <DropdownMenuLabel className="p-0 font-normal">
                            <div className="flex items-center gap-2 px-1 py-1.5 text-left relative z-20 text-sm">
                                <Avatar className="h-8 w-8 rounded-full border-input border bg-card/50 p-[2px]">
                                    {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
                                    <AvatarFallback className="rounded-full bg-input">{firstNameWord}</AvatarFallback>
                                </Avatar>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate font-medium">{user.name}</span>
                                    <span className="truncate text-xs">{user.email}</span>
                                </div>
                            </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                            <DropdownMenuItem className="p-0">
                                <Link
                                    className="flex rounded-md py-1.5 px-2 w-full items-center bg-transparent gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-600/50"
                                    href="/dashboard/settings/profile"
                                >
                                    <UserIcon />
                                    Profile settings
                                </Link>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={e => e.preventDefault()}>
                                <ThemeSwitch />
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
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
