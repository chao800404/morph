import type { ThemeCompilerInput } from "./theme-compiler.types";

/**
 * Computes a deterministic string representation of theme virtual filesystem.
 * Files are sorted by path to ensure consistent order regardless of input permutation.
 */
export function serializeCompilerInput(input: ThemeCompilerInput): string {
  const sortedFiles = [...input.files].sort((a, b) => a.path.localeCompare(b.path));
  const payload = {
    version: input.compilerVersion ?? "4.0.0",
    entry: input.entry ?? "src/pages/index.tsx",
    files: sortedFiles.map((f) => ({
      path: f.path,
      content: f.content,
    })),
  };
  return JSON.stringify(payload);
}

/**
 * Fast, synchronous 32-bit FNV-1a hash with hex string output.
 * Guarantees universal execution in any JS environment (Browser, Worker, Node)
 * without requiring asynchronous WebCrypto operations.
 */
export function computeFnv1aHash(str: string): string {
  let hval = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hval ^= str.charCodeAt(i);
    hval +=
      (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
  }
  // Convert to unsigned 32-bit hex
  return (hval >>> 0).toString(16).padStart(8, "0");
}

/**
 * Computes a deterministic input hash for ThemeCompilerInput.
 */
export function computeThemeInputHash(input: ThemeCompilerInput): string {
  const serialized = serializeCompilerInput(input);
  return computeFnv1aHash(serialized);
}
