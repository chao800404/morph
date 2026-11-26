import { BaseSequencer } from "vitest/node";

export const DURATIONS_FILE: URL;
export const PLAN_WORKERS: number;
export function loadDurations(file?: string | URL): Record<string, number>;
export function loadOverhead(file?: string | URL): {
  perFileSeconds: number;
  perShardSeconds: number;
};
export function defaultWeight(
  durations: Readonly<Record<string, number>>,
): number;
export function planShards(
  durations: Readonly<Record<string, number>>,
  count: number,
  perFile?: number,
): {
  shardOf: Map<string, number>;
  sum: number[];
  finish: number[];
  files: number[];
};
export function assignShards(
  files: readonly string[],
  durations: Readonly<Record<string, number>>,
  count: number,
  perFile?: number,
): Map<string, number>;
export function selectShardFiles<T extends string>(
  files: readonly T[],
  durations: Readonly<Record<string, number>>,
  index: number,
  count: number,
  nameOf?: (file: T) => string,
  perFile?: number,
): T[];

export default class DurationShardSequencer extends BaseSequencer {}
