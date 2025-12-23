"use client";

import { useEffect, useCallback } from "react";

interface UseUnsavedChangesWarningOptions {
  hasUnsavedChanges: boolean;
  message?: string;
  shouldWarn?: boolean;
}

/**
 * Hook to warn users when they try to leave the page with unsaved changes
 *
 * @param hasUnsavedChanges - Whether there are unsaved changes
 * @param message - Custom warning message (optional)
 * @param shouldWarn - Whether to show warnings (default: true)
 */
export function useUnsavedChangesWarning({
  hasUnsavedChanges,
  message = "You have unsaved changes. Are you sure you want to leave?",
  shouldWarn = true,
}: UseUnsavedChangesWarningOptions) {
  // Handle browser refresh/close
  useEffect(() => {
    if (!shouldWarn) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        event.preventDefault();
        // Modern browsers ignore custom messages and show their own
        event.returnValue = message;
        return message;
      }
    };

    const handlePopState = () => {
      if (hasUnsavedChanges) {
        const confirmed = window.confirm(message);
        if (!confirmed) {
          // Push the current state back to prevent navigation
          window.history.pushState(null, "", window.location.href);
        }
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [hasUnsavedChanges, message, shouldWarn]);

  // Utility function to manually check for unsaved changes
  const checkUnsavedChanges = useCallback(() => {
    if (hasUnsavedChanges && shouldWarn) {
      return window.confirm(message);
    }
    return true;
  }, [hasUnsavedChanges, message, shouldWarn]);

  return {
    checkUnsavedChanges,
  };
}

/**
 * Simplified version that only handles browser refresh/close
 */
export function useBeforeUnloadWarning(
  hasUnsavedChanges: boolean,
  message?: string
) {
  return useUnsavedChangesWarning({
    hasUnsavedChanges,
    message,
    shouldWarn: true,
  });
}
