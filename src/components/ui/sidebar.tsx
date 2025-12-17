"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { Slot } from "@radix-ui/react-slot";
import { VariantProps, cva } from "class-variance-authority";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { SideIcon } from "./icons/side-icon";
import { ScrollArea } from "./scroll-area";

const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH = "14rem";
const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

type SidebarContextProps = {
    state: "expanded" | "collapsed";
    open: boolean;
    setOpen: (open: boolean) => void;
    openMobile: boolean;
    setOpenMobile: (open: boolean) => void;
    isMobile: boolean;
    toggleSidebar: () => void;
    insetWidth: number;
    setInsetWidth: (width: number) => void;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
    const context = React.useContext(SidebarContext);
    if (!context) {
        throw new Error("useSidebar must be used within a SidebarProvider.");
    }

    return context;
}

function SidebarProvider({
    defaultOpen = true,
    open: openProp,
    onOpenChange: setOpenProp,
    className,
    style,
    children,
    ...props
}: React.ComponentProps<"div"> & {
    defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}) {
    const isMobile = useIsMobile();
    const [openMobile, setOpenMobile] = React.useState(false);
    const [insetWidth, setInsetWidth] = React.useState(0);

    // This is the internal state of the sidebar.
    // We use openProp and setOpenProp for control from outside the component.
    const [_open, _setOpen] = React.useState(defaultOpen);
    const open = openProp ?? _open;
    const setOpen = React.useCallback(
        (value: boolean | ((value: boolean) => boolean)) => {
            const openState = typeof value === "function" ? value(open) : value;
            if (setOpenProp) {
                setOpenProp(openState);
            } else {
                _setOpen(openState);
            }

            // This sets the cookie to keep the sidebar state.
            document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
        },
        [setOpenProp, open]
    );

    // Helper to toggle the sidebar.
    const toggleSidebar = React.useCallback(() => {
        return isMobile ? setOpenMobile(open => !open) : setOpen(open => !open);
    }, [isMobile, setOpen, setOpenMobile]);

    // Adds a keyboard shortcut to toggle the sidebar.
    React.useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                toggleSidebar();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [toggleSidebar]);

    // We add a state so that we can do data-state="expanded" or "collapsed".
    // This makes it easier to style the sidebar with Tailwind classes.
    const state = open ? "expanded" : "collapsed";

    const contextValue = React.useMemo<SidebarContextProps>(
        () => ({
            state,
            open,
            setOpen,
            isMobile,
            openMobile,
            setOpenMobile,
            toggleSidebar,
            insetWidth,
            setInsetWidth,
        }),
        [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar, insetWidth, setInsetWidth]
    );

    return (
        <SidebarContext.Provider value={contextValue}>
            <TooltipProvider delayDuration={0}>
                <div
                    data-slot="sidebar-wrapper"
                    style={
                        {
                            "--sidebar-width": SIDEBAR_WIDTH,
                            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
                            ...style,
                        } as React.CSSProperties
                    }
                    className={cn(
                        "group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full",
                        className
                    )}
                    {...props}
                >
                    {children}
                </div>
            </TooltipProvider>
        </SidebarContext.Provider>
    );
}

