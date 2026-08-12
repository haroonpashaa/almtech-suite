import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ---------------------------------------------------------------------------
   One visual identity for every ALM Business Suite document.

   The palette is the same brand ramp and ink neutrals the application uses on
   screen, so a printed invoice and the invoice screen are recognisably the same
   product. Values are copied from tailwind.config.js deliberately — the backend
   cannot import the frontend's Tailwind config, so this is the single place the
   duplication lives, and it is documented as such.
   --------------------------------------------------------------------------- */

export const COLOR = {
  brandDeep: '#163e93',
  brandMid: '#0950b9',
  brandLight: '#0086cd',
  ink900: '#0b1220',
  ink700: '#1e293b',
  ink500: '#475569',
  ink400: '#64748b',
  ink300: '#94a3b8',
  ink100: '#e2e8f0',
  ink50: '#f1f5f9',
  positive: '#15803d',
  warning: '#b45309',
  danger: '#dc2626',
  white: '#ffffff',
};

// A4 at 72dpi is 595.28 x 841.89pt. Margins leave a comfortable print-safe area
// and reserve a band at the foot of every page for the footer rule and page number.
export const PAGE = {
  size: 'A4',
  margin: 46,
  get width() { return 595.28; },
  get height() { return 841.89; },
  footerHeight: 34,
};

export const FONT = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  oblique: 'Helvetica-Oblique',
};

export const SIZE = {
  docTitle: 20,
  sectionLabel: 7.5,
  body: 9,
  bodySm: 8,
  meta: 8.5,
  tableHead: 7.5,
  row: 8.8,
  totalRow: 9.5,
  grandTotal: 10.5,
};

/* The logo now ships INSIDE the API bundle (backend/src/assets), because relying on
   the frontend's public folder was unreliable: on a serverless deployment the API
   is bundled separately and that folder is not co-located, so production PDFs would
   silently lose their branding.

   The frontend copies remain as fallbacks for a local checkout, and the business
   name is still rendered if no image can be read at all — a missing logo must never
   break document generation.

   Resolved once and cached: this is called for every page of every document. */
const LOGO_CANDIDATES = [
  path.resolve(__dirname, '../../assets/almtech-logo.png'),          // shipped with the API
  path.resolve(__dirname, '../../../../frontend/public/almtech-logo-tight.png'),
  path.resolve(__dirname, '../../../frontend/public/almtech-logo-tight.png'),
  path.resolve(process.cwd(), 'frontend/public/almtech-logo-tight.png'),
];

let cachedLogo;
export function findLogo() {
  if (cachedLogo !== undefined) return cachedLogo;
  cachedLogo = null;
  for (const p of LOGO_CANDIDATES) {
    try {
      // Readable, not merely present — an unreadable file would throw inside pdfkit.
      fs.accessSync(p, fs.constants.R_OK);
      cachedLogo = p;
      break;
    } catch { /* try the next candidate */ }
  }
  return cachedLogo;
}

/** Money for documents. Mirrors the frontend `money()` exactly: symbol, then
 *  thousands separators, then two decimals, with the sign kept ahead of the
 *  currency so a negative reads unambiguously as "-PKR 1,200.00". */
export function money(n, currency = 'PKR') {
  const v = Number(n || 0);
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '-' : ''}${currency} ${abs}`;
}

/** Bare number for dense columns where the currency sits in the header. */
export function amount(n) {
  const v = Number(n || 0);
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '-' : ''}${abs}`;
}

export function docDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const STATUS_COLOR = {
  paid: COLOR.positive,
  received: COLOR.positive,
  accepted: COLOR.positive,
  converted: COLOR.positive,
  partial: COLOR.warning,
  open: COLOR.ink500,
  sent: COLOR.ink500,
  ordered: COLOR.ink500,
  draft: COLOR.ink300,
  returned: COLOR.danger,
  rejected: COLOR.danger,
  cancelled: COLOR.ink300,
  voided: COLOR.danger,
};
