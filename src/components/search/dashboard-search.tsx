import { useDashboardComponentAdapters } from "@/components/dashboard/dashboard-component-adapters";

export const DashboardSearch = () => {
  const { DashboardSearch: Search } = useDashboardComponentAdapters();
  return <Search />;
};
