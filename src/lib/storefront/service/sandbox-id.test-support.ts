import { expect } from "vitest";

/**
 * Mirrors `sanitizeSandboxId` in @cloudflare/sandbox (not exported by the
 * package): 1-63 characters, no leading or trailing hyphen, not a reserved
 * name. Morph additionally requires lowercase DNS-label characters, because
 * the id becomes part of a preview hostname.
 */
const RESERVED = [
  "www",
  "api",
  "admin",
  "root",
  "system",
  "cloudflare",
  "workers",
];

export function expectValidSandboxId(id: string): void {
  expect(id.length).toBeGreaterThanOrEqual(1);
  expect(id.length).toBeLessThanOrEqual(63);
  expect(id.startsWith("-")).toBe(false);
  expect(id.endsWith("-")).toBe(false);
  expect(RESERVED).not.toContain(id.toLowerCase());
  expect(id).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
}

/** Non-asserting form of the rule: the reason an id is refused, or null. */
export function sandboxIdViolation(id: string): string | null {
  if (!id || id.length > 63) return "Sandbox ID must be 1-63 characters long.";
  if (id.startsWith("-") || id.endsWith("-"))
    return "Sandbox ID cannot start or end with hyphens (DNS requirement).";
  if (RESERVED.includes(id.toLowerCase()))
    return `Reserved sandbox ID '${id}' is not allowed.`;
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(id))
    return `Sandbox ID '${id}' must be a lowercase DNS label.`;
  return null;
}

/** A fake `getSandbox` that refuses ids exactly as the real SDK would. */
export function validatingGetSandbox<T>(session: T) {
  return async (_binding: unknown, id: string): Promise<T> => {
    const violation = sandboxIdViolation(id);
    if (violation) throw new Error(violation);
    return session;
  };
}
