/* ---------------------------------------------------------------------------
   Shared chart language.

   Axis colours, formatters and series colours lived in three copies across
   Dashboard, Reports and ExpenseReports, which meant three sets of values that
   would drift. They live here now. Deliberately free of any recharts import so
   this module stays in the main bundle while the chart components themselves
   remain code-split.
   --------------------------------------------------------------------------- */

export const SERIES = {
  revenue: '#0950b9',
  expenses: '#dc2626',
  purchases: '#0086cd',
  net: '#15803d',
  receivable: '#0950b9',
  payable: '#b45309',
};

// Ordered for the donut: brand ramp first, neutrals for the tail.
export const CATEGORY_COLOURS = [
  '#163e93', '#0950b9', '#0086cd', '#38bdf8', '#7dd3fc', '#94a3b8', '#cbd5e1',
];

export const AXIS = {
  tick: { fontSize: 11, fill: '#94a3b8' },
  tickLine: false,
  axisLine: false,
};

export const GRID = { strokeDasharray: '3 3', stroke: '#eef2f7', vertical: false };

/** Compact axis labels — 1.2M rather than 1,200,000.00 crowding the gutter. */
export function axisMoney(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(Math.round(v));
}

/** Percentage change between two periods. Null when there is no basis to compare. */
export function delta(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (!p) return null;
  return ((c - p) / Math.abs(p)) * 100;
}

/** Date range helpers shared by the dashboard period control. */
export function rangeFor({ days, mtd, months }) {
  const to = new Date();
  let from;
  if (mtd) from = new Date(to.getFullYear(), to.getMonth(), 1);
  else if (months) from = new Date(to.getFullYear(), to.getMonth() - months, to.getDate());
  else from = new Date(Date.now() - (days || 30) * 86400000);
  return { from: iso(from), to: iso(to) };
}

/** The equivalent window immediately before the given one, for comparison. */
export function previousRange({ from, to }) {
  const f = new Date(from).getTime();
  const t = new Date(to).getTime();
  const span = Math.max(t - f, 86400000);
  return { from: iso(new Date(f - span - 86400000)), to: iso(new Date(f - 86400000)) };
}

export const iso = (d) => new Date(d).toISOString().slice(0, 10);
