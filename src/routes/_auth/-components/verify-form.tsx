"use client";

import authClient from "@/auth/authClient";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { CheckPasswordForm } from "./check-password-form";
import { CountdownText } from "./countdown-text";
import { OTPForm } from "./otp-form";

interface VerifyFormProps {
  email: string;
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

export function VerifyForm({ email }: VerifyFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [pending, setPending] = useState(false);
  const [otp, setOtp] = useState<string | null>(null);

  const handleResendCode = async () => {
    setPending(true);
    setError(null);

    try {
      const { data, error } = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "forget-password",
      });

      if (error) {
        setError(error.message || "Failed to resend code");
      } else if (data) {
        setError(null);
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

    const otp = formData.get("otp") as string;

    try {
      const { data, error } = await authClient.emailOtp.checkVerificationOtp({
        email,
        type: "forget-password",
        otp,
      });

      if (error) {
        // Better Auth handles rate limiting and attempt tracking
        setError(
          error.message || "Invalid verification code. Please try again.",
        );
        setPending(false);
        return;
      }

      // OTP verified successfully
      console.log("[Security] OTP verified successfully for:", email);
      setOtp(otp);
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
      setError("[Security] OTP verification error");
      return;
    }

    // Validate form data
    const validation = resetPasswordClientSchema.safeParse({
      newPassword,
      confirmNewPassword,
    });

    if (!validation.success) {
      // Get the first error message
      const firstError = validation.error.issues[0];
      setError(firstError.message);
      setPending(false);
      return;
    }

    try {
      const { data, error } = await authClient.emailOtp.resetPassword({
        email,
        otp,
        password: validation.data.newPassword,
      });

      if (error) throw new Error(error.message || "Password reset failed");

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
          <OTPForm action={handleActionCode} error={!otp ? error : undefined} />
          <p className="text-center text-xs text-muted-foreground mt-3">
            Code expires in{" "}
            <CountdownText
              initialSeconds={300}
              format="mm:ss"
              onComplete={() => {
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
                `${!!otp ? "" : null}`,
              )}
            >
              <CheckPasswordForm
                pending={pending}
                error={!!otp ? error : undefined}
                action={handleActionResetPassword}
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
                onComplete={() => router.push("/auth/sign-in")}
                initialSeconds={5}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button onClick={() => router.push("/auth/sign-in")} variant="form">
              Go to Sign In
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
