/**
 * Types for the e2e runner's sidecar record, which is plain JavaScript because
 * the runner is. Declared so its unit test checks real signatures.
 */
export declare function redactSidecarLine(
  line: string,
  secrets?: readonly (string | undefined)[],
): string;

export type SidecarProcessRecord = {
  pid: number | null;
  startedAt: string | null;
  listeningAt: string | null;
  exitedAt: string | null;
  code: number | null;
  signal: string | null;
  stoppedByRunner: boolean | null;
};

export declare function createSidecarRecorder(options: {
  logFile: string;
  processFile: string;
  secrets?: readonly (string | undefined)[];
  now?: () => Date;
  warn?: (message: string) => void;
}): {
  record: SidecarProcessRecord;
  started(pid: number | undefined): void;
  line(text: string, stream: "stdout" | "stderr"): void;
  exited(
    code: number | null,
    signal: string | null,
    stoppedByRunner: boolean | undefined,
  ): void;
};
