import { TopLoader } from "@/components/top-loader/top-loader";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ThemeProvider } from "tanstack-theme-kit";

export const Route = createFileRoute("/_backend")({
  component: RouteComponent,
  notFoundComponent: () => <div>Not found</div>,
});

function RouteComponent() {
  return (
    <ThemeProvider>
      <TopLoader />
      <Outlet />
    </ThemeProvider>
  );
}
