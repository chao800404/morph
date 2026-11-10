// @ts-check
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Gets Linux's pgrp field from /proc/<pid>/stat. The comm field is parenthesized
 * and may itself contain spaces or closing parentheses, so split after its
 * final closing parenthesis rather than splitting the whole line.
 * @param {string} stat
 */
export function processGroupIdFromStat(stat) {
  const close = stat.lastIndexOf(")");
  if (close < 0) throw new Error("HANDOVER_PROC_STAT_INVALID: missing comm field");
  const fields = stat.slice(close + 1).trim().split(/\s+/);
  const pgid = Number(fields[2]);
  if (!Number.isSafeInteger(pgid) || pgid <= 1) {
    throw new Error("HANDOVER_PROC_STAT_INVALID: missing process group id");
  }
  return pgid;
}

/** @returns {number | null} */
export function ownProcessGroupId() {
  try {
    return processGroupIdFromStat(
      readFileSync(`/proc/${process.pid}/stat`, "utf8"),
    );
  } catch {
    return null;
  }
}

/**
 * Writes each phase through a unique sibling file. A runner killed during an
 * update leaves either the previous incomplete record or an invalid file;
 * neither can authorize a second invocation.
 * @param {string} recordPath
 * @param {Record<string, unknown>} record
 */
export async function writeHandoverRecord(recordPath, record) {
  if (!path.isAbsolute(recordPath)) {
    throw new Error("HANDOVER_PATH_NOT_ABSOLUTE: record path must be absolute");
  }
  await mkdir(path.dirname(recordPath), { recursive: true });
  const temporaryPath = `${recordPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(record, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
    await rename(temporaryPath, recordPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}
