import type { Summary } from "@/lib/behavior/types";

/**
 * Plain descriptive statistics — no models. Percentiles use linear
 * interpolation between closest ranks (the common "type 7" definition, the
 * same as Postgres percentile_cont and NumPy's default).
 */

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (sorted.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

const round = (value: number) => Math.round(value * 100) / 100;

/** n, mean, sample standard deviation, min, median, p90, p95, p99, max. Null for an empty series. */
export function summarize(values: readonly number[]): Summary | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((sum, v) => sum + v, 0) / n;
  const variance = n > 1 ? sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1) : 0;
  return {
    n,
    mean: round(mean),
    stddev: round(Math.sqrt(variance)),
    min: sorted[0],
    median: round(percentile(sorted, 0.5)),
    p90: round(percentile(sorted, 0.9)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    max: sorted[n - 1],
  };
}

/**
 * Summary that a few extreme values can't distort: values above
 * `outlierMultiplier × p95` (computed on the full series) are excluded from
 * the returned statistics and counted. Percentiles of the remaining series are
 * nearly identical; mean, stddev and max stop being dominated by one incident.
 */
export function robustSummarize(
  values: readonly number[],
  outlierMultiplier: number
): (Summary & { excludedOutliers: number }) | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const p95 = percentile(sorted, 0.95);
  const kept = p95 > 0 ? sorted.filter((v) => v <= p95 * outlierMultiplier) : sorted;
  const summary = summarize(kept.length > 0 ? kept : sorted);
  return summary ? { ...summary, excludedOutliers: sorted.length - kept.length } : null;
}
