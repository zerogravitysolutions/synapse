import type { UsageStats, CliResult } from '../types.js';

/** Format a token count as `1.2k`, `12.3k`, `1.5M`, or just the integer if < 1000. */
export function formatTokens(n: number): string {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Format a duration in ms to a compact human form: 850ms / 5.2s / 1m 12s. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** Format a USD cost; show `<$0.01` for tiny non-zero amounts so it's still visible. */
export function formatCost(usd: number): string {
  if (!usd) return '$0';
  if (usd < 0.01) return '<$0.01';
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Build the single-line italicized footer Discord shows after each response.
 * Only includes fields that are meaningful — drops zero-value cache fields
 * so a response with no caching doesn't get cluttered with `cache: 0`.
 *
 * Format: `*Tokens — in: 1.2k · out: 567 · cache read: 8.0k · cache write: 12 · cost: $0.04 · 5.2s*`
 */
export function formatUsageFooter(result: CliResult): string | null {
  const { usage, costUsd, durationMs } = result;
  if (!usage && !costUsd && !durationMs) return null;

  const parts: string[] = [];
  if (usage) {
    parts.push(`in: ${formatTokens(usage.inputTokens)}`);
    parts.push(`out: ${formatTokens(usage.outputTokens)}`);
    if (usage.cacheReadTokens) parts.push(`cache read: ${formatTokens(usage.cacheReadTokens)}`);
    if (usage.cacheCreateTokens) parts.push(`cache write: ${formatTokens(usage.cacheCreateTokens)}`);
  }
  if (costUsd) parts.push(`cost: ${formatCost(costUsd)}`);
  if (durationMs) parts.push(formatDuration(durationMs));

  if (parts.length === 0) return null;

  const prefix = usage ? 'Tokens — ' : '';
  return `*${prefix}${parts.join(' · ')}*`;
}

/** Re-export so callers don't need a separate import. */
export type { UsageStats };
