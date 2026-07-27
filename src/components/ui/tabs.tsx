"use client";

import { cn } from "@/lib/utils";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

const tabsListVariants = cva(
  "text-muted-foreground inline-flex w-fit items-center justify-center",
  {
    variants: {
      variant: {
        default: "h-9 rounded-lg bg-muted p-[3px]",
        wizard: "h-full rounded-none bg-transparent p-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const tabsTriggerVariants = cva(
  [
    "text-foreground inline-flex flex-1 items-center justify-center gap-1.5 text-sm font-medium whitespace-nowrap",
    "transition-[color,background-color,box-shadow] outline-none",
    "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring focus-visible:ring-[3px] focus-visible:outline-1",
    "dark:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
  {
    variants: {
      variant: {
        default: [
          "h-[calc(100%-1px)] rounded-md border border-transparent px-2 py-1",
          "data-[state=active]:border-zinc-300 data-[state=active]:bg-zinc-200 data-[state=active]:text-zinc-500 data-[state=active]:shadow-xs data-[state=active]:inset-shadow-xs data-[state=active]:inset-shadow-zinc-100",
          "data-[state=active]:dark:border-x-0 data-[state=active]:dark:border-t-zinc-500/30 data-[state=active]:dark:border-b-0 data-[state=active]:dark:bg-zinc-700/30 data-[state=active]:dark:text-zinc-300/80 data-[state=active]:dark:shadow-sm data-[state=active]:dark:shadow-zinc-900 data-[state=active]:dark:inset-shadow-none data-[state=active]:dark:inset-ring data-[state=active]:dark:inset-ring-zinc-600/20",
        ],
        wizard: [
          "h-full flex-none rounded-none border-x border-transparent px-6 py-4 text-muted-foreground shadow-none",
          "hover:text-foreground",
          "data-[state=active]:border-border/60 data-[state=active]:bg-muted/40 data-[state=active]:text-foreground data-[state=active]:shadow-none",
        ],
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function TabsList({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> &
  VariantProps<typeof tabsTriggerVariants>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      data-variant={variant}
      className={cn(tabsTriggerVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  );
}

export {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  tabsListVariants,
  tabsTriggerVariants,
};
