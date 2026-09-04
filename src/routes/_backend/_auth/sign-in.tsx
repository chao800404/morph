import { getConfig } from "@/server/get-config";
import { checkHasAdminServerFn } from "@/server/auth/check-has-admin.serverFn";
import { sanitizeReturnPath } from "@/lib/auth/return-path";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { LoginForm } from "./-components/login-form";

const SearchSchema = z.object({
  email: z.string().email().optional(),
  // Narrowed to a same-origin path at the edge of the app. Better Auth feeds
  // this straight to `window.location.href` after the credentials are accepted
  // and only screens the URL *scheme*, so an absolute URL here would be an open
  // redirect against a user who has just authenticated.
  callbackURL: z.preprocess(
    (value) => sanitizeReturnPath(value) ?? undefined,
    z.string().optional(),
  ),
});

export const Route = createFileRoute("/_backend/_auth/sign-in")({
  validateSearch: (search: unknown): z.infer<typeof SearchSchema> =>
    SearchSchema.parse(search),
  beforeLoad: async ({ context }) => {
    const session = context.session;
    if (session) {
      throw redirect({ to: "/dashboard" });
    }

    const hasAdmin = await checkHasAdminServerFn();
    if (!hasAdmin) {
      throw redirect({ to: "/create-first-admin" });
    }
  },
  component: Page,
});

function Page() {
  const { publicURL } = Route.useRouteContext();
  const config = getConfig().client;
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
