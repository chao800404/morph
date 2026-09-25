/**
 * Writing a file into a Cloudflare Sandbox, text or bytes.
 *
 * The SDK's `writeFile` takes a string, which it stores as UTF-8 unless told
 * the string is base64 (`@cloudflare/sandbox` 0.12: `content: string |
 * ReadableStream`, and the stream form only on the RPC transport). Handing it
 * a `Uint8Array` does not fail: the array is turned into a string of
 * comma-separated numbers and written as that, so an image arrives as text
 * and nothing says so. Every byte write therefore goes through here, and the
 * session types in this directory describe `writeFile` as the SDK does —
 * string only — so the compiler refuses one that does not.
 */

/** A session's `writeFile`, as the SDK declares it. */
export type SandboxFileWriter = {
  writeFile(
    path: string,
    content: string,
    options?: { encoding?: string },
  ): Promise<unknown>;
};

export async function writeSandboxWorkspaceFile(
  session: SandboxFileWriter,
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  if (typeof content === "string") {
    await session.writeFile(path, content);
    return;
  }
  await session.writeFile(path, encodeBase64(content), { encoding: "base64" });
}

export function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    "base64",
  );
}
