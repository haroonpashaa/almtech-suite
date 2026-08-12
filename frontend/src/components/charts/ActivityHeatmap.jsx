import { useMemo } from 'react';
import { money } from '../../lib/format.js';

/* ---------------------------------------------------------------------------
   Trading-intensity heatmap.

   The brief allowed one visually distinctive analytical component, and explicitly
   ruled out a decorative globe. This application holds no geographic data at all —
   customers and suppliers have addresses as free text, never coordinates or
   country codes — so a map would have to invent its data. A calendar heatmap does
   not: every cell is one day of real revenue from /reports/series?granularity=day.

   It answers a question the line chart cannot: WHEN does this business actually
   trade? Dead weeks, month-end spikes and quiet runs are visible instantly.

   Plain SVG, so it adds nothing to the chart bundle and prints cleanly.
   --------------------------------------------------------------------------- */

const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];
const CELL = 13;
const GAP = 3;

// Five steps of the brand ramp. Intensity is by rank, not raw value, so one huge
// day cannot flatten the rest of the period into a single shade.
const STEPS = ['#eef2f7', '#dbeafe', '#7ab8ee', '#0950b9', '#163e93'];

export default function ActivityHeatmap({ points = [], currency = 'PKR', metric = 'revenue', loading }) {
  const { weeks, max, active, busiest, thresholds } = useMemo(() => {
    const byDate = new Map(points.map((p) => [p.period, Number(p[metric]) || 0]));
    if (!points.length) return { weeks: [], max: 0, active: 0, busiest: null, thresholds: [] };

    const start = new Date(points[0].period);
    const end = new Date(points[points.length - 1].period);
    // Start the grid on the Monday of the first week so columns are real weeks.
    const gridStart = new Date(start);
    const dow = (gridStart.getDay() + 6) % 7;
    gridStart.setDate(gridStart.getDate() - dow);

    const cols = [];
    let col = [];
    for (let d = new Date(gridStart); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      const inRange = d >= start;
      col.push(inRange ? { date: key, value: byDate.get(key) ?? 0 } : null);
      if (col.length === 7) { cols.push(col); col = []; }
    }
    if (col.length) { while (col.length < 7) col.push(null); cols.push(col); }

    const values = points.map((p) => Number(p[metric]) || 0).filter((v) => v > 0).sort((a, b) => a - b);
    const q = (f) => (values.length ? values[Math.min(values.length - 1, Math.floor(values.length * f))] : 0);
    const th = [q(0.25), q(0.5), q(0.75)];
    const peak = points.reduce((best, p) => ((Number(p[metric]) || 0) > (Number(best?.[metric]) || 0) ? p : best), null);

    return { weeks: cols, max: values[values.length - 1] || 0, active: values.length, busiest: peak, thresholds: th };
  }, [points, metric]);

  const level = (v) => {
    if (!v) return 0;
    if (v <= thresholds[0]) return 1;
    if (v <= thresholds[1]) return 2;
    if (v <= thresholds[2]) return 3;
    return 4;
  };

  if (loading) return <div className="skeleton h-[132px] w-full rounded-md" aria-hidden />;
  if (!weeks.length) return null;

  const width = weeks.length * (CELL + GAP);
  const height = 7 * (CELL + GAP);

  return (
    <div>
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="flex gap-2 min-w-fit">
          <div className="flex flex-col justify-between py-[1px] shrink-0" style={{ height }} aria-hidden>
            {DAY_LABELS.map((d, i) => (
              <span key={i} className="text-[9px] leading-none text-ink-300 h-[13px] flex items-center">{d}</span>
            ))}
          </div>
          <svg
            width={width} height={height} role="img"
            aria-label={`Daily ${metric} intensity. ${active} trading days in this period, busiest ${busiest ? `${busiest.period} at ${money(busiest[metric], currency)}` : 'none'}.`}
          >
            {weeks.map((wk, x) =>
              wk.map((cell, y) =>
                cell ? (
                  <rect
                    key={`${x}-${y}`}
                    x={x * (CELL + GAP)} y={y * (CELL + GAP)}
                    width={CELL} height={CELL} rx="2.5"
                    fill={STEPS[level(cell.value)]}
                  >
                    <title>{`${cell.date} · ${money(cell.value, currency)}`}</title>
                  </rect>
                ) : null
              )
            )}
          </svg>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
        <span className="t-meta">
          {active} trading day{active === 1 ? '' : 's'}
          {busiest ? <> · busiest {busiest.period} at <span className="num text-ink-700">{money(busiest[metric], currency)}</span></> : null}
        </span>
        <span className="flex items-center gap-1.5 ml-auto t-meta">
          Less
          {STEPS.map((c) => <span key={c} className="w-[11px] h-[11px] rounded-[2px]" style={{ background: c }} aria-hidden />)}
          More
        </span>
      </div>
      {/* Screen readers get the same information as text rather than colour. */}
      <p className="sr-only">
        Peak daily {metric} was {money(max, currency)}. {active} of {points.length} days recorded activity.
      </p>
    </div>
  );
}
