import type { PreviewSocketVerifiedEvent } from "./preview-socket-lease";

/**
 * A diagnostic line for each verification that renewed a relayed Live Preview
 * socket's lease (M1 acceptance 1c, user decision 2026-11-22).
 *
 * The lease renews by moving `V` forward (preview-socket-lease.ts). Nothing
 * is stored when it does, so a test that has to revoke right after a renewal
 * had no way to see one. With the switch on, the preview's Durable Object
 * writes one line per advance to its console, which a local dev server
 * prints and the e2e runner already reads:
 *
 *   [preview-lease-verified] {"connectionId":"…","grantId":"…","path":"/…",
 *     "sequence":2,"sentAt":1732000000000,"settledAt":1732000000012}
 *
 * - `connectionId`: made for this socket when it is relayed; nothing else
 *   uses it.
 * - `grantId`, `path`: which grant the socket was opened with, and the
 *   upgrade's URL path (never its query), so a test can tell its own socket
 *   from others on the same grant.
 * - `sequence`: this socket's advances counted from 1, the first being its
 *   registration's verification.
 * - `sentAt`: the new `V`, the D1 query's send time; `settledAt`: the clock
 *   once `V` was updated. Both by the Durable Object's clock (D51).
 *
 * Off unless `MORPH_PREVIEW_LEASE_DIAGNOSTICS` is exactly "1". Off, no
 * connection id is made and the lease is given no callback: the only cost is
 * reading the binding once per relayed socket. On or off, the lease decides
 * and forwards exactly as before; the line is written after its decision and
 * cannot change it. A line carries ids, a path and times only: no cookie,
 * token, grant secret or host.
 */

export const PREVIEW_LEASE_DIAGNOSTICS_VAR = "MORPH_PREVIEW_LEASE_DIAGNOSTICS";
export const PREVIEW_LEASE_VERIFIED_PREFIX = "[preview-lease-verified]";

export function previewLeaseDiagnosticsEnabled(
  bindings: Record<string, unknown> | undefined,
): boolean {
  return bindings?.[PREVIEW_LEASE_DIAGNOSTICS_VAR] === "1";
}

export type PreviewLeaseVerifiedLine = Readonly<{
  connectionId: string;
  grantId: string;
  path: string;
  sequence: number;
  sentAt: number;
  settledAt: number;
}>;

/** The `onVerified` for one socket: writes one line per advance. */
export function previewLeaseVerifiedReporter(args: {
  connectionId: string;
  grantId: string;
  path: string;
  write?: (line: string) => void;
}): (event: PreviewSocketVerifiedEvent) => void {
  const write = args.write ?? ((line: string) => console.log(line));
  return (event) => {
    const line: PreviewLeaseVerifiedLine = {
      connectionId: args.connectionId,
      grantId: args.grantId,
      path: args.path,
      sequence: event.sequence,
      sentAt: event.sentAt,
      settledAt: event.settledAt,
    };
    write(`${PREVIEW_LEASE_VERIFIED_PREFIX} ${JSON.stringify(line)}`);
  };
}
