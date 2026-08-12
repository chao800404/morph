import { LogoF } from "@/components/logo/logo";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  acceptDashboardInvite,
  getDashboardInvite,
} from "@/server/auth/invites.serverFn";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { z } from "zod";

const inviteSearchSchema = z.object({ token: z.string().catch("") });

export const Route = createFileRoute("/_backend/_auth/invite")({
  validateSearch: inviteSearchSchema,
  beforeLoad: ({ context }) => {
    if (context.session?.user) throw redirect({ to: "/dashboard" });
  },
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: ({ deps }) =>
    deps.token
      ? getDashboardInvite({ data: { token: deps.token } })
      : Promise.resolve({
          success: false as const,
          message: "Invitation token is missing",
        }),
  component: InviteAcceptance,
});

function InviteAcceptance() {
  const invite = Route.useLoaderData();
  const { token } = Route.useSearch();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await acceptDashboardInvite({
        data: { token, name, password, confirmPassword },
      });
      if (!result.success) {
        setError(result.message);
        return;
      }
      setAccepted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invitation failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <div className="bg-card w-full max-w-sm rounded-xl border p-6 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="size-16 shadow-2xs">
            <LogoF />
          </div>
          <div>
            <h1 className="text-xl font-bold">Accept invitation</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {invite.success
                ? `Create your account for ${invite.data.email}`
                : invite.message}
            </p>
          </div>
        </div>

        {accepted ? (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="mx-auto size-10 text-emerald-500" />
            <p className="text-sm">Your account has been created.</p>
            <Button asChild className="w-full">
              <Link to="/sign-in">Continue to sign in</Link>
            </Button>
          </div>
        ) : invite.success ? (
          <form onSubmit={submit} className="space-y-3">
            {error && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )}
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Full name"
              autoComplete="name"
              autoFocus
              required
            />
            <Input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              placeholder="Password"
              autoComplete="new-password"
              required
            />
            <Input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              placeholder="Confirm password"
              autoComplete="new-password"
              required
            />
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Creating account..." : "Create account"}
            </Button>
          </form>
        ) : (
          <Button asChild variant="outline" className="w-full">
            <Link to="/sign-in">Back to sign in</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
