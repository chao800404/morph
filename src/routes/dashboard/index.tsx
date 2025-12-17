import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div>
      <p>Hello "/dashboard/ parent2"!</p>
    </div>
  );
}
