import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  loginPasswordSchema,
  safeEmailSchema,
  safeNameSchema,
  safePasswordSchema,
} from "./common";

/**
 * Email validation schema
 * Used for validating email addresses across authentication flows
 */
export const emailSchema = z.object({
  email: safeEmailSchema,
});

/**
 * Email validation schema for FormData
 * Ready to use in server actions without additional wrapping
 */
export const emailFormSchema = zfd.formData({
  email: zfd.text(safeEmailSchema),
});

// Login validation schema
export const loginSchema = z.object({
  email: safeEmailSchema,
  password: loginPasswordSchema,
});

export const loginFormSchema = zfd.formData({
  email: zfd.text(safeEmailSchema),
  password: zfd.text(loginPasswordSchema),
  callbackUrl: zfd.text(z.string().optional()),
});

// Registration validation schema
export const registerSchema = zfd.formData({
  email: safeEmailSchema,
  username: z.string().min(1, "Username is required"),
  password: safePasswordSchema,
});

// Password change validation
export const changePasswordSchema = z
  .object({
    currentPassword: safePasswordSchema,
    newPassword: safePasswordSchema,
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "New passwords don't match",
    path: ["confirmNewPassword"],
  });

// Email change validation
export const changeEmailSchema = z.object({
  email: safeEmailSchema,
  newEmail: safeEmailSchema,
  password: safePasswordSchema,
});

// Forgot password validation
export const forgotPasswordSchema = z.object({
  email: safeEmailSchema,
});

/**
 * Client-side validation schema for password reset
 */
export const resetPasswordClientSchema = z
  .object({
    newPassword: safePasswordSchema,
    confirmNewPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords do not match",
    path: ["confirmNewPassword"],
  });

// Admin info update validation
export const adminInfoUpdateSchema = z.object({
  name: safeNameSchema,
});

/**
 * Admin info update validation schema for FormData
 * Ready to use in server actions without additional wrapping
 */
export const adminInfoUpdateFormSchema = zfd.formData({
  name: zfd.text(safeNameSchema),
});

/**
 * User profile update validation schema
 */
export const profileSchema = zfd.formData({
  name: zfd.text(safeNameSchema),
  language: zfd.text().optional(),
  phone: zfd.text(z.string().optional()).transform((val, ctx) => {
    if (!val || val.length === 0) return null;
    const phoneNumber = parsePhoneNumberFromString(val);
    if (!phoneNumber?.isValid()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid phone number",
      });
      return z.NEVER;
    }
    return phoneNumber.formatInternational();
  }),
});

// Create first admin validation
export const createFirstAdminSchema = zfd
  .formData({
    name: safeNameSchema,
    email: safeEmailSchema,
    password: safePasswordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

/**
 * Create first admin validation schema for FormData
 * Ready to use in server actions without additional wrapping
 */
export const createFirstAdminFormSchema = zfd
  .formData({
    name: zfd.text(safeNameSchema),
    email: zfd.text(safeEmailSchema),
    password: zfd.text(safePasswordSchema),
    confirmPassword: zfd.text(
      z.string().min(1, "Please confirm your password"),
    ),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// Export types
export type EmailInput = z.infer<typeof emailSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ChangeEmailInput = z.infer<typeof changeEmailSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordClientInput = z.infer<
  typeof resetPasswordClientSchema
>;
export type CreateFirstAdminInput = z.infer<typeof createFirstAdminSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
