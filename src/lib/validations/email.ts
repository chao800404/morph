import z from "zod";

export const sendPasswordResetEmailSchema = z.object({
  email: z.string().email("Invalid email address"),
  otp: z
    .string()
    .length(6, "OTP must be exactly 6 digits")
    .regex(/^\d{6}$/, "OTP must contain only numbers"),
});
