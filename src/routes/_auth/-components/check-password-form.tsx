import { LogoF } from "@/components/logo/logo";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldGroup } from "@/components/ui/field";
import { safePasswordSchema } from "@/lib/validations/common";
import { useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { AlertCircleIcon } from "lucide-react";
import { CountdownText } from "./countdown-text";
import { FieldInfo } from "./fieldInfo";
import { PasswordInput } from "./password-input";
import { SubmitButton } from "./submit-button";

type Props = {
  pending?: boolean;
  error?: string | null;
  isExpired?: boolean;
  onResend?: () => void;
  expiresAt: number;
  setIsExpired: (val: boolean) => void;
  action: (formData: FormData) => void;
};

export const CheckPasswordForm = ({
  pending,
  error,
  isExpired,
  onResend,
  expiresAt,
  setIsExpired,
  action,
}: Props) => {
  const { Field, handleSubmit, Subscribe } = useForm({
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
    onSubmit: async ({ value }) => {
      const formData = new FormData();
      formData.append("password", value.password);
      formData.append("confirm-password", value.confirmPassword);
      action(formData);
    },
  });

  return (
    <div className="max-w-[280px] w-full">
      <div className="text-center flex flex-col gap-3 mb-8">
        <Link className="mb-2 mx-auto" to={"/dashboard"}>
          <LogoF />
        </Link>
        <div className="space-y-0.5">
          <h3 className="text-xl">Set New Password</h3>
          <p className="text-xs font-light text-muted-foreground">
            Password must be at least 8 characters and contain at least one
            letter
          </p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleSubmit();
        }}
        className="flex flex-col gap-2"
      >
        {error && (
          <Alert className="mb-5" variant="destructive">
            <AlertCircleIcon />
            <AlertDescription className="text-xs text-destructive">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {!isExpired && (
          <>
            <Field
              name="password"
              validators={{
                onSubmit: ({ value }) => {
                  const result = safePasswordSchema.safeParse(value);
                  if (!result.success) {
                    return (
                      result.error.issues[0]?.message || "Invalid password"
                    );
                  }
                  return undefined;
                },
              }}
              children={(field) => (
                <div className="space-y-1">
                  <PasswordInput
                    disabled={pending}
                    name={field.name}
                    id={field.name}
                    placeholder="New Password"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                  <FieldInfo field={field} />
                </div>
              )}
            />

            <Field
              name="confirmPassword"
              validators={{
                onSubmit: ({ value, fieldApi }) => {
                  if (value !== fieldApi.form.getFieldValue("password")) {
                    return "Passwords do not match";
                  }
                  return undefined;
                },
              }}
              children={(field) => (
                <div className="space-y-1">
                  <PasswordInput
                    disabled={pending}
                    name={field.name}
                    id={field.name}
                    placeholder="Confirm New Password"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                  <FieldInfo field={field} />
                </div>
              )}
            />
          </>
        )}

        <FieldGroup className="mt-5">
          {isExpired ? (
            <SubmitButton
              type="button"
              onClick={onResend}
              canSubmit={true}
              name="Resend Code"
              isLoading={pending}
            />
          ) : (
            <>
              <Subscribe
                selector={(state) => [state.canSubmit, state.isSubmitting]}
                children={([canSubmit, isSubmitting]) => (
                  <SubmitButton
                    name="Set Password"
                    canSubmit={canSubmit}
                    isLoading={isSubmitting || pending}
                  />
                )}
              />
              <p className="text-center text-xs text-muted-foreground mt-3">
                Link expires in{" "}
                <CountdownText
                  initialSeconds={Math.max(
                    0,
                    Math.floor((expiresAt - Date.now()) / 1000),
                  )}
                  format="mm:ss"
                  onComplete={() => {
                    setIsExpired(true);
                  }}
                />
              </p>
            </>
          )}
        </FieldGroup>
      </form>
    </div>
  );
};
