import { Doc } from './document.js';
import { COLOR, FONT, SIZE, docDate } from './theme.js';

/* ---------------------------------------------------------------------------
   The ALM Business Suite document family.

   Every document shares the same masthead, table, totals block and footer, so they
   read as one product — but each keeps the shape its business meaning requires. A
   quotation has validity and no payment history; a purchase order faces a supplier
   and tracks receipts; a statement is a running balance rather than a priced list.

   Nothing here computes money. Every figure printed is a value the application
   already stored or already derived; these functions only lay it out.
   --------------------------------------------------------------------------- */

const PAY_METHOD = { cash: 'Cash', bank: 'Bank transfer', cheque: 'Cheque', card: 'Card', other: 'Other' };

/** Shared line-item table for invoices, quotations and purchase orders. */
function itemColumns(doc, { priceLabel = 'Unit price', showDiscount = true, showReceived = false }) {
  const cur = doc.currency;
  const cols = [
    { key: 'idx', label: '#', width: 24, align: 'left', color: COLOR.ink400, render: (_r, i) => String(i + 1) },
    {
      key: 'name', label: 'Description', width: 0, color: COLOR.ink900, font: FONT.bold,
      render: (r) => r.name || '—',
      // model/ram/processor/storage/serials only ever exist on invoice lines — on a
      // quotation or purchase order line they're simply absent, and filter(Boolean)
      // already drops them, so this is safe to share across all three documents.
      sub: (r) => {
        const specs = [r.model, r.ram, r.processor, r.storage].filter(Boolean).join(' · ');
        const serials = r.serials?.length ? `S/N: ${r.serials.join(', ')}` : null;
        return [r.sku, specs || null, serials, r.comments].filter(Boolean).join(' · ') || null;
      },
    },
    { key: 'qty', label: 'Qty', width: 40, align: 'right', render: (r) => String(r.quantity ?? 0) },
  ];
  if (showReceived) {
    cols.push({ key: 'received', label: 'Recd', width: 40, align: 'right', render: (r) => String(r.received ?? 0) });
  }
  cols.push({ key: 'price', label: `${priceLabel} (${cur})`, width: 78, align: 'right', render: (r) => doc.amount(r.unitPrice ?? r.unitCost) });
  if (showDiscount) {
    cols.push({ key: 'disc', label: `Discount (${cur})`, width: 66, align: 'right', color: COLOR.ink500, render: (r) => (r.discount ? doc.amount(r.discount) : '—') });
  }
  cols.push({ key: 'total', label: `Amount (${cur})`, width: 82, align: 'right', font: FONT.bold, color: COLOR.ink900, render: (r) => doc.amount(r.lineTotal) });

  // The description column absorbs whatever width the fixed columns leave.
  const fixed = cols.reduce((t, c) => t + c.width, 0);
  cols.find((c) => c.key === 'name').width = doc.width - fixed;
  return cols;
}

function payColumns(doc) {
  return [
    { key: 'date', label: 'Date', width: 78, render: (p) => docDate(p.date) },
    { key: 'method', label: 'Method', width: 90, render: (p) => PAY_METHOD[p.method] || p.method || '—' },
    { key: 'ref', label: 'Reference', width: 0, color: COLOR.ink500, render: (p) => p.reference || '—' },
    {
      key: 'amount', label: `Amount (${doc.currency})`, width: 96, align: 'right', font: FONT.bold,
      color: (p) => (p.reversed ? COLOR.ink300 : COLOR.ink900),
      render: (p) => (p.reversed ? `${doc.amount(p.amount)} (reversed)` : doc.amount(p.amount)),
    },
  ].map((c, _i, all) => {
    if (c.key !== 'ref') return c;
    const fixed = all.reduce((t, x) => t + x.width, 0);
    return { ...c, width: doc.width - fixed };
  });
}

// --------------------------------------------------------------------- invoice

