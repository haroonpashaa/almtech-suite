import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { SERIES, CATEGORY_COLOURS, AXIS, GRID, axisMoney } from './chartTheme.js';
import { ChartTooltip } from './ChartFrame.jsx';
import { money } from '../../lib/format.js';

/* ---------------------------------------------------------------------------
   Every recharts import in the application lives in this one module, which is
   loaded lazily by the dashboard. That keeps the 422 kB chart chunk off the
   critical path: the KPI row paints from the dashboard endpoint while this
   arrives in the background.
   --------------------------------------------------------------------------- */

const tip = (currency) => <ChartTooltip currency={currency} moneyFn={money} />;

/* A negative left margin pulls the Y axis band outside the SVG viewport, and an SVG
   clips whatever leaves it. Measured at every one of the nine viewports: the tick
   "300.0M" is 40px wide but only 36px of room existed, so every label lost its
   leading digit and read "0.0M" — the axis silently lied about the scale. The band
   is now inside the chart and wide enough for the longest label axisMoney can
   produce ("-999.9M"). */
const MONEY_AXIS_W = 56;
const CHART_MARGIN = { top: 8, right: 8, left: 0, bottom: 0 };

export function TrendChart({ points, currency }) {
  return (
    <ResponsiveContainer>
      <AreaChart data={points} margin={CHART_MARGIN}>
        <defs>
          <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES.revenue} stopOpacity={0.24} />
            <stop offset="100%" stopColor={SERIES.revenue} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES.expenses} stopOpacity={0.14} />
            <stop offset="100%" stopColor={SERIES.expenses} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" {...AXIS} minTickGap={26} />
        <YAxis {...AXIS} tickFormatter={axisMoney} width={MONEY_AXIS_W} />
        <Tooltip
          content={
            <ChartTooltip
              currency={currency}
              moneyFn={money}
              // Net is the number a business actually acts on, so it is stated
              // rather than left for the reader to subtract.
              extra={(rows) => {
                const rev = rows.find((r) => r.dataKey === 'revenue')?.value || 0;
                const exp = rows.find((r) => r.dataKey === 'expenses')?.value || 0;
                const net = rev - exp;
                return (
                  <div className="mt-1.5 pt-1.5 border-t border-ink-100 flex items-center gap-2 text-[13px]">
                    <span className="text-ink-500">Net</span>
                    <span className={`num ml-auto font-semibold ${net < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                      {money(net, currency)}
                    </span>
                  </div>
                );
              }}
            />
          }
        />
        <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
        <Area type="monotone" dataKey="revenue" stroke={SERIES.revenue} strokeWidth={2} fill="url(#gRev)" />
        <Area type="monotone" dataKey="expenses" stroke={SERIES.expenses} strokeWidth={2} fill="url(#gExp)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SalesPurchasesChart({ points, currency }) {
  return (
    <ResponsiveContainer>
      <BarChart data={points} margin={CHART_MARGIN} barGap={2}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" {...AXIS} minTickGap={26} />
        <YAxis {...AXIS} tickFormatter={axisMoney} width={MONEY_AXIS_W} />
        <Tooltip content={tip(currency)} cursor={{ fill: 'rgba(9,80,185,0.04)' }} />
        <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
        <Bar dataKey="revenue" name="sales" fill={SERIES.revenue} radius={[2, 2, 0, 0]} maxBarSize={26} />
        <Bar dataKey="purchases" name="purchases" fill={SERIES.purchases} radius={[2, 2, 0, 0]} maxBarSize={26} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ExpenseDonut({ categories, currency }) {
  return (
    <ResponsiveContainer>
      <PieChart>
        <Pie data={categories} dataKey="total" nameKey="category" innerRadius={44} outerRadius={68} paddingAngle={2} stroke="none">
          {categories.map((_, i) => <Cell key={i} fill={CATEGORY_COLOURS[i % CATEGORY_COLOURS.length]} />)}
        </Pie>
        <Tooltip content={tip(currency)} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/* The Reports monthly chart used to live inline in Reports.jsx with a raw <YAxis>
   carrying no tickFormatter and no width, so ten-digit rupee values overflowed the
   default axis band and rendered as ")000000" at every viewport. Moving it here
   gives it the same axis language as every other chart and restores the rule this
   module documents: recharts is imported in exactly one place. */
export function MonthlyTrendChart({ points, currency }) {
  return (
    <ResponsiveContainer>
      <LineChart data={points} margin={CHART_MARGIN}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="month" {...AXIS} minTickGap={20} />
        <YAxis {...AXIS} tickFormatter={axisMoney} width={MONEY_AXIS_W} />
        <Tooltip content={tip(currency)} />
        <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
        <Line type="monotone" dataKey="revenue" stroke={SERIES.revenue} strokeWidth={2.5} name="Revenue" dot={false} />
        <Line type="monotone" dataKey="cost" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 4" name="Cost" dot={false} />
        <Line type="monotone" dataKey="grossProfit" stroke={SERIES.purchases} strokeWidth={2.5} name="Gross Profit" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Receivables against payables, with the net position marked on the axis. */
export function PositionChart({ receivables, payables, currency }) {
  const data = [
    { name: 'Owed to ALMTech', value: receivables, fill: SERIES.receivable },
    { name: 'ALMTech owes', value: -payables, fill: SERIES.payable },
  ];
  return (
    <ResponsiveContainer>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid {...GRID} horizontal={false} vertical />
        <XAxis type="number" {...AXIS} tickFormatter={axisMoney} />
        <YAxis type="category" dataKey="name" {...AXIS} width={122} />
        <Tooltip content={tip(currency)} cursor={{ fill: 'rgba(9,80,185,0.04)' }} />
        <ReferenceLine x={0} stroke="#cbd5e1" />
        <Bar dataKey="value" name="amount" radius={[2, 2, 2, 2]} maxBarSize={30}>
          {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
