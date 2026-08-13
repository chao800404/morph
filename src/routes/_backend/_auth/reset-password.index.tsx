import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ResetPasswordForm } from "./-components/reset-password-form";

export const Route = createFileRoute("/_backend/_auth/reset-password/")({
  validateSearch: z.object({
    email: z.string().optional(),
  }),
  component: RouteComponent,
});

function RouteComponent() {
  return <ResetPasswordForm />;
}
