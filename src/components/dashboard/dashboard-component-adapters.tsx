import type { SelectedAsset } from "@/components/asset/asset-tile";
import type {
  OptionValuesFormField,
  RemoteSelectFormField,
} from "@/lib/validations/form";
import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";

export interface RemoteSelectFieldProps {
  field: RemoteSelectFormField;
  value: string;
  onChange?: (value: string) => void;
}

export interface RemoteOptionValuesFieldProps {
  field: OptionValuesFormField & {
    remoteSource: NonNullable<OptionValuesFormField["remoteSource"]>;
  };
  selectedIds: string[];
  onSelectionChange?: (ids: string[]) => void;
}

export interface AssetLibraryPanelProps {
  selectedIds: string[];
  onToggle: (asset: SelectedAsset) => void;
  atLimit?: boolean;
  className?: string;
}

export interface DashboardComponentAdapters {
  RemoteSelectField: ComponentType<RemoteSelectFieldProps>;
  RemoteOptionValuesField: ComponentType<RemoteOptionValuesFieldProps>;
  AssetLibraryPanel: ComponentType<AssetLibraryPanelProps>;
  DashboardSearch: ComponentType;
}

const DashboardComponentAdaptersContext =
  createContext<DashboardComponentAdapters | null>(null);

export const DashboardComponentAdaptersProvider = ({
  adapters,
  children,
}: {
  adapters: DashboardComponentAdapters;
  children: ReactNode;
}) => (
  <DashboardComponentAdaptersContext.Provider value={adapters}>
    {children}
  </DashboardComponentAdaptersContext.Provider>
);

export const useDashboardComponentAdapters = () => {
  const adapters = useContext(DashboardComponentAdaptersContext);
  if (!adapters) {
    throw new Error(
      "Dashboard component adapters must be provided by the Dashboard layout",
    );
  }
  return adapters;
};