export function buildInvoice({ invoice, customer, settings, res, download }) {
  const doc = new Doc({
    title: `Invoice ${invoice.number}`,
    subject: `Invoice for ${customer?.name || 'customer'}`,
    currency: settings.currency || 'PKR',
    settings, res, download, filename: invoice.number,
  });

  doc.header({
    title: 'INVOICE',
    number: invoice.number,
    date: invoice.issuedAt,
    dateLabel: 'Issued',
    status: invoice.status,
  });

  doc.parties([
    {
      label: 'Bill to',
      name: customer?.name,
      lines: [customer?.company, customer?.phone, customer?.email, customer?.address, customer?.cnicNtn && `CNIC/NTN: ${customer.cnicNtn}`],
    },
  ]);

  doc.table({
    columns: itemColumns(doc, { priceLabel: 'Unit price', showDiscount: true }),
    rows: invoice.items || [],
    emptyText: 'This invoice has no line items.',
  });

  const rows = [{ label: 'Subtotal', value: doc.money(invoice.subtotal) }];
  if (invoice.discount) rows.push({ label: 'Discount', value: `- ${doc.money(invoice.discount)}`, color: COLOR.ink700 });
  // Tax is printed only when the document actually carries one.
  if (invoice.taxAmount) rows.push({ label: `Tax (${invoice.taxRate || 0}%)`, value: doc.money(invoice.taxAmount) });
  rows.push({ label: 'TOTAL', value: doc.money(invoice.total), grand: true });
  rows.push({ label: 'Paid', value: doc.money(invoice.paid), color: invoice.paid ? COLOR.positive : COLOR.ink500 });
  rows.push({ divider: true });
  rows.push({
    label: invoice.balance > 0 ? 'Balance due' : 'Balance',
    value: doc.money(invoice.balance),
    strong: true,
    color: invoice.balance > 0 ? COLOR.warning : COLOR.ink900,
  });
  doc.totals(rows);

  const settled = (invoice.payments || []).filter((p) => !p.reversed);
  if ((invoice.payments || []).length) {
    doc.ensure(60);
    doc.label('Payment history', doc.left, doc.y);
    doc.y += 14;
    doc.table({ columns: payColumns(doc), rows: invoice.payments, zebra: false, emptyText: 'No payments recorded.' });
  }

  if (invoice.status === 'returned' || invoice.status === 'cancelled') {
    doc.note('Important', `This invoice has been ${invoice.status}. It is retained for the audit record and is not a demand for payment.`);
  } else if (invoice.balance > 0 && settled.length) {
    doc.note('Payment status', 'Partially paid. The balance shown above remains outstanding.');
  }

  doc.note('Notes', invoice.notes);
  doc.end({ footerNote: `Invoice ${invoice.number}` });
  return doc;
}

// ------------------------------------------------------------------- quotation

export function buildQuotation({ quotation, customer, settings, res, download }) {
  const doc = new Doc({
    title: `Quotation ${quotation.number}`,
    subject: `Quotation for ${customer?.name || 'customer'}`,
    currency: settings.currency || 'PKR',
    settings, res, download, filename: quotation.number,
  });

  doc.header({
    title: 'QUOTATION',
    number: quotation.number,
    date: quotation.issuedAt,
    dateLabel: 'Issued',
    status: quotation.status,
    extraMeta: quotation.validUntil ? [['Valid until', docDate(quotation.validUntil)]] : [],
  });

  doc.parties([
    {
      label: 'Prepared for',
      name: customer?.name,
      lines: [customer?.company, customer?.phone, customer?.email, customer?.address],
    },
  ]);

  doc.table({
    columns: itemColumns(doc, { priceLabel: 'Unit price', showDiscount: true }),
    rows: quotation.items || [],
    emptyText: 'This quotation has no line items.',
  });

  const rows = [{ label: 'Subtotal', value: doc.money(quotation.subtotal) }];
  if (quotation.discount) rows.push({ label: 'Discount', value: `- ${doc.money(quotation.discount)}` });
  if (quotation.taxAmount) rows.push({ label: `Tax (${quotation.taxRate || 0}%)`, value: doc.money(quotation.taxAmount) });
  rows.push({ label: 'TOTAL', value: doc.money(quotation.total), grand: true });
  doc.totals(rows);

  // A quotation is an offer, not a demand — it carries no payment or balance block.
  if (quotation.status === 'converted') {
    doc.note('Status', 'This quotation has been accepted and converted to an invoice.');
  } else if (quotation.validUntil) {
    doc.note('Validity', `This quotation is valid until ${docDate(quotation.validUntil)}. Prices and availability are subject to change after that date.`);
  }
  doc.note('Notes', quotation.notes);

  doc.end({ footerNote: `Quotation ${quotation.number}` });
  return doc;
}

