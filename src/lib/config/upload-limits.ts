/**
 * Client-safe upload limits shared by declarative config and form controls.
 * Keep this module dependency-free: cms.config and pending views are evaluated
 * on both sides and must never reach a server function through it.
 */
export const MAX_ASSETS_PER_RECORD = 50;
