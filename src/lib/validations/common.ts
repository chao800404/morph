import { z } from "zod";

// 可重用的验证工具函数
const createSafeStringSchema = (options: {
  minLength?: number;
  maxLength?: number;
  allowSpaces?: boolean;
  allowChinese?: boolean;
  allowNumbers?: boolean;
  allowSpecialChars?: boolean;
  fieldName?: string;
}) => {
  const {
    minLength = 1,
    maxLength = 100,
    allowSpaces = true,
    allowChinese = true,
    allowNumbers = true,
    allowSpecialChars = false,
    fieldName = "Field",
  } = options;

  // 构建字符集正则表达式
  // Note: Special characters must be ordered correctly in character class
  // The dash (-) must be escaped or placed at the end to avoid being interpreted as a range
  let charPattern = "[a-zA-Z";
  if (allowNumbers) charPattern += "0-9";
  if (allowSpaces) charPattern += "\\s";
  if (allowChinese) charPattern += "\\u4e00-\\u9fa5";
  if (allowSpecialChars) {
    // Place dash at the end or escape it to avoid range interpretation
    charPattern += "_@.";
    charPattern += "-"; // Place dash at the end
  }
  charPattern += "]+";

  return z
    .string()
    .min(minLength, `${fieldName} is required`)
    .max(maxLength, `${fieldName} too long (maximum ${maxLength} characters)`)
    .transform((val) => val.trim()) // 移除首尾空格
    .transform((val) => val.replace(/[<>]/g, "")) // 移除危险字符 < >
    .transform((val) => val.replace(/javascript:/gi, "")) // 移除 javascript: 协议
    .transform((val) => val.replace(/on\w+=/gi, "")) // 移除事件处理器
    .pipe(
      z
        .string()
        .min(
          minLength,
          `${fieldName} cannot be empty after cleaning. If you only entered special characters like <, >, javascript:, or event handlers, they will be removed for security reasons. Please use valid characters instead.`,
        ),
    )
    .refine((val) => new RegExp(`^${charPattern}$`).test(val), {
      message: `${fieldName} contains invalid characters. Please avoid using <, >, javascript:, and event handlers (onclick, onload, etc.). Only letters, numbers, spaces, and Chinese characters are allowed.`,
    });
};

// 预定义的验证模式
export const safeNameSchema = createSafeStringSchema({
  minLength: 1,
  maxLength: 50,
  allowSpaces: true,
  allowChinese: true,
  allowNumbers: true,
  allowSpecialChars: false,
  fieldName: "Name",
});

export const safeTitleSchema = createSafeStringSchema({
  minLength: 1,
  maxLength: 100,
  allowSpaces: true,
  allowChinese: true,
  allowNumbers: true,
  allowSpecialChars: true,
  fieldName: "Title",
});

export const safeDescriptionSchema = createSafeStringSchema({
  minLength: 0,
  maxLength: 500,
  allowSpaces: true,
  allowChinese: true,
  allowNumbers: true,
  allowSpecialChars: true,
  fieldName: "Description",
});

export const safeUsernameSchema = createSafeStringSchema({
  minLength: 3,
  maxLength: 30,
  allowSpaces: false,
  allowChinese: false,
  allowNumbers: true,
  allowSpecialChars: true,
  fieldName: "Username",
});

export const safeContentSchema = createSafeStringSchema({
  minLength: 0,
  maxLength: 10000,
  allowSpaces: true,
  allowChinese: true,
  allowNumbers: true,
  allowSpecialChars: true,
  fieldName: "Content",
});

export const safeTagSchema = createSafeStringSchema({
  minLength: 1,
  maxLength: 20,
  allowSpaces: false,
  allowChinese: true,
  allowNumbers: true,
  allowSpecialChars: true,
  fieldName: "Tag",
});

/**
 * Standardized email validation schema
 * Provides consistent email validation with normalization across the application
 */
export const safeEmailSchema = z
  .email("Please enter a valid email address")
  .min(1, "Email is required")
  .toLowerCase()
  .trim();

/**
 * Standardized password validation schema for registration and password changes
 * Requires: minimum 8 characters, at least one uppercase, one lowercase, and one number
 */
export const safePasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/\d/, "Password must contain at least one number");

/**
 * Minimal password validation for login
 * Only checks that password is not empty
 */
export const loginPasswordSchema = z.string().min(1, "Password is required");
