import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ResetPasswordForm } from "./-components/reset-password-form";

export const Route = createFileRoute("/_backend/_auth/reset-password/")({
  validateSearch: z.object({
    email: z.string().optional(),
  }),
  component: RouteComponent,
});

import { getConfig } from "@/cms.config";

function RouteComponent() {
  const { publicURL } = Route.useRouteContext();
  const config = getConfig().client;
  return <ResetPasswordForm appName={config.appName} publicURL={publicURL} />;
}
