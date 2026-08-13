import {
  DashboardComponentAdaptersProvider,
  type DashboardComponentAdapters,
} from "@/components/dashboard/dashboard-component-adapters";
import { lazy, useMemo, type ReactNode } from "react";

const RemoteSelectField = lazy(() =>
  import("./form/remote-select-field").then((module) => ({
    default: module.RemoteSelectField,
  })),
);
const RemoteOptionValuesField = lazy(() =>
  import("./form/remote-option-values-field").then((module) => ({
    default: module.RemoteOptionValuesField,
  })),
);
const DashboardAssetLibraryPanel = lazy(() =>
  import("./form/asset-library-panel").then((module) => ({
    default: module.DashboardAssetLibraryPanel,
  })),
);
const DashboardSearch = lazy(() =>
  import("./search/dashboard-search").then((module) => ({
    default: module.DashboardSearch,
  })),
);

export const DashboardAdapters = ({ children }: { children: ReactNode }) => {
  const adapters = useMemo<DashboardComponentAdapters>(
    () => ({
      RemoteSelectField,
      RemoteOptionValuesField,
      AssetLibraryPanel: DashboardAssetLibraryPanel,
      DashboardSearch,
    }),
    [],
  );

  return (
    <DashboardComponentAdaptersProvider adapters={adapters}>
      {children}
    </DashboardComponentAdaptersProvider>
  );
};
