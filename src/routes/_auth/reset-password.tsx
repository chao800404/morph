import { createFileRoute } from "@tanstack/react-router";
import { ResetPasswordForm } from "./-components/reset-password-form";

export const Route = createFileRoute("/_auth/reset-password")({
  component: RouteComponent,
});

function RouteComponent() {
  const { config, publicURL } = Route.useRouteContext();
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-4">
      <ResetPasswordForm appName={config.appName} publicURL={publicURL} />
    </div>
  );
}