// -------------------------------------------------------------- purchase order

export function buildPurchaseOrder({ po, supplier, settings, res, download }) {
  const doc = new Doc({
    title: `Purchase Order ${po.number}`,
    subject: `Purchase order to ${supplier?.name || 'supplier'}`,
    currency: settings.currency || 'PKR',
    settings, res, download, filename: po.number,
  });

  doc.header({
    title: 'PURCHASE ORDER',
    number: po.number,
    date: po.orderedAt,
    dateLabel: 'Ordered',
    status: po.status,
    extraMeta: po.expectedAt ? [['Expected', docDate(po.expectedAt)]] : [],
  });

  doc.parties([
    {
      label: 'Supplier',
      name: supplier?.name,
      lines: [supplier?.contactPerson, supplier?.phone, supplier?.email, supplier?.address, supplier?.taxNumber && `Tax No: ${supplier.taxNumber}`],
    },
    {
      label: 'Deliver to',
      name: settings.businessName || 'ALMTech',
      lines: [settings.address, settings.phone],
    },
  ]);

  doc.table({
    columns: itemColumns(doc, { priceLabel: 'Unit cost', showDiscount: false, showReceived: true }),
    rows: po.items || [],
    emptyText: 'This purchase order has no line items.',
  });

  const rows = [{ label: 'Subtotal', value: doc.money(po.subtotal) }];
  if (po.taxAmount) rows.push({ label: `Tax (${po.taxRate || 0}%)`, value: doc.money(po.taxAmount) });
  rows.push({ label: 'TOTAL', value: doc.money(po.total), grand: true });
  rows.push({ label: 'Paid', value: doc.money(po.paid), color: po.paid ? COLOR.positive : COLOR.ink500 });
  rows.push({ divider: true });
  rows.push({
    label: po.balance > 0 ? 'Balance owing' : 'Balance',
    value: doc.money(po.balance),
    strong: true,
    color: po.balance > 0 ? COLOR.warning : COLOR.ink900,
  });
  doc.totals(rows);

  if ((po.payments || []).length) {
    doc.ensure(60);
    doc.label('Payment history', doc.left, doc.y);
    doc.y += 14;
    doc.table({ columns: payColumns(doc), rows: po.payments, zebra: false, emptyText: 'No payments recorded.' });
  }

  if (po.status === 'cancelled') {
    doc.note('Important', 'This purchase order has been cancelled and is retained for the audit record only.');
  }
  doc.note('Notes', po.notes);

  doc.end({ footerNote: `Purchase Order ${po.number}` });
  return doc;
}

// ------------------------------------------------------------------ statements

/**
 * A running-balance statement. Used for customers, suppliers and accounts — the
 * shape is identical, only the party and the column meanings differ.
 *
 * `entries` are supplied already computed by the caller from the existing finance
 * endpoints; this function never derives a balance of its own.
 */
