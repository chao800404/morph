export type AssetFieldErrors = Record<string, string[]>;

export interface AssetActionResult {
  success: boolean;
  message: string;
  description?: string;
  errors?: AssetFieldErrors;
  redirectPath?: string | null;
}

export type AssetFormAction<
  TResult extends AssetActionResult = AssetActionResult,
> = (options: { data: FormData }) => Promise<TResult>;

export const getActionErrorMessage = (
  error: unknown,
  fallback = "Operation failed",
): string => {
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message);
      if (Array.isArray(parsed) && typeof parsed[0]?.message === "string") {
        return parsed[0].message;
      }
    } catch {
      // The error message is not serialized validation output.
    }

    return error.message || fallback;
  }

  return fallback;
};
