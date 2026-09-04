// Human-readable byte sizes for the System Health page — the API returns raw
// byte counts so it never has to guess at the reader's preferred unit.
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes, { decimals = 1 } = {}) {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const i = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${UNITS[i]}`;
}

// e.g. 90125 -> "1d 1h 2m"; caps at days, never renders seconds (not useful for
// an uptime measured in a health check, and it would just be visual noise).
export function formatDuration(seconds) {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${s}s`;
}
