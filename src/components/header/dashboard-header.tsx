// import { AdminProtect } from "@/components/auth/admin-protect";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { BreadcrumbItem } from "@/lib/config/navigation";
import { BreadcrumbCollapse } from "@/routes/_backend/dashboard/-components/breadcrumb/breadcrumb-collapse";

interface DashboardHeaderProps {
  items?: BreadcrumbItem[];
}

export const DashboardHeader = ({ items }: DashboardHeaderProps) => {
  return (
    <header className="fixed top-0 z-30 flex h-14 w-full min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b bg-sidebar px-4">
      <SidebarTrigger className="-ml-1 shrink-0" />
      <BreadcrumbCollapse
        className="min-w-0 flex-1"
        breadcrumbs={items?.map((item) => ({
          label: item.name,
          href: item.href,
        }))}
      />
    </header>
  );
};
