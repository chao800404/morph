import { getSession } from "@/server/auth/getSession";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    return { session };
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div>
      <p>Hello "/dashboard parent"!</p>
      <Outlet />
    </div>
  );
}
