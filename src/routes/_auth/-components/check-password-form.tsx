import { LogoF } from "@/components/logo/logo";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { FieldGroup } from "@/components/ui/field";
import { AlertCircleIcon } from "lucide-react";
import { useState } from "react";
import { PasswordInput } from "./password-input";
import { SubmitButton } from "./submit-button";

type Props = {
  pending?: boolean;
  error?: string | null;
  action: (formData: FormData) => void;
};

export const CheckPasswordForm = ({ pending, error, action }: Props) => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const isPasswordValid = password.length >= 8;
  const isMatch = password === confirmPassword;
  const canSubmit = isPasswordValid && isMatch;

  return (
    <div className="max-w-[280px] w-full">
      <div className="text-center flex flex-col gap-3 mb-8">
        <div className="w-16 h-16 shadow-2xs mx-auto">
          <LogoF />
        </div>
        <div className="space-y-0.5">
          <h3 className="text-xl">Set New Password</h3>
          <p className="text-sm font-light text-muted-foreground">
            Password must be at least 8 characters and contain at least one
            letter
          </p>
        </div>
      </div>
      <form action={action} className="flex flex-col gap-2">
        {error && (
          <Alert className="mb-5" variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        )}

        <PasswordInput
          disabled={pending}
          name="password"
          id="password"
          type="password"
          placeholder="New Password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <PasswordInput
          disabled={pending}
          name="confirm-password"
          id="confirm-password"
          type="password"
          placeholder="Confirm New Password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        {!isMatch && confirmPassword.length > 0 && (
          <p className="text-xs text-destructive text-center">
            Passwords do not match
          </p>
        )}
        <FieldGroup className="mt-5">
          <SubmitButton canSubmit={canSubmit} name="Set Password" />
        </FieldGroup>
      </form>
    </div>
  );
};
