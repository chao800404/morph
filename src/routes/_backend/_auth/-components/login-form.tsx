import authClient from "@/auth/authClient";
import { LogoF } from "@/components/logo/logo";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldDescription, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { loginSchema } from "@/lib/validations/auth";
import { useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { FieldInfo } from "./fieldInfo";
import { SubmitButton } from "./submit-button";

interface LoginFormProps {
  appName?: string;
  defaultEmail?: string;
  publicURL?: string;
  callbackURL?: string;
}

export function LoginForm({
  appName,
  defaultEmail = "",
  publicURL,
  callbackURL = "/dashboard",
}: LoginFormProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { Field, handleSubmit, Subscribe } = useForm({
    defaultValues: {
      email: defaultEmail,
      password: "",
    },
    onSubmit: async ({ value }) => {
      setPending(true);
      try {
        if (!publicURL) throw new Error("Public URL is not provided");

        const result = await authClient(publicURL).signIn.email({
          email: value.email,
          password: value.password,
          callbackURL: callbackURL,
        });

        if (result.error) {
          throw new Error(result.error.message);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Login failed");
      } finally {
        setPending(false);
      }
    },
  });

  return (
    <div className="max-w-[280px] w-full">
      <div className="text-center flex flex-col gap-3 mb-3">
        <Link className="mb-2 mx-auto" to={"/dashboard" as any}>
          <LogoF />
        </Link>
        <div className="space-y-0.5">
          <h3 className="text-xl">
            {appName ? `Welcome to ${appName}` : "Welcome back"}
          </h3>
          <p className="text-sm font-light text-foreground/80">
            Sign in to your account
          </p>
        </div>
      </div>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        {error && (
          <Alert className="mb-5" variant="destructive">
            <AlertCircle />
            <AlertDescription className="text-sm text-destructive">
              {error}
            </AlertDescription>
          </Alert>
        )}

        <Field
          name="email"
          validators={{
            onSubmit: ({ value }) => {
              const result = loginSchema.shape.email.safeParse(value);
              if (!result.success) {
                return result.error.issues[0]?.message || "Invalid email";
              }
              return undefined;
            },
          }}
          children={(field) => {
            const hasError = field.state.meta.errors.length > 0;
            return (
              <div className="space-y-1">
                <Input
                  disabled={pending}
                  name={field.name}
                  id={field.name}
                  type="email"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="Email"
                  autoFocus={!field.state.value}
                  autoComplete="email"
                  aria-invalid={hasError}
                />
                <FieldInfo field={field} />
              </div>
            );
          }}
        />
        <Field
          name="password"
          validators={{
            onSubmit: ({ value }) => {
              const result = loginSchema.shape.password.safeParse(value);
              if (!result.success) {
                return result.error.issues[0]?.message || "Invalid password";
              }
              return undefined;
            },
          }}
          children={(field) => {
            const hasError = field.state.meta.errors.length > 0;
            return (
              <div className="space-y-1">
                <Input
                  disabled={pending}
                  name={field.name}
                  id={field.name}
                  type="password"
                  value={field.state.value}
                  autoFocus={!!defaultEmail}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="Password"
                  autoComplete="current-password"
                  aria-invalid={hasError}
                />
                <FieldInfo field={field} />
              </div>
            );
          }}
        />

        <FieldGroup className="mt-4">
          <Subscribe
            selector={(state) => [state.canSubmit, state.isSubmitting]}
            children={([canSubmit, isSubmitting]) => (
              <SubmitButton
                name="Sign In"
                canSubmit={canSubmit}
                isLoading={isSubmitting || pending}
              />
            )}
          />
          <FieldDescription className="px-6 text-center text-xs text-muted-foreground">
            Forgot password? -
            <Link
              to={"/reset-password"}
              className="text-blue-500 font-medium ml-1 underline-offset-0"
            >
              Reset
            </Link>
          </FieldDescription>
        </FieldGroup>
      </form>
    </div>
  );
}
