"use client";
import { ArrowBigLeftDash, SettingsIcon } from "lucide-react";
import * as React from "react";

import { getRedirectedPath } from "@/app/(backend)/dashboard/_components/pathname-history/pathname-history";
import { DashboardSearch } from "@/app/(backend)/dashboard/_components/search/dashbaord-search";
import client from "@/auth/authClient";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenuButton,
    SidebarSingleMenuItem,
} from "@/components/ui/sidebar";
import Link from "next/link";
import { useRouter } from "nextjs-toploader/app";
import { Suspense } from "react";
import { LogoF } from "../logo/logo";
import { NavHeader } from "./nav-header";
import { NavMain } from "./nav-main";
import { NavUser, NavUserProps } from "./nav-user";

type Props = React.ComponentProps<typeof Sidebar> &
    NavUserProps & {
        appName: string;
        showSettings?: boolean;
        sideData?: NavMainProps[];
    };

export function AppSidebar({ appName, user, sideData, showSettings = true, ...props }: Props) {
    const router = useRouter();

    const handleBackToDashboard = (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        const redirectedPath = getRedirectedPath();
        if (redirectedPath) router.push(redirectedPath);
        else router.push("/dashboard");
    };

    return (
        <Sidebar {...props}>
            <SidebarHeader className="h-14 border-b border-dashed items-center justify-center p-2">
                {showSettings ? (
                    <NavHeader>
                        <div className="flex relative items-center gap-2 justify-between">
                            <div className="w-8 h-8 z-20 absolute -left-1.5 border rounded-lg shadow-2xs p-[2px] mx-auto">
                                <LogoF />
                            </div>
                            <div className="text-sm leading-tight flex">
                                <span className="w-8 block" />
                                <span className="truncate font-medium text-foreground">{`${appName} store`}</span>
                            </div>
                        </div>
                    </NavHeader>
                ) : (
                    <SidebarSingleMenuItem className="text-zinc-800 text-base font-bold dark:text-zinc-300">
                        <SidebarMenuButton asChild>
                            <Link onClick={handleBackToDashboard} href="/dashboard">
                                <ArrowBigLeftDash />
                                <span>Settings</span>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarSingleMenuItem>
                )}
            </SidebarHeader>
            <SidebarContent>
                <Suspense>
                    <DashboardSearch />
                    {sideData?.map((data, idx) => (
                        <NavMain title={data.title} key={`${data.title}-${idx}`} items={data.items} />
                    ))}
                </Suspense>
            </SidebarContent>
            <SidebarFooter className="p-0">
                {showSettings && (
                    <SidebarSingleMenuItem className="p-2 text-zinc-600 dark:text-zinc-400">
                        <SidebarMenuButton asChild>
                            <Link href="/dashboard/settings">
                                <SettingsIcon />
                                <span>Settings</span>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarSingleMenuItem>
                )}
                <div className="border-t p-2 border-dashed h-14 items-center justify-center flex">
                    <NavUser
                        user={user}
                        signout={async () => {
                            await client.signOut();
                            router.refresh();
                        }}
                    />
                </div>
            </SidebarFooter>
        </Sidebar>
    );
}
