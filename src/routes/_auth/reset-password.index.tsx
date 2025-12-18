import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ResetPasswordForm } from "./-components/reset-password-form";

export const Route = createFileRoute("/_auth/reset-password/")({
  validateSearch: z.object({
    email: z.string().optional().default(""),
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { config, publicURL } = Route.useRouteContext();
  return <ResetPasswordForm appName={config.appName} publicURL={publicURL} />;
}
