import { cn } from "@/lib/utils";
import * as React from "react";

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
    ({ className, ...props }, ref) => {
        const divRef = React.useRef<null | HTMLDivElement>(null);

        const [isScrolled, setIsScrolled] = React.useState(false);

        React.useEffect(() => {
            const scrollContainer = divRef.current;
            if (!scrollContainer) return;

            const handleScroll = () => {
                setIsScrolled(scrollContainer.scrollLeft > 0);
            };

            // 初始檢查
            handleScroll();

            // 監聽 scroll 事件
            scrollContainer.addEventListener("scroll", handleScroll);

            return () => {
                scrollContainer.removeEventListener("scroll", handleScroll);
            };
        }, []);

        return (
            <div data-scrolled={isScrolled} ref={divRef} className="relative w-full overflow-auto group">
                <table ref={ref} className={cn("w-full shadow-accent caption-bottom text-sm", className)} {...props} />
            </div>
        );
    }
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
    ({ className, ...props }, ref) => (
        <thead ref={ref} className={cn("[&_tr]:border-b bg-accent", className)} {...props} />
    )
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
    ({ className, ...props }, ref) => (
        <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
    )
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
    ({ className, ...props }, ref) => (
        <tfoot
            ref={ref}
            className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
            {...props}
        />
    )
);
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
    ({ className, ...props }, ref) => (
        <tr
            ref={ref}
            className={cn(
                "border-b transition-colors hover:bg-muted/50 group data-[state=selected]:bg-muted",
                className
            )}
            {...props}
        />
    )
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
    ({ className, ...props }, ref) => (
        <th
            ref={ref}
            className={cn(
                "h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
                className
            )}
            {...props}
        />
    )
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
    ({ className, ...props }, ref) => (
        <td ref={ref} className={cn("px-4 py-1.5 align-middle [&:has([role=checkbox])]:pr-0", className)} {...props} />
    )
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
    ({ className, ...props }, ref) => (
        <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
    )
);
TableCaption.displayName = "TableCaption";

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
