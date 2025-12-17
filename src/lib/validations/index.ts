// Re-export all validation schemas
export * from "./asset";
export * from "./auth";
export * from "./common";
export * from "./form";

// Common validation utilities
export const createErrorResponse = (message: string, error?: string) => ({
    success: false as const,
    message,
    data: null,
    error: error || "VALIDATION_ERROR",
});

export const createSuccessResponse = <T>(message: string, data: T) => ({
    success: true as const,
    message,
    data,
});
