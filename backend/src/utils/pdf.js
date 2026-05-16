import PDFDocument from 'pdfkit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the logo bundled with the frontend public folder.
const LOGO_PATH = path.resolve(__dirname, '../../../frontend/public/almtech-logo-tight.png');
const HAS_LOGO = fs.existsSync(LOGO_PATH);

const BRAND_DEEP = '#163e93';
const BRAND_MID = '#0950b9';
const BRAND_LIGHT = '#0086cd';
const INK_900 = '#0b1220';
const INK_700 = '#1e293b';
const INK_500 = '#475569';
const INK_300 = '#94a3b8';
const INK_100 = '#e2e8f0';

function money(n, currency = 'PKR') {
  return `${currency} ${Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function streamInvoicePDF(res, { invoice, customer, settings }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${invoice.number}.pdf"`);
  doc.pipe(res);

  // --- Header band with brand-gradient accent stripe ---
  doc.rect(0, 0, doc.page.width, 6).fill(BRAND_MID);
  doc.fillColor(INK_900);

  // Logo
  if (HAS_LOGO) {
    try {
      doc.image(LOGO_PATH, 50, 28, { fit: [170, 40], align: 'left' });
    } catch (_) {
      doc.fontSize(20).fillColor(BRAND_DEEP).text(settings.businessName || 'ALMTech', 50, 32);
    }
  } else {
    doc.fontSize(20).fillColor(BRAND_DEEP).text(settings.businessName || 'ALMTech', 50, 32);
  }

  // Business info under logo
  doc.fontSize(8.5).fillColor(INK_500);
  let infoY = 70;
  if (settings.address) {
    doc.text(settings.address, 50, infoY);
    infoY += 11;
  }
  if (settings.phone) {
    doc.text(`Tel: ${settings.phone}`, 50, infoY);
    infoY += 11;
  }
  if (settings.email) {
    doc.text(settings.email, 50, infoY);
    infoY += 11;
  }
  if (settings.taxNumber) doc.text(`Tax #: ${settings.taxNumber}`, 50, infoY);

  // Invoice meta on the right
  doc.fontSize(20).fillColor(INK_900).text('INVOICE', 0, 32, { align: 'right' });
  doc.fontSize(9).fillColor(INK_500);
  doc.text(`No  ${invoice.number}`, 0, 60, { align: 'right' });
  doc.text(`Date  ${new Date(invoice.issuedAt).toLocaleDateString()}`, 0, 73, { align: 'right' });

  const statusColor = {
    paid: '#16a34a',
    partial: '#d97706',
    open: INK_500,
    returned: '#dc2626',
    cancelled: INK_300,
  }[invoice.status] || INK_500;
  doc.fillColor(statusColor).fontSize(9.5).text(invoice.status.toUpperCase(), 0, 86, { align: 'right' });

  // --- Bill To ---
  doc.moveDown(2.5);
  let y = 140;
  doc.fontSize(9).fillColor(INK_300).text('BILL TO', 50, y);
  y += 14;
  doc.fontSize(11).fillColor(INK_900).text(customer?.name || '—', 50, y);
  y += 14;
  doc.fontSize(9).fillColor(INK_500);
  if (customer?.company) { doc.text(customer.company, 50, y); y += 11; }
  if (customer?.phone) { doc.text(customer.phone, 50, y); y += 11; }
  if (customer?.email) { doc.text(customer.email, 50, y); y += 11; }
  if (customer?.address) { doc.text(customer.address, 50, y, { width: 250 }); y += 11; }

  // --- Items table ---
  const tableTop = Math.max(y + 24, 230);
  const cols = [
    { label: '#', x: 50, w: 22, align: 'left' },
    { label: 'ITEM', x: 72, w: 230, align: 'left' },
    { label: 'QTY', x: 302, w: 40, align: 'right' },
    { label: 'PRICE', x: 342, w: 70, align: 'right' },
    { label: 'DISCOUNT', x: 412, w: 65, align: 'right' },
    { label: 'TOTAL', x: 477, w: 73, align: 'right' },
  ];

  doc.fontSize(8).fillColor(INK_300);
  cols.forEach((c) => doc.text(c.label, c.x, tableTop, { width: c.w, align: c.align }));
  doc.moveTo(50, tableTop + 13).lineTo(550, tableTop + 13).strokeColor(INK_100).lineWidth(0.5).stroke();

  let rowY = tableTop + 20;
  doc.fontSize(9.5);
  invoice.items.forEach((it, i) => {
    doc.fillColor(INK_500).text(String(i + 1), 50, rowY, { width: 22 });
    doc.fillColor(INK_900).text(it.name, 72, rowY, { width: 230 });
    if (it.sku) {
      doc.fontSize(8).fillColor(INK_300).text(it.sku, 72, rowY + 12);
      doc.fontSize(9.5);
    }
    doc.fillColor(INK_700);
    doc.text(String(it.quantity), 302, rowY, { width: 40, align: 'right' });
    doc.text(money(it.unitPrice, settings.currency), 342, rowY, { width: 70, align: 'right' });
    doc.text(it.discount ? money(it.discount, settings.currency) : '—', 412, rowY, { width: 65, align: 'right' });
    doc.fillColor(INK_900).text(money(it.lineTotal, settings.currency), 477, rowY, { width: 73, align: 'right' });
    rowY += it.sku ? 26 : 18;
  });

  doc.moveTo(50, rowY + 4).lineTo(550, rowY + 4).strokeColor(INK_100).lineWidth(0.5).stroke();

  // --- Totals block ---
  let totY = rowY + 18;
  const labelX = 380;
  const valueX = 477;
  const row = (label, value, opts = {}) => {
    doc.fontSize(opts.size || 9.5).fillColor(opts.color || INK_500);
    doc.text(label, labelX, totY, { width: 90, align: 'right' });
    doc.fillColor(opts.valueColor || INK_900);
    doc.text(value, valueX, totY, { width: 73, align: 'right' });
    totY += opts.gap || 16;
  };
  row('Subtotal', money(invoice.subtotal, settings.currency));
  if (invoice.discount) row('Discount', `- ${money(invoice.discount, settings.currency)}`);
  if (invoice.taxAmount) row(`Tax · ${invoice.taxRate}%`, money(invoice.taxAmount, settings.currency));

  // Total row with brand accent
  doc.rect(labelX - 4, totY - 3, 175, 22).fill(BRAND_DEEP);
  doc.fillColor('#ffffff').fontSize(10);
  doc.text('TOTAL', labelX, totY + 2, { width: 90, align: 'right' });
  doc.text(money(invoice.total, settings.currency), valueX, totY + 2, { width: 73, align: 'right' });
  totY += 30;

  row('Paid', money(invoice.paid, settings.currency));
  row('Balance', money(invoice.balance, settings.currency), {
    valueColor: invoice.balance > 0 ? '#d97706' : INK_900,
  });

  if (invoice.notes) {
    totY += 18;
    doc.fontSize(8).fillColor(INK_300).text('NOTES', 50, totY);
    doc.fontSize(9).fillColor(INK_500).text(invoice.notes, 50, totY + 12, { width: 500 });
  }

  // --- Footer ---
  const footerY = doc.page.height - 50;
  doc.moveTo(50, footerY - 8).lineTo(550, footerY - 8).strokeColor(INK_100).lineWidth(0.5).stroke();
  doc.fontSize(8).fillColor(INK_300).text(
    `${settings.businessName || 'ALMTech'} · ${settings.email || ''} · Generated ${new Date().toLocaleString()}`,
    50,
    footerY,
    { width: 500, align: 'center' }
  );

  doc.end();
}
