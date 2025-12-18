import { checkVerifyAccessServerFn } from "@/server/auth/verify-access.serverFn";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { VerifyForm } from "./-components/verify-form";

export const Route = createFileRoute("/_auth/reset-password/verify")({
  validateSearch: z.object({
    email: z.string().optional().default(""),
  }),
  beforeLoad: async ({ search }) => {
    const { email: verifiedEmail, expiresAt } =
      await checkVerifyAccessServerFn();

    // If no cookie or email doesn't match the search param, redirect back
    if (!verifiedEmail || (search.email && verifiedEmail !== search.email)) {
      throw redirect({
        to: "/reset-password",
        search: { email: search.email },
      });
    }

    return { verifiedEmail, expiresAt };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { publicURL } = Route.useRouteContext();
  const { verifiedEmail, expiresAt } = Route.useRouteContext(); // Access from context (beforeLoad returns are added to context)

  return (
    <VerifyForm
      key={expiresAt}
      email={verifiedEmail || ""}
      publicURL={publicURL}
      expiresAt={expiresAt || 0}
    />
  );
}
