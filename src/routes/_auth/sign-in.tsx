import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { LoginForm } from "./-components/login-form";

const SearchSchema = z.object({
  email: z.email().optional(),
  callbackURL: z.string().optional(),
});

export const Route = createFileRoute("/_auth/sign-in")({
  validateSearch: (search: unknown): z.infer<typeof SearchSchema> =>
    SearchSchema.parse(search),
  beforeLoad: async ({ context }) => {
    const session = context.session;
    if (session) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: Page,
});

function Page() {
  const { config, publicURL } = Route.useRouteContext();
  const search = Route.useSearch();

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-4">
      <LoginForm
        appName={config.appName}
        defaultEmail={search.email}
        callbackURL={search.callbackURL}
        publicURL={publicURL}
      />
    </div>
  );
}
