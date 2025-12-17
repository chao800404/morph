type NavMainProps = {
    title: string;
    items: {
        title: string;
        url: string;
        icon?: LucideIcon;
        isActive?: boolean;
        customName?: string;
        items?: {
            title: string;
            url: string;
        }[];
    }[];
};
