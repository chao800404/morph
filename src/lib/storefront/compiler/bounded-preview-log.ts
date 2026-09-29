/**
 * A Live Preview start's log, bounded where the output is received.
 *
 * Theme code writes into this — Vite and workerd print what the Theme prints —
 * so nothing about its size can be assumed. The bound is applied to each chunk
 * as it arrives, before any other work is done on it: a line is cut to
 * `maxLineLength` first, and once `maxLines` or `maxTotalLength` is reached
 * nothing more is kept. Lengths are in UTF-16 code units, at most three bytes
 * each in UTF-8.
 *
 * Full is not stopped. The appender still returns at once for every later
 * chunk and never throws, so whatever feeds it keeps being read: a reader that
 * stopped reading would leave the process writing into a full pipe, and a dev
 * server stalled that way before. What is dropped is counted on one marker
 * line, the last one kept.
 *
 * Kept lines lose terminal control sequences and control characters, and
 * obvious secrets are masked: signed-address query parameters and the value of
 * a `Cookie`, `Set-Cookie` or `Authorization` line. That masking is a backstop.
 * Theme code can print anything in any encoding, so the protection is that no
 * secret is placed in the container, not that a log catches one.
 */

export type BoundedPreviewLogLimits = Readonly<{
  maxLines: number;
  maxLineLength?: number;
  maxTotalLength?: number;
}>;

export const DEFAULT_PREVIEW_LOG_LINE_LENGTH = 2_000;
export const DEFAULT_PREVIEW_LOG_TOTAL_LENGTH = 64_000;

/** Appends to `target`, which is the log a start reports, within `limits`. */
export function boundedPreviewLogAppender(
  target: string[],
  limits: BoundedPreviewLogLimits,
): (text: string) => void {
  const maxLines = Math.max(1, limits.maxLines);
  const maxLineLength =
    limits.maxLineLength ?? DEFAULT_PREVIEW_LOG_LINE_LENGTH;
  const maxTotalLength =
    limits.maxTotalLength ?? DEFAULT_PREVIEW_LOG_TOTAL_LENGTH;
  let total = 0;
  let droppedLength = 0;
  let markerIndex = -1;

  const drop = (length: number) => {
    droppedLength += length;
    const marker = `[Live Preview output truncated: ${droppedLength} more characters were not kept]`;
    if (markerIndex === -1) markerIndex = target.push(marker) - 1;
    else target[markerIndex] = marker;
  };

  return (text: string) => {
    try {
      if (typeof text !== "string") return;
      if (markerIndex !== -1) {
        drop(text.length);
        return;
      }
      const overflow = text.length - maxLineLength;
      let line = sanitizePreviewLogLine(
        overflow > 0 ? text.slice(0, maxLineLength) : text,
      );
      if (overflow > 0) line += ` [${overflow} more characters]`;
      // One place is held back for the marker, so the log never exceeds
      // `maxLines` and always says when it stopped keeping output.
      if (
        target.length >= maxLines - 1 ||
        total + line.length > maxTotalLength
      ) {
        drop(text.length);
        return;
      }
      target.push(line);
      total += line.length;
    } catch {
      // A log line must never be what stops the output being read.
    }
  };
}

const TERMINAL_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
// Every C0 and C1 control but tab and newline, carriage return included: a
// bare CR lets one line be printed over another.
const CONTROL_CHARACTER = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const SIGNED_PARAMETER = /([?&](?:signature|token|sig)=)[^&\s"'<>#]+/gi;
const CREDENTIAL_LINE = /\b((?:set-)?cookie|authorization)(\s*[:=]\s*)[^\n]+/gi;

export function sanitizePreviewLogLine(text: string): string {
  return text
    .replace(TERMINAL_SEQUENCE, "")
    .replace(CONTROL_CHARACTER, "")
    .replace(SIGNED_PARAMETER, "$1[redacted]")
    .replace(CREDENTIAL_LINE, "$1$2[redacted]");
}
