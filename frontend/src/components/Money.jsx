import { money, moneyPlain } from '../lib/format.js';

/**
 * A financial value.
 *
 * In dense tables the currency lives in the column header, so cells render bare
 * tabular numerals — `1,250,000.00`. Standalone figures (KPIs, totals, summaries)
 * keep the currency for clarity. Nothing here changes a calculation; it is purely
 * how an already-computed number is presented.
 *
 * Sign is always shown for negatives, and negatives also carry heavier weight, so
 * the meaning survives for anyone who cannot distinguish the colours.
 */
export default function Money({
  value,
  currency = 'PKR',
  showCurrency = false,
  tone,           // 'auto' | 'positive' | 'negative' | 'due' | 'muted' | undefined
  size,           // 'lg' for headline figures
  // Table cells must never wrap a figure across lines. A headline figure in a card
  // must never be *cut* instead: `PKR 1,015,367,147.20` in a 153px card rendered as
  // `PKR 1,015,367` with the rest clipped away, which reads as a real and much
  // smaller number. Callers that own a constrained box opt into wrapping.
  wrap = false,
  className = '',
}) {
  const n = Number(value) || 0;
  const text = showCurrency ? money(n, currency) : moneyPlain(n);

  let toneClass = '';
  if (tone === 'auto') toneClass = n < 0 ? 'text-red-600 font-medium' : n > 0 ? 'text-ink-900' : 'text-ink-300';
  else if (tone === 'positive') toneClass = 'text-emerald-700';
  else if (tone === 'negative') toneClass = 'text-red-600 font-medium';
  else if (tone === 'due') toneClass = n > 0 ? 'text-amber-700 font-medium' : 'text-ink-300';
  else if (tone === 'muted') toneClass = 'text-ink-400';

  const sizeClass = size === 'lg' ? 'text-[22px] font-semibold tracking-tight' : '';

  return (
    <span className={`num tabular-nums ${wrap ? '' : 'whitespace-nowrap'} ${sizeClass} ${toneClass} ${className}`}>
      {text}
    </span>
  );
}