function Sidebar({
    side = "left",
    variant = "sidebar",
    collapsible = "offcanvas",
    className,
    children,
    ...props
}: React.ComponentProps<"div"> & {
    side?: "left" | "right";
    variant?: "sidebar" | "floating" | "inset";
    collapsible?: "offcanvas" | "icon" | "none";
}) {
    const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

    if (collapsible === "none") {
        return (
            <div
                data-slot="sidebar"
                className={cn("bg-sidebar text-sidebar-foreground flex h-full w-(--sidebar-width) flex-col", className)}
                {...props}
            >
                {children}
            </div>
        );
    }

    if (isMobile) {
        return (
            <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
                <SheetContent
                    data-sidebar="sidebar"
                    data-slot="sidebar"
                    data-mobile="true"
                    className="p-2 overflow-hidden bg-transparent text-sidebar-foreground w-(--sidebar-width) [&>button]:hidden"
                    style={
                        {
                            "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
                        } as React.CSSProperties
                    }
                    side={side}
                >
                    <SheetHeader className="sr-only">
                        <SheetTitle>Sidebar</SheetTitle>
                        <SheetDescription>Displays the mobile sidebar.</SheetDescription>
                    </SheetHeader>
                    <AnimatePresence mode="wait">
                        {state && (
                            <motion.div
                                transition={{ type: "tween" }}
                                initial={{ opacity: 0, x: "-100%" }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: "-100%" }}
                                className="flex h-full w-full rounded-md flex-col bg-sidebar border shadow-sm"
                            >
                                {children}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </SheetContent>
            </Sheet>
        );
    }

    return (
        <div
            className="group peer text-sidebar-foreground hidden lg:block"
            data-state={state}
            data-collapsible={state === "collapsed" ? collapsible : ""}
            data-variant={variant}
            data-side={side}
            data-slot="sidebar"
        >
            {/* This is what handles the sidebar gap on desktop */}
            <div
                data-slot="sidebar-gap"
                className={cn(
                    "relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear",
                    "group-data-[collapsible=offcanvas]:w-0",
                    "group-data-[side=right]:rotate-180",
                    variant === "floating" || variant === "inset"
                        ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
                        : "group-data-[collapsible=icon]:w-(--sidebar-width-icon)"
                )}
            />
            <div
                data-slot="sidebar-container"
                className={cn(
                    "fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-200 ease-linear md:flex",
                    side === "left"
                        ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
                        : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
                    // Adjust the padding for floating and inset variants.
                    variant === "floating" || variant === "inset"
                        ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
                        : "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l",
                    className
                )}
                {...props}
            >
                <div
                    data-sidebar="sidebar"
                    data-slot="sidebar-inner"
                    className="bg-sidebar group-data-[variant=floating]:border-sidebar-border flex h-full w-full flex-col group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:shadow-sm"
                >
                    {children}
                </div>
            </div>
        </div>
    );
}

function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<typeof Button>) {
    const { toggleSidebar } = useSidebar();

    return (
        <Button
            data-sidebar="trigger"
            data-slot="sidebar-trigger"
            variant="ghost"
            size="icon"
            className={cn("size-7 bg-transparent shadow-none border-0", className)}
            onClick={event => {
                onClick?.(event);
                toggleSidebar();
            }}
            {...props}
        >
            <SideIcon />
            <span className="sr-only">Toggle Sidebar</span>
        </Button>
    );
}

function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
    const { toggleSidebar } = useSidebar();

    return (
        <button
            data-sidebar="rail"
            data-slot="sidebar-rail"
            aria-label="Toggle Sidebar"
            tabIndex={-1}
            onClick={toggleSidebar}
            title="Toggle Sidebar"
            className={cn(
                "hover:after:bg-sidebar-border absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] sm:flex",
                "in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize",
                "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
                "hover:group-data-[collapsible=offcanvas]:bg-sidebar group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full",
                "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
                "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
                className
            )}
            {...props}
        />
    );
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
    const { setInsetWidth } = useSidebar();
    const insetRef = React.useRef<HTMLElement>(null);

    const updateWidth = React.useCallback((): void => {
        if (insetRef.current) {
            const width: number = insetRef.current.offsetWidth;
            setInsetWidth(width);
        }
    }, [setInsetWidth]);

    React.useEffect(() => {
        updateWidth();

        const resizeObserver = new ResizeObserver(updateWidth);
        if (insetRef.current) {
            resizeObserver.observe(insetRef.current);
        }

        window.addEventListener("resize", updateWidth);

        return () => {
            resizeObserver.disconnect();
            window.removeEventListener("resize", updateWidth);
        };
    }, [updateWidth]);

    return (
        <main
            ref={insetRef}
            id="sidebarInset"
            data-slot="sidebar-inset"
            className={cn(
                "bg-sidebar relative flex w-full flex-1 flex-col",
                "md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
                className
            )}
            {...props}
        />
    );
}

