import { checkHasAdminServerFn } from "@/server/auth/check-has-admin.serverFn";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { SignupForm } from "./-components/signup-form";

export const Route = createFileRoute("/_auth/create-first-admin")({
  component: RouteComponent,
  beforeLoad: async ({ context }) => {
    const hasAdmin = await checkHasAdminServerFn();
    if (hasAdmin || context.session?.user) throw redirect({ to: "/sign-in" });
    return null;
  },
});

function RouteComponent() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-4">
      <SignupForm />
    </div>
  );
}
