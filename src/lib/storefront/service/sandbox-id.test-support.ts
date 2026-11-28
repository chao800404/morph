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
