import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_backend/dashboard/settings/")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/dashboard/settings/sss"!</div>;
}
