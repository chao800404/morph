import authClient from "@/auth/authClient";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { resetPasswordClientSchema } from "@/lib/validations/auth";
import { setVerifyAccessCookieServerFn } from "@/server/auth/verify-access.serverFn";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { CheckPasswordForm } from "./check-password-form";
import { CountdownText } from "./countdown-text";
import { OTPForm } from "./otp-form";

interface VerifyFormProps {
  email: string;
  publicURL: string;
  expiresAt: number;
}

const otpVariants = {
  base: {
    y: 0,
    opacity: 1,
    transition: {
      y: { stiffness: 1000, velocity: -100 },
    },
  },
  success: {
    y: -15,
    scale: 0.9,
    opacity: 0.5,
    rotateX: 15,
    transition: {
      y: { stiffness: 1000 },
    },
  },
};

export function VerifyForm({ email, publicURL, expiresAt }: VerifyFormProps) {
  const navigate = useNavigate();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [pending, setPending] = useState(false);
  const [otp, setOtp] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(() => {
    return expiresAt - Date.now() <= 0;
  });

  const handleResendCode = async () => {
    setPending(true);
    setError(null);

    try {
      const { data, error } = await authClient(
        publicURL,
      ).emailOtp.sendVerificationOtp({
        email,
        type: "forget-password",
      });

      if (error) {
        setError(error.message || "Failed to resend code");
      } else if (data) {
        await setVerifyAccessCookieServerFn({ data: email });
        router.invalidate();
        setError(null);
        setIsExpired(false);
        toast.success("Verification code resent successfully!", {
          description: "The code is valid for 5 minutes",
          position: "top-center",
        });
      }
    } catch (err) {
      setError("Failed to resend code");
    } finally {
      setPending(false);
    }
  };

  const handleActionCode = async (formData: FormData) => {
    setError(null);
    setPending(true);

    const otpValue = formData.get("otp") as string;

    try {
      const { error: authError } = await authClient(
        publicURL,
      ).emailOtp.checkVerificationOtp({
        email,
        type: "forget-password",
        otp: otpValue,
      });

      if (authError) {
        setError(
          authError.message || "Invalid verification code. Please try again.",
        );
        setPending(false);
        return;
      }

      // OTP verified successfully
      console.log("[Security] OTP verified successfully for:", email);
      setOtp(otpValue);
      setPending(false);
    } catch (err) {
      console.error("[Security] OTP verification error:", err);
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred",
      );
      setPending(false);
    }
  };

  const handleActionResetPassword = async (formData: FormData) => {
    setError(null);
    setPending(true);

    const newPassword = formData.get("password") as string;
    const confirmNewPassword = formData.get("confirm-password") as string;

    if (!otp) {
      setError("[Security] OTP verification missing");
      setPending(false);
      return;
    }

    // Validate form data
    const validation = resetPasswordClientSchema.safeParse({
      newPassword,
      confirmNewPassword,
    });

    if (!validation.success) {
      const firstError = validation.error.issues[0];
      setError(firstError.message);
      setPending(false);
      return;
    }

    try {
      const { error: authError } = await authClient(
        publicURL,
      ).emailOtp.resetPassword({
        email,
        otp,
        password: validation.data.newPassword,
      });

      if (authError)
        throw new Error(authError.message || "Password reset failed");

      // Success - clear sensitive data and show dialog
      console.log("[Security] Password reset successful for:", email);
      setOtp(null); // Clear OTP from state
      setOpenDialog(true);
      setPending(false);
    } catch (err) {
      console.error("[Security] Password reset error:", err);
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred",
      );
      setPending(false);
    }
  };

  return (
    <motion.div
      style={{ perspective: "1000px" }}
      animate={!!otp ? "success" : "base"}
      className="max-w-[320px] w-full relative"
      transition={{ type: "inertia" }}
    >
      <motion.div variants={otpVariants} className="w-full">
        <Card
          className={cn(
            "px-5 py-8 border-none shadow-none transition-all",
            `${otp ? "inset-shadow-2xs relative z-10 bg-background shadow-sm duration-150 inset-shadow-muted-foreground" : null}`,
          )}
          style={{
            transformStyle: "preserve-3d",
          }}
        >
          <OTPForm
            onSubmit={(e) => {
              e.preventDefault();
              handleActionCode(new FormData(e.currentTarget));
            }}
            error={!otp ? error : undefined}
            isExpired={isExpired}
            onResend={handleResendCode}
            disabled={pending}
          />
          <p className="text-center text-xs text-muted-foreground mt-3">
            Code expires in{" "}
            <CountdownText
              initialSeconds={Math.max(
                0,
                Math.floor((expiresAt - Date.now()) / 1000),
              )}
              format="mm:ss"
              onComplete={() => {
                setIsExpired(true);
                setError(
                  "Verification code has expired. Please request a new code.",
                );
              }}
            />
          </p>
        </Card>
      </motion.div>
      <AnimatePresence>
        {!!otp && (
          <motion.div
            initial={{ opacity: 0, y: "100px" }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="absolute top-10 left-0 w-full h-full z-30"
          >
            <Card
              className={cn(
                "px-5 py-8 ring ring-muted-foreground/30 shadow-xl border-none",
                !!otp ? "" : null,
              )}
            >
              <CheckPasswordForm
                pending={pending}
                error={!!otp ? error : undefined}
                isExpired={isExpired}
                onResend={handleResendCode}
                expiresAt={expiresAt}
                setIsExpired={setIsExpired}
                action={(formData) => handleActionResetPassword(formData)}
              />
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={cn(
          "text-sm text-muted-foreground text-center space-y-1",
          !!otp ? "mt-8" : "mt-5",
        )}
      >
        <p>
          Didn&apos;t receive the code? -{" "}
          <button
            type="button"
            onClick={handleResendCode}
            disabled={pending}
            className="underline cursor-pointer text-blue-400 hover:text-blue-500 disabled:opacity-50"
          >
            resend
          </button>
        </p>
        <p className="text-xs">
          Please check your spam folder if you haven&apos;t received the email.
        </p>
      </div>

      <AlertDialog open={openDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Password Reset Successful!!</AlertDialogTitle>
            <AlertDialogDescription>
              <CountdownText
                prefix="Your password has been successfully reset. You can now sign in with your new password. You
                            will be redirected to the sign-in page in"
                suffix="seconds."
                onComplete={() => navigate({ to: "/sign-in" as any })}
                initialSeconds={5}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              onClick={() => navigate({ to: "/sign-in" as any })}
              variant="outline"
            >
              Go to Sign In
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
