import { TopLoader } from "@/components/top-loader/top-loader";
import { sanitizeReturnPath } from "@/lib/auth/return-path";
import { IdleTimerProvider } from "@/components/provider/idle-timer-provider";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { getConfig } from "@/server/get-config";
import { getSession } from "@/server/auth/getSession";
import {
  createFileRoute,
  type ErrorComponentProps,
  Link,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { ThemeProvider } from "tanstack-theme-kit";

export const Route = createFileRoute("/_editor")({
  beforeLoad: async ({ location }) => {
    const session = await getSession();
    if (!session?.user) {
      // See the dashboard guard: the editor path is the one worth restoring,
      // since getting back to a specific theme/template is several clicks.
      throw redirect({
        to: "/sign-in",
        search: { callbackURL: sanitizeReturnPath(location.href) ?? undefined },
      });
    }
    return { session };
  },
  component: EditorLayout,
  errorComponent: EditorError,
});

function EditorLayout() {
  const { publicURL } = Route.useRouteContext();
  const config = getConfig().client;

  return (
    <ThemeProvider disableTransitionOnChange>
      <IdleTimerProvider
        publicURL={publicURL}
        enabled={config.auth?.autoLogout?.enabled ?? true}
        timeout={config.auth?.autoLogout?.timeout ?? 30}
        promptBeforeIdle={config.auth?.autoLogout?.promptBeforeIdle ?? 25}
      >
        <TopLoader ignoreSearchOnly />
        <div className="min-h-svh bg-background text-foreground">
          <Outlet />
        </div>
        <Toaster />
      </IdleTimerProvider>
    </ThemeProvider>
  );
}

function EditorError({ reset }: ErrorComponentProps) {
  return (
    <ThemeProvider disableTransitionOnChange>
      <main className="flex h-svh items-center justify-center bg-background p-6 text-foreground">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold">Theme editor unavailable</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            The editor could not load this storefront theme. Retry the request
            or return to Online Store.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={reset}>
              Retry
            </Button>
            <Button size="sm" asChild>
              <Link to="/dashboard/$slug" params={{ slug: "online-store" }}>
                Online Store
              </Link>
            </Button>
          </div>
        </div>
      </main>
    </ThemeProvider>
  );
}
