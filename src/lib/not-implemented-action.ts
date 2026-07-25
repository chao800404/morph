import type { AssetFormAction } from "./asset/action-result";

/**
 * Placeholder submit handler for dashboard views whose server side does not
 * exist yet.
 *
 * These views previously returned `{ success: true }` without writing anything,
 * so the dialog closed and showed a success toast for a save that never
 * happened. Failing loudly is the only honest behaviour until the matching
 * schema, DAL and server function are built.
 */
export const notImplementedAction =
  (feature: string): AssetFormAction =>
  async () => ({
    success: false,
    message: `${feature} is not available yet.`,
    description: "Nothing was saved. This view has no server implementation.",
  });