export function buildStatement({
  title, party, entries, settings, summary = [], asOf = new Date(),
  debitLabel = 'Debit', creditLabel = 'Credit', footerNote, periodLabel,
  res, download, filename,
}) {
  const doc = new Doc({
    title,
    subject: `${title}${party?.name ? ` — ${party.name}` : ''}`,
    currency: settings.currency || 'PKR',
    settings, res, download, filename: filename || title,
  });

  doc.header({
    title: title.toUpperCase(),
    date: asOf,
    dateLabel: 'As at',
    extraMeta: periodLabel ? [['Period', periodLabel]] : [],
  });

  if (party) {
    doc.parties([{ label: party.label || 'Account of', name: party.name, lines: party.lines || [] }]);
  }

  const cur = doc.currency;
  const cols = [
    { key: 'date', label: 'Date', width: 66, color: COLOR.ink500, render: (e) => docDate(e.date) },
    { key: 'type', label: 'Type', width: 84, color: COLOR.ink500, render: (e) => e.typeLabel || e.type || '—' },
    { key: 'desc', label: 'Description', width: 0, color: COLOR.ink900, render: (e) => e.description || '—', sub: (e) => e.reference || null },
    { key: 'debit', label: `${debitLabel} (${cur})`, width: 74, align: 'right', color: COLOR.positive, render: (e) => (e.debit ? doc.amount(e.debit) : '—') },
    { key: 'credit', label: `${creditLabel} (${cur})`, width: 74, align: 'right', render: (e) => (e.credit ? doc.amount(e.credit) : '—') },
    { key: 'balance', label: `Balance (${cur})`, width: 82, align: 'right', font: FONT.bold, color: COLOR.ink900, render: (e) => doc.amount(e.balance) },
  ];
  const fixed = cols.reduce((t, c) => t + c.width, 0);
  cols.find((c) => c.key === 'desc').width = doc.width - fixed;

  doc.table({ columns: cols, rows: entries, emptyText: 'No transactions in this period.' });

  if (summary.length) doc.totals(summary);

  doc.end({ footerNote });
  return doc;
}

// -------------------------------------------------------------- payment receipt

/**
 * A receipt for a single recorded payment. Deliberately short — it confirms one
 * movement of money against one document, and nothing else.
 */
export function buildReceipt({ payment, party, document: srcDoc, settings, kind = 'Payment', res, download }) {
  const doc = new Doc({
    title: `${kind} receipt`,
    subject: `${kind} receipt${srcDoc?.number ? ` for ${srcDoc.number}` : ''}`,
    currency: settings.currency || 'PKR',
    settings, res, download,
    filename: `receipt-${srcDoc?.number || payment.reference || 'payment'}`,
  });

  doc.header({
    title: 'RECEIPT',
    number: payment.reference || srcDoc?.number || null,
    date: payment.date,
    dateLabel: 'Received',
    status: payment.reversed ? 'voided' : undefined,
    extraMeta: [
      ['Method', PAY_METHOD[payment.method] || payment.method || '—'],
      srcDoc?.number ? ['Against', srcDoc.number] : null,
    ].filter(Boolean),
  });

  if (party) {
    doc.parties([{ label: party.label || 'Received from', name: party.name, lines: party.lines || [] }]);
  }

  doc.totals([
    { label: 'AMOUNT', value: doc.money(payment.amount), grand: true },
    ...(srcDoc
      ? [
          { label: `${srcDoc.label || 'Document'} total`, value: doc.money(srcDoc.total) },
          { label: 'Paid to date', value: doc.money(srcDoc.paid), color: COLOR.positive },
          { divider: true },
          {
            label: srcDoc.balance > 0 ? 'Balance remaining' : 'Balance',
            value: doc.money(srcDoc.balance),
            strong: true,
            color: srcDoc.balance > 0 ? COLOR.warning : COLOR.ink900,
          },
        ]
      : []),
  ]);

  if (payment.reversed) {
    doc.note(
      'Reversed',
      `This payment was reversed${payment.reversedAt ? ` on ${docDate(payment.reversedAt)}` : ''}${payment.reversalReason ? ` — ${payment.reversalReason}` : ''}. This receipt is retained for the audit record and does not evidence a payment received.`
    );
  }

  doc.end({ footerNote: srcDoc?.number ? `Receipt · ${srcDoc.number}` : 'Receipt' });
  return doc;
}
