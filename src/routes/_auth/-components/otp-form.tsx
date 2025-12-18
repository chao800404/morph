import { LogoF } from "@/components/logo/logo";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Link } from "@tanstack/react-router";
import { AlertCircleIcon } from "lucide-react";
import { useState } from "react";
import { SubmitButton } from "./submit-button";

export function OTPForm({
  className,
  error,
  isExpired,
  onResend,
  disabled,
  ...props
}: React.ComponentProps<"form"> & {
  error?: string | null;
  isExpired?: boolean;
  onResend?: () => void;
  disabled?: boolean;
}) {
  const [otp, setOtp] = useState("");
  const isPending = disabled;

  return (
    <form {...props}>
      <FieldGroup>
        <div className="flex flex-col items-center gap-2 text-center">
          <Link className="mb-2 mx-auto" to={"/dashboard"}>
            <LogoF />
          </Link>
          <h1 className="text-xl font-bold">Enter verification code</h1>
          <FieldDescription>
            We sent a 6-digit code to your email address
          </FieldDescription>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertDescription className="text-sm text-destructive">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {!isExpired && (
          <Field>
            <FieldLabel htmlFor="otp" className="sr-only">
              Verification code
            </FieldLabel>
            <InputOTP
              maxLength={6}
              id="otp"
              value={otp}
              onChange={setOtp}
              required
              autoFocus
              containerClassName="gap-4"
              name="otp"
              disabled={isExpired}
            >
              <InputOTPGroup className="mx-auto w-full gap-2.5 *:data-[slot=input-otp-slot]:h-10 *:data-[slot=input-otp-slot]:w-10 *:data-[slot=input-otp-slot]:rounded-md *:data-[slot=input-otp-slot]:border *:data-[slot=input-otp-slot]:text-xl">
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </Field>
        )}
        <Field>
          {isExpired ? (
            <SubmitButton
              type="button"
              onClick={onResend}
              canSubmit={true}
              name="Resend Code"
              isLoading={isPending}
            />
          ) : (
            <SubmitButton canSubmit={otp.length === 6} name="Verify" />
          )}
        </Field>
      </FieldGroup>
    </form>
  );
}