function SidebarInput({ className, ...props }: React.ComponentProps<typeof Input>) {
    return (
        <Input
            data-slot="sidebar-input"
            data-sidebar="input"
            className={cn("bg-background h-8 w-full shadow-none", className)}
            {...props}
        />
    );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sidebar-header"
            data-sidebar="header"
            className={cn("flex flex-col gap-2 p-2", className)}
            {...props}
        />
    );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sidebar-footer"
            data-sidebar="footer"
            className={cn("flex flex-col gap-2 p-2", className)}
            {...props}
        />
    );
}

function SidebarSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
    return (
        <Separator
            data-slot="sidebar-separator"
            data-sidebar="separator"
            className={cn("bg-sidebar-border mx-2 w-auto", className)}
            {...props}
        />
    );
}

function SidebarContent({ className, children, ...props }: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
    return (
        <ScrollArea
            data-slot="sidebar-content"
            data-sidebar="content"
            className={cn(
                "flex min-h-0 flex-1 flex-col gap-2 group-data-[collapsible=icon]:overflow-hidden",
                className
            )}
            {...props}
        >
            {children}
        </ScrollArea>
    );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sidebar-group"
            data-sidebar="group"
            className={cn("relative border-b border-dashed flex w-full min-w-0 flex-col p-2", className)}
            {...props}
        />
    );
}

