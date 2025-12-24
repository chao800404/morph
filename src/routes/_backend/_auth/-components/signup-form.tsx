import { LogoF } from "@/components/logo/logo";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { FieldDescription, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  safeEmailSchema,
  safeNameSchema,
  safePasswordSchema,
} from "@/lib/validations/common";
import { createFirstAdminServerFn } from "@/server/auth/create-first-admin.serverFn";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { FieldInfo } from "./fieldInfo";
import { PasswordInput } from "./password-input";
import { SubmitButton } from "./submit-button";

interface SignupFormProps {}

export function SignupForm({}: SignupFormProps = {}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { Field, handleSubmit, Subscribe } = useForm({
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },

    onSubmit: async ({ value }) => {
      setPending(true);
      try {
        // Validate passwords match
        if (value.password !== value.confirmPassword) {
          throw new Error("Passwords do not match");
        }

        // Convert to FormData for server function
        const formData = new FormData();
        formData.append("name", value.name);
        formData.append("email", value.email);
        formData.append("password", value.password);
        formData.append("confirmPassword", value.confirmPassword);

        const result = await createFirstAdminServerFn({ data: formData });
        if (result.success) {
          router.invalidate();
        } else {
          setError(result.message);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Signup failed");
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
          <h3 className="text-xl font-bold">Create Super Admin</h3>
          <p className="text-sm font-light text-foreground/80">
            Set up your first administrator account
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
          name="name"
          validators={{
            onSubmit: ({ value }) => {
              const result = safeNameSchema.safeParse(value);
              if (!result.success) {
                return result.error.issues[0]?.message || "Invalid name";
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
                  type="text"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="Full Name"
                  autoFocus
                  autoComplete="name"
                  aria-invalid={hasError}
                />
                <FieldInfo field={field} />
              </div>
            );
          }}
        />

        <Field
          name="email"
          validators={{
            onSubmit: ({ value }) => {
              const result = safeEmailSchema.safeParse(value);
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
                  placeholder="Admin Email"
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
              const result = safePasswordSchema.safeParse(value);
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
                <PasswordInput
                  disabled={pending}
                  name={field.name}
                  id={field.name}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="Password"
                  autoFocus={!field.state.value}
                  autoComplete="new-password"
                  aria-invalid={hasError}
                />
                <FieldInfo field={field} />
              </div>
            );
          }}
        />

        <Field
          name="confirmPassword"
          validators={{
            onSubmit: ({ value }) => {
              const result = z
                .string()
                .min(1, "Please confirm your password")
                .safeParse(value);
              if (!result.success) {
                return (
                  result.error.issues[0]?.message || "Please confirm password"
                );
              }
              return undefined;
            },
          }}
          children={(field) => {
            const hasError = field.state.meta.errors.length > 0;
            return (
              <div className="space-y-1">
                <PasswordInput
                  disabled={pending}
                  name={field.name}
                  id={field.name}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="Confirm Password"
                  autoComplete="new-password"
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
                name="Create Super Admin"
                canSubmit={canSubmit}
                isLoading={isSubmitting || pending}
              />
            )}
          />
          <FieldDescription className="px-6 text-center text-xs text-muted-foreground">
            This account will have full administrative privileges
          </FieldDescription>
        </FieldGroup>
      </form>
    </div>
  );
}
