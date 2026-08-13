import {
  useDashboardComponentAdapters,
  type RemoteSelectFieldProps,
} from "@/components/dashboard/dashboard-component-adapters";

export function RemoteSelectField(props: RemoteSelectFieldProps) {
  const { RemoteSelectField: Field } = useDashboardComponentAdapters();
  return <Field {...props} />;
}
