// Full form, currency included — for standalone figures, KPIs and summaries.
export const money = (n, currency = 'PKR') => `${currency} ${moneyPlain(n)}`;

// Bare tabular figure — for dense table cells where the column header already
// carries the currency, e.g. "Amount (PKR)". Identical value, less repetition.
export const moneyPlain = (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Compact form for chart axes and tight KPI hints: 1.2M, 450k.
export const moneyShort = (n) => {
  const v = Number(n || 0);
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(Math.round(v));
};

export const date = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// Short form for dense tables and chart labels.
export const dateShort = (d) =>
  d ? new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : '—';

// "3 hours ago" for activity feeds, falling back to a date once it stops being useful.
export const relativeTime = (d) => {
  if (!d) return '—';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return dateShort(d);
};
export const datetime = (d) => (d ? new Date(d).toLocaleString() : '—');

export const errorMessage = (e) =>
  e?.response?.data?.message || e?.message || 'Something went wrong';
