import { createHash } from "node:crypto";
import {
  writeSandboxWorkspaceFile,
  type SandboxFileWriter,
} from "./sandbox-file-writer";

/**
 * A development check that a real Cloudflare Sandbox stores what the Theme
 * pipeline writes, byte for byte.
 *
 * Mocks prove what is handed to the SDK; only a container proves what it
 * keeps. So this writes through the same adapter the preview, the build and
 * the deployer use, reads each file back, and compares hashes. It is a
 * write/read check of the transport and nothing more: it does not build, and
 * it does not read from a Theme revision. Rerun it when the SDK changes.
 *
 * Off unless asked for, in three separate ways: never in production, only
 * for an admin, and only with a local flag set, so an ordinary development
 * server does not expose it.
 */

export const SANDBOX_BYTE_ROUNDTRIP_FLAG =
  "MORPH_ENABLE_SANDBOX_BYTE_ROUNDTRIP";

export function sandboxByteRoundTripRefusal(
  vars: Record<string, unknown>,
  isProduction: boolean,
): string | null {
  if (isProduction) return "Never available in production.";
  if (vars[SANDBOX_BYTE_ROUNDTRIP_FLAG] !== "1") {
    return `Disabled. Set ${SANDBOX_BYTE_ROUNDTRIP_FLAG}=1 locally to enable it.`;
  }
  if (!vars.Sandbox) return "No Sandbox binding in this environment.";
  return null;
}

/** The part of a Sandbox this uses. */
export type RoundTripSandbox = SandboxFileWriter & {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  readFile(
    path: string,
    options?: { encoding?: string },
  ): Promise<{ content: string; encoding?: string }>;
};

export type ByteRoundTripCheck = Readonly<{
  name: string;
  sizeBytes: number;
  expectedSha256: string;
  readSha256: string;
  readSizeBytes: number;
  readEncoding: string | null;
  ok: boolean;
  ms: number;
}>;

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Every byte value, many times over; an encoding that mangles one shows. */
function everyByte(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    bytes[index] = (index * 31 + 7) % 256;
  }
  return bytes;
}

export function byteRoundTripSamples(): ReadonlyArray<{
  name: string;
  content: string | Uint8Array;
}> {
  const png = everyByte(4096);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return [
    // Text through the same adapter, including characters UTF-8 spells in
    // several bytes, so text is shown to be untouched too.
    { name: "source.tsx", content: 'export const label = "Café · 東京 ✓";\n' },
    { name: "small.png", content: png },
    // The per-file limit of public/, less a little: the size writes are
    // bounded to.
    { name: "large.bin", content: everyByte(5 * 1024 * 1024 - 1024) },
  ];
}

export async function runByteRoundTrip(
  sandbox: RoundTripSandbox,
  directory = "/workspace/morph-byte-roundtrip",
): Promise<{ ok: boolean; checks: ByteRoundTripCheck[] }> {
  await sandbox.mkdir(directory, { recursive: true });
  const checks: ByteRoundTripCheck[] = [];
  for (const sample of byteRoundTripSamples()) {
    const startedAt = Date.now();
    const path = `${directory}/${sample.name}`;
    const expected =
      typeof sample.content === "string"
        ? new TextEncoder().encode(sample.content)
        : sample.content;
    await writeSandboxWorkspaceFile(sandbox, path, sample.content);
    // Read as base64 whatever was written, so the comparison is of bytes
    // and not of what a text decoding makes of them.
    const read = await sandbox.readFile(path, { encoding: "base64" });
    const readBytes = new Uint8Array(Buffer.from(read.content, "base64"));
    const readSha256 = sha256(readBytes);
    const expectedSha256 = sha256(expected);
    checks.push({
      name: sample.name,
      sizeBytes: expected.byteLength,
      expectedSha256,
      readSha256,
      readSizeBytes: readBytes.byteLength,
      readEncoding: read.encoding ?? null,
      ok:
        readSha256 === expectedSha256 &&
        readBytes.byteLength === expected.byteLength,
      ms: Date.now() - startedAt,
    });
  }
  return { ok: checks.every((check) => check.ok), checks };
}
