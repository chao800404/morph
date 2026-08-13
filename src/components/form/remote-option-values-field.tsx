import {
  useDashboardComponentAdapters,
  type RemoteOptionValuesFieldProps,
} from "@/components/dashboard/dashboard-component-adapters";

export function RemoteOptionValuesField(props: RemoteOptionValuesFieldProps) {
  const { RemoteOptionValuesField: Field } = useDashboardComponentAdapters();
  return <Field {...props} />;
}
