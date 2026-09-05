/**
 * Checks what the image editor is about to store.
 *
 * The upload route validates size, type and signature; this path skipped all
 * of it and wrote whatever it was handed under `contentType: "image/png"`. A
 * label is not a format: the bytes have to say so themselves, or the library
 * ends up holding a file whose recorded type is a claim nobody checked.
 */

/** Upper bound on a processed image, matching what the editor can produce. */
export const MAX_PROCESSED_IMAGE_BYTES = 25 * 1024 * 1024;

/** PNG's fixed 8-byte signature. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type ProcessedImageCheck =
  | { ok: true }
  | { ok: false; reason: "empty" | "too-large" | "not-a-png" };

/**
 * Whether these bytes may be stored as the processed PNG.
 *
 * The signature check is what makes the stored `image/png` true. It is not a
 * defence against a malicious admin — this endpoint already requires one — but
 * it keeps a mislabelled file from being served later as an image to visitors.
 */
export function checkProcessedImage(bytes: ArrayBuffer): ProcessedImageCheck {
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
  if (bytes.byteLength > MAX_PROCESSED_IMAGE_BYTES) {
    return { ok: false, reason: "too-large" };
  }

  const header = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
  if (header.length < PNG_SIGNATURE.length) {
    return { ok: false, reason: "not-a-png" };
  }
  for (const [index, byte] of PNG_SIGNATURE.entries()) {
    if (header[index] !== byte) return { ok: false, reason: "not-a-png" };
  }

  return { ok: true };
}

export function processedImageRejectionMessage(
  reason: Exclude<ProcessedImageCheck, { ok: true }>["reason"],
): string {
  switch (reason) {
    case "empty":
      return "The processed image was empty.";
    case "too-large":
      return "The processed image is too large to store.";
    case "not-a-png":
      return "The processed image was not a PNG.";
  }
}