function SidebarGroupLabel({
    className,
    asChild = false,
    ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
    const Comp = asChild ? Slot : "div";

    return (
        <Comp
            data-slot="sidebar-group-label"
            data-sidebar="group-label"
            className={cn(
                "text-sidebar-foreground/70 mb-1 ring-sidebar-ring flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium outline-hidden transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
                "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
                className
            )}
            {...props}
        />
    );
}

function SidebarGroupAction({
    className,
    asChild = false,
    ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
    const Comp = asChild ? Slot : "button";

    return (
        <Comp
            data-slot="sidebar-group-action"
            data-sidebar="group-action"
            className={cn(
                "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 outline-hidden transition-transform focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
                // Increases the hit area of the button on mobile.
                "after:absolute after:-inset-2 md:after:hidden",
                "group-data-[collapsible=icon]:hidden",
                className
            )}
            {...props}
        />
    );
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sidebar-group-content"
            data-sidebar="group-content"
            className={cn("w-full text-sm", className)}
            {...props}
        />
    );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
    return (
        <ul
            data-slot="sidebar-menu"
            data-sidebar="menu"
            className={cn("flex w-full min-w-0 flex-col gap-1 text-muted-foreground", className)}
            {...props}
        />
    );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
    return (
        <li
            data-slot="sidebar-menu-item"
            data-sidebar="menu-item"
            className={cn("group/menu-item relative", className)}
            {...props}
        />
    );
}

function SidebarSingleMenuItem({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sidebar-single-menu-item"
            data-sidebar="single-menu-item"
            className={cn("group/menu-item w-full relative", className)}
            {...props}
        />
    );
}

const sidebarMenuButtonVariants = cva(
    cn(
        "peer/menu-button relative z-0 cursor-pointer flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden border-transparent transition-[width,height,padding]",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "focus-visible:ring-2",
        "active:bg-sidebar-accent active:text-sidebar-accent-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
        "group-has-data-[sidebar=menu-action]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50",
        "data-[active=true]:shadow-xs dark:data-[active=true]:shadow-xs/50  dark:data-[active=true]:bg-sidebar-accent data-[active=true]:bg-white data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[active=true]:inset-shadow-2xs data-[active=true]:z-30 data-[active=true]:inset-ring dark:data-[active=true]:inset-ring-zinc-600/50 data-[active=true]:inset-ring-zinc-950/10",
        "data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground",
        "group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2!",
        "[&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0"
    ),
    {
        variants: {
            variant: {
                default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                outline:
                    "bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]",
            },
            size: {
                default: "h-8 text-sm",
                sm: "h-7 text-xs",
                lg: "h-12 text-sm group-data-[collapsible=icon]:p-0!",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
);

function SidebarMenuButton({
    asChild = false,
    isActive = false,
    variant = "default",
    size = "default",
    tooltip,
    className,
    ...props
}: React.ComponentProps<"button"> & {
    asChild?: boolean;
    isActive?: boolean;
    tooltip?: string | React.ComponentProps<typeof TooltipContent>;
} & VariantProps<typeof sidebarMenuButtonVariants>) {
    const Comp = asChild ? Slot : "button";
    const { isMobile, state } = useSidebar();

    const button = (
        <Comp
            data-slot="sidebar-menu-button"
            data-sidebar="menu-button"
            data-size={size}
            data-active={isActive}
            className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
            {...props}
        />
    );

    if (!tooltip) {
        return button;
    }

    if (typeof tooltip === "string") {
        tooltip = {
            children: tooltip,
        };
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="right" align="center" hidden={state !== "collapsed" || isMobile} {...tooltip} />
        </Tooltip>
    );
}

function SidebarMenuAction({
    className,
    asChild = false,
    showOnHover = false,
    ...props
}: React.ComponentProps<"button"> & {
    asChild?: boolean;
    showOnHover?: boolean;
}) {
    const Comp = asChild ? Slot : "button";

    return (
        <Comp
            data-slot="sidebar-menu-action"
            data-sidebar="menu-action"
            className={cn(
                "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground peer-hover/menu-button:text-sidebar-accent-foreground absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 outline-hidden transition-transform focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
                // Increases the hit area of the button on mobile.
                "after:absolute after:-inset-2 md:after:hidden",
                "peer-data-[size=sm]/menu-button:top-1",
                "peer-data-[size=default]/menu-button:top-1.5",
                "peer-data-[size=lg]/menu-button:top-2.5",
                "group-data-[collapsible=icon]:hidden",
                showOnHover &&
                    "peer-data-[active=true]/menu-button:text-sidebar-accent-foreground group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 md:opacity-0",
                className
            )}
            {...props}
        />
    );
}

function SidebarMenuBadge({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sidebar-menu-badge"
            data-sidebar="menu-badge"
            className={cn(
                "text-sidebar-foreground pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums select-none",
                "peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground",
                "peer-data-[size=sm]/menu-button:top-1",
                "peer-data-[size=default]/menu-button:top-1.5",
                "peer-data-[size=lg]/menu-button:top-2.5",
                "group-data-[collapsible=icon]:hidden",
                className
            )}
            {...props}
        />
    );
}

function SidebarMenuSkeleton({
    className,
    showIcon = false,
    ...props
}: React.ComponentProps<"div"> & {
    showIcon?: boolean;
}) {
    // Random width between 50 to 90%.
    const width = React.useMemo(() => {
        return `${Math.floor(Math.random() * 40) + 50}%`;
    }, []);

    return (
        <div
            data-slot="sidebar-menu-skeleton"
            data-sidebar="menu-skeleton"
            className={cn("flex h-8 items-center gap-2 rounded-md px-2", className)}
            {...props}
        >
            {showIcon && <Skeleton className="size-4 rounded-md" data-sidebar="menu-skeleton-icon" />}
            <Skeleton
                className="h-4 max-w-(--skeleton-width) flex-1"
                data-sidebar="menu-skeleton-text"
                style={
                    {
                        "--skeleton-width": width,
                    } as React.CSSProperties
                }
            />
        </div>
    );
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
    return (
        <ul
            data-slot="sidebar-menu-sub"
            data-sidebar="menu-sub"
            className={cn("flex min-w-0 flex-col", "group-data-[collapsible=icon]:hidden", className)}
            {...props}
        />
    );
}

function SidebarMenuSubItem({
    className,
    children,
    showLine = false,
    isActive = false,
    ...props
}: React.ComponentProps<"li"> & {
    showLine?: boolean;
    isActive?: boolean;
}) {
    return (
        <li
            data-active={isActive}
            data-slot="sidebar-menu-sub-item"
            data-sidebar="menu-sub-item"
            className={cn(
                "group/menu-sub-item  relative z-0 dark:ring-zinc-600/50 overflow-hidden h-7 gap-2 justify-items-stretch flex pl-2 items-stretch rounded-md",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                "data-[active=true]:shadow-xs/50 data-[active=true]:bg-white dark:data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:shadow-xs data-[active=true]:z-30 data-[active=true]:inset-ring dark:data-[active=true]:inset-ring-zinc-600/50 data-[active=true]:inset-ring-zinc-950/10",
                className
            )}
            {...props}
        >
            <div className="w-5 h-full relative">
                <div className="absolute top-0 left-0 w-full bottom-0 z-10 scale-105">
                    <div className="w-full h-full ">
                        {!isActive && (
                            <div
                                className={cn(
                                    "absolute top-0 left-0 w-full bottom-0 z-10 opacity-0",
                                    "group-hover/menu-sub-item:opacity-60"
                                )}
                            >
                                <SidebarHoverArror />
                            </div>
                        )}
                        {isActive ? <SidebarArrow /> : showLine ? <SidebarLine /> : null}
                    </div>
                </div>
            </div>
            <div className="w-full">{children}</div>
        </li>
    );
}

function SidebarMenuSubButton({
    asChild = false,
    size = "md",
    isActive = false,
    className,
    ...props
}: React.ComponentProps<"a"> & {
    asChild?: boolean;
    size?: "sm" | "md";
    isActive?: boolean;
}) {
    const Comp = asChild ? Slot : "a";

    return (
        <Comp
            data-slot="sidebar-menu-sub-button"
            data-sidebar="menu-sub-button"
            data-size={size}
            data-active={isActive}
            className={cn(
                "text-sidebar-foreground/50 h-full ring-sidebar-ring flex  min-w-0 -translate-x-px items-center gap-2 overflow-hidden outline-hidden",
                "active:bg-sidebar-accent active:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
                "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 ",
                "focus-visible:ring-2",
                "[&>svg]:text-sidebar-accent-foreground",
                "data-[active=true]:text-sidebar-accent-foreground",
                size === "sm" && "text-xs",
                size === "md" && "text-sm",
                "group-data-[collapsible=icon]:hidden",
                className
            )}
            {...props}
        />
    );
}

function SidebarFloatBlock({ className, children, ...props }: React.ComponentProps<"div">) {
    const { insetWidth, state, isMobile } = useSidebar();

    return (
        <div
            className={cn("fixed bottom-0 right-0 z-50", className)}
            style={{
                width: isMobile ? "100%" : `${insetWidth}px`,
                transition: "width 200ms ease-linear",
            }}
            data-sidebar-state={state}
            data-sidebar-mobile={isMobile}
            {...props}
        >
            {children}
        </div>
    );
}

function SidebarArrow({ color = "#949494" }: { color?: string }) {
    return (
        <svg width="100%" height="100%" viewBox="0 0 25 38" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M25 21.5L18.25 25.3971L18.25 17.6029L25 21.5Z" fill={color} />
            <path d="M12 0V16.5C12 19.2614 14.2386 21.5 17 21.5H23.5" stroke={color} strokeWidth="2" />
        </svg>
    );
}

function SidebarLine({ color = "#949494" }: { color?: string }) {
    return (
        <svg width="100%" height="100%" viewBox="0 0 25 38" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 0L12 38" stroke={color} strokeWidth="2" />
        </svg>
    );
}

function SidebarHoverArror({ color = "#BCBCBC" }: { color?: string }) {
    return (
        <svg width="100%" height="100%" viewBox="0 0 25 38" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M25 19.5L18.25 23.3971L18.25 15.6029L25 19.5Z" fill={color} />
            <path d="M12 19.5H19" stroke={color} strokeWidth="2" />
        </svg>
    );
}

export {
    Sidebar,
    SidebarArrow,
    SidebarContent,
    SidebarFloatBlock,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupAction,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarHoverArror,
    SidebarInput,
    SidebarInset,
    SidebarLine,
    SidebarMenu,
    SidebarMenuAction,
    SidebarMenuBadge,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSkeleton,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
    SidebarProvider,
    SidebarRail,
    SidebarSeparator,
    SidebarSingleMenuItem,
    SidebarTrigger,
    useSidebar,
};
