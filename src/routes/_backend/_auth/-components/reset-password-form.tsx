import authClient from "@/auth/authClient";
import { LogoF } from "@/components/logo/logo";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { FieldDescription, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import { setVerifyAccessCookieServerFn } from "@/server/auth/verify-access.serverFn";
import { useForm } from "@tanstack/react-form";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { FieldInfo } from "./fieldInfo";
import { SubmitButton } from "./submit-button";

interface ResetPasswordFormProps {
  appName?: string;
  publicURL?: string;
}

export function ResetPasswordForm({ publicURL }: ResetPasswordFormProps) {
  const navigate = useNavigate();
  const searchParams = useSearch({ from: "/_backend/_auth/reset-password/" });
  const defaultEmail = searchParams.email || "";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { Field, handleSubmit, Subscribe } = useForm({
    defaultValues: {
      email: defaultEmail,
    },
    onSubmit: async ({ value }) => {
      setPending(true);
      setError(null);

      try {
        if (!publicURL) {
          throw new Error("Public URL is missing. Check your configuration.");
        }
        const { data } = await authClient(publicURL).forgetPassword.emailOtp({
          email: value.email,
        });
        if (data?.success) {
          await setVerifyAccessCookieServerFn({ data: value.email });
          navigate({
            to: "/reset-password/verify",
            search: { email: value.email },
          });
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred",
        );
      } finally {
        setPending(false);
      }
    },
  });

  return (
    <div className="max-w-[280px] w-full">
      <div className="text-center flex flex-col gap-3 mb-3">
        <div className="w-16 h-16 shadow-2xs mx-auto">
          <LogoF />
        </div>
        <div className="space-y-0.5">
          <h3 className="text-xl">Reset Password</h3>
          <p className="text-sm font-light text-foreground/80">
            Enter your email to reset your password
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
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        )}

        <Field
          name="email"
          validators={{
            onSubmit: ({ value }) => {
              const result = forgotPasswordSchema.shape.email.safeParse(value);
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
                  autoFocus
                  autoComplete="email"
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
                name="Reset Password"
                canSubmit={canSubmit}
                isLoading={isSubmitting || pending}
              />
            )}
          />

          <FieldDescription className="px-6 text-center text-xs text-muted-foreground">
            <Link
              to={"/sign-in" as any}
              className="font-medium w-fit underline-offset-0 justify-center"
            >
              Back to Login
            </Link>
          </FieldDescription>
        </FieldGroup>
      </form>
    </div>
  );
}
