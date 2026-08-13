import {
  useDashboardComponentAdapters,
  type AssetLibraryPanelProps,
} from "@/components/dashboard/dashboard-component-adapters";

export const AssetLibraryPanel = (props: AssetLibraryPanelProps) => {
  const { AssetLibraryPanel: Panel } = useDashboardComponentAdapters();
  return <Panel {...props} />;
};
