import PDFDocument from 'pdfkit';
import { COLOR, PAGE, FONT, SIZE, findLogo, money, amount, docDate, STATUS_COLOR } from './theme.js';

/* ---------------------------------------------------------------------------
   The document engine.

   The previous generator positioned every cell absolutely with an ever-growing y
   and never checked the page boundary. Measured on real data before this rewrite:

     - a 2-item invoice produced a 2-PAGE pdf whose second page held nothing but
       the footer, so every printed invoice wasted a sheet
     - a 40-item invoice produced a 146-PAGE pdf in which individual cells landed
       on their own pages ("22", "PDF-LONG-1", "3", "PKR 123,456.78" each alone)

   The cause is that pdfkit auto-appends a page whenever text is drawn past the
   bottom margin. Absolute positioning past the page foot therefore does not clip,
   it paginates — once per cell.

   This engine flows instead. Every block measures itself first, asks the page
   whether it fits, and breaks deliberately when it does not. Nothing is ever drawn
   below the reserved footer band, so pdfkit never adds a page on its own.
   --------------------------------------------------------------------------- */

export class Doc {
  /**
   * `res` may be supplied so the response is piped BEFORE any content is written.
   * pdfkit buffers pages when `bufferPages` is on, and piping after `end()` races
   * the flush — so the destination is always attached up front.
   */
  constructor({ title, subject, currency = 'PKR', settings = {}, res, filename, download = false }) {
    this.currency = currency;
    this.settings = settings;
    this.pdf = new PDFDocument({
      size: PAGE.size,
      margin: PAGE.margin,
      // Buffered so "Page X of Y" can be written once the total is known, and so
      // the footer is stamped on every page rather than only the last.
      bufferPages: true,
      info: {
        Title: title || 'Document',
        Author: settings.businessName || 'ALM Business Suite',
        Subject: subject || title || '',
        Creator: 'ALM Business Suite',
        Producer: 'ALM Business Suite',
        CreationDate: new Date(),
      },
    });
    this.left = PAGE.margin;
    this.right = PAGE.width - PAGE.margin;
    this.width = this.right - this.left;
    // Nothing may be drawn below this line; the footer lives underneath it.
    this.contentBottom = PAGE.height - PAGE.margin - PAGE.footerHeight;
    this._onNewPage = null;
    if (res) this.streamTo(res, filename || title || 'document', { download });
  }

  get y() { return this.pdf.y; }
  set y(v) { this.pdf.y = v; }

  /** Remaining vertical space on the current page. */
  get remaining() { return this.contentBottom - this.pdf.y; }

  /** Break to a new page if `height` will not fit. Returns true if it broke. */
  ensure(height) {
    if (this.pdf.y + height <= this.contentBottom) return false;
    this.newPage();
    return true;
  }

  newPage() {
    this.pdf.addPage();
    this.pdf.y = PAGE.margin;
    if (this._onNewPage) this._onNewPage(this);
    return this;
  }

  /** Runs on every page created after the first — used for repeating table heads. */
  onNewPage(fn) { this._onNewPage = fn; return this; }

  // ---------------------------------------------------------------- primitives

  text(str, x, y, opts = {}) {
    const { size = SIZE.body, font = FONT.regular, color = COLOR.ink700, ...rest } = opts;
    this.pdf.font(font).fontSize(size).fillColor(color)
      .text(str == null || str === '' ? '' : String(str), x, y, { lineBreak: false, ...rest });
    return this;
  }

  /** Height a string will occupy at a given width — the basis of every fit check. */
  measure(str, { size = SIZE.body, font = FONT.regular, width } = {}) {
    return this.pdf.font(font).fontSize(size)
      .heightOfString(str == null ? '' : String(str), { width });
  }

  rule(y, { color = COLOR.ink100, width = 0.5, from = this.left, to = this.right } = {}) {
    this.pdf.moveTo(from, y).lineTo(to, y).strokeColor(color).lineWidth(width).stroke();
    return this;
  }

  label(str, x, y) {
    return this.text(String(str).toUpperCase(), x, y, {
      size: SIZE.sectionLabel, font: FONT.bold, color: COLOR.ink300, characterSpacing: 0.8,
    });
  }

  money(n) { return money(n, this.currency); }
  amount(n) { return amount(n); }

  // ------------------------------------------------------------------ sections

  /**
   * Masthead. Company identity on the left, document identity on the right.
   * Only fields the application actually holds are printed — nothing is invented.
   */
  header({ title, number, date, dateLabel = 'Date', status, extraMeta = [] }) {
    const s = this.settings;
    const pdf = this.pdf;

    pdf.rect(0, 0, PAGE.width, 5).fill(COLOR.brandMid);

    const logo = findLogo();
    let leftY = PAGE.margin - 6;
    if (logo) {
      try {
        pdf.image(logo, this.left, leftY, { fit: [150, 34] });
        leftY += 40;
      } catch {
        this.text(s.businessName || 'ALMTech', this.left, leftY, { size: 17, font: FONT.bold, color: COLOR.brandDeep });
        leftY += 24;
      }
    } else {
      this.text(s.businessName || 'ALMTech', this.left, leftY, { size: 17, font: FONT.bold, color: COLOR.brandDeep });
      leftY += 24;
    }

    // Company details, wrapped so a long address cannot collide with the table.
    const lines = [s.address, s.phone && `Tel: ${s.phone}`, s.email, s.taxNumber && `Tax No: ${s.taxNumber}`]
      .filter(Boolean);
    for (const line of lines) {
      const h = this.measure(line, { size: SIZE.bodySm, width: 240 });
      this.text(line, this.left, leftY, { size: SIZE.bodySm, color: COLOR.ink500, width: 240, lineBreak: true });
      leftY += h;
    }

    // Document identity, right aligned.
    const metaX = this.right - 230;
    let rightY = PAGE.margin - 4;
    this.text(title, metaX, rightY, { size: SIZE.docTitle, font: FONT.bold, color: COLOR.ink900, width: 230, align: 'right' });
    rightY += 26;

    const meta = [[dateLabel, docDate(date)], ...extraMeta];
    if (number) meta.unshift(['No', number]);
    for (const [k, v] of meta) {
      if (v == null || v === '') continue;
      this.text(k, metaX, rightY, { size: SIZE.meta, color: COLOR.ink300, width: 90, align: 'right' });
      this.text(String(v), metaX + 96, rightY, { size: SIZE.meta, font: FONT.bold, color: COLOR.ink700, width: 134, align: 'right' });
      rightY += 13;
    }

    if (status) {
      const col = STATUS_COLOR[String(status).toLowerCase()] || COLOR.ink500;
      const txt = String(status).toUpperCase();
      const w = this.pdf.font(FONT.bold).fontSize(SIZE.bodySm).widthOfString(txt) + 14;
      pdf.roundedRect(this.right - w, rightY + 1, w, 15, 3).fill(col);
      this.text(txt, this.right - w, rightY + 5, { size: SIZE.bodySm, font: FONT.bold, color: COLOR.white, width: w, align: 'center' });
      rightY += 20;
    }

    this.pdf.y = Math.max(leftY, rightY) + 14;
    this.rule(this.pdf.y);
    this.pdf.y += 14;
    return this;
  }

  /** A compact banner for continuation pages so every sheet identifies itself. */
  continuationHeader({ title, number }) {
    this.pdf.rect(0, 0, PAGE.width, 3).fill(COLOR.brandMid);
    this.text(`${title}${number ? ` · ${number}` : ''}`, this.left, PAGE.margin - 4,
      { size: SIZE.bodySm, font: FONT.bold, color: COLOR.ink500 });
    this.text('continued', this.right - 200, PAGE.margin - 4,
      { size: SIZE.bodySm, color: COLOR.ink300, width: 200, align: 'right' });
    this.pdf.y = PAGE.margin + 12;
    this.rule(this.pdf.y);
    this.pdf.y += 12;
    return this;
  }

  /**
   * Two facing parties (Bill To / Ship To, Supplier / Deliver To…). Both columns
   * are measured so a long name or address grows the block instead of overlapping
   * whatever comes next.
   */
  parties(blocks) {
    const colW = (this.width - 24) / Math.max(blocks.length, 1);
    const startY = this.pdf.y;
    let maxY = startY;

    blocks.forEach((b, i) => {
      const x = this.left + i * (colW + 24);
      let y = startY;
      this.label(b.label, x, y);
      y += 12;
      this.text(b.name || '—', x, y, { size: 11, font: FONT.bold, color: COLOR.ink900, width: colW, lineBreak: true });
      y += this.measure(b.name || '—', { size: 11, font: FONT.bold, width: colW });
      for (const line of (b.lines || []).filter(Boolean)) {
        this.text(line, x, y, { size: SIZE.bodySm, color: COLOR.ink500, width: colW, lineBreak: true });
        y += this.measure(line, { size: SIZE.bodySm, width: colW });
      }
      maxY = Math.max(maxY, y);
    });

    this.pdf.y = maxY + 16;
    return this;
  }

  /**
   * A flowing table.
   *
   * Rows are measured before they are drawn, so a wrapping description grows its
   * own row rather than colliding with the next one. When a row will not fit, the
   * page breaks and the column headings are repeated at the top of the new page —
   * the header is never orphaned and no row is ever split across a boundary.
   *
   * columns: [{ key, label, width, align, font, color, render(row) }]
   */
  table({ columns, rows, zebra = true, emptyText = 'No items' }) {
    const drawHead = () => {
      const y = this.pdf.y;
      this.pdf.rect(this.left, y - 4, this.width, 18).fill(COLOR.ink50);
      let x = this.left + 6;
      for (const c of columns) {
        this.text(c.label, x, y + 1, {
          size: SIZE.tableHead, font: FONT.bold, color: COLOR.ink400,
          width: c.width - 12, align: c.align || 'left', characterSpacing: 0.5,
        });
        x += c.width;
      }
      this.pdf.y = y + 18;
      this.rule(this.pdf.y, { color: COLOR.ink100 });
      this.pdf.y += 6;
    };

    const headHeight = 24;
    this.ensure(headHeight + 26);
    drawHead();

    // Continuation pages repeat the heading automatically.
    this.onNewPage(() => drawHead());

    if (!rows.length) {
      this.text(emptyText, this.left + 6, this.pdf.y + 4, { size: SIZE.row, color: COLOR.ink300 });
      this.pdf.y += 22;
      this.onNewPage(null);
      return this;
    }

    let index = 0;
    for (const row of rows) {
      const cells = columns.map((c) => (c.render ? c.render(row, index) : row[c.key] ?? ''));
      // The tallest cell decides the row height.
      const h = Math.max(
        ...columns.map((c, i) =>
          this.measure(cells[i], { size: c.size || SIZE.row, font: c.font || FONT.regular, width: c.width - 12 })
        ),
        12
      );
      const sub = columns.find((c) => c.sub)?.sub?.(row);
      const subH = sub ? this.measure(sub, { size: 7.2, width: 200 }) : 0;
      const rowH = h + subH + 9;

      this.ensure(rowH);

      const y = this.pdf.y;
      if (zebra && index % 2 === 1) {
        this.pdf.rect(this.left, y - 3, this.width, rowH).fill(COLOR.ink50);
      }

      let x = this.left + 6;
      columns.forEach((c, i) => {
        this.text(cells[i], x, y, {
          size: c.size || SIZE.row,
          font: c.font || FONT.regular,
          color: typeof c.color === 'function' ? c.color(row) : c.color || COLOR.ink700,
          width: c.width - 12,
          align: c.align || 'left',
          lineBreak: true,
        });
        x += c.width;
      });

      if (sub) {
        const subCol = columns.findIndex((c) => c.sub);
        const subX = this.left + 6 + columns.slice(0, subCol).reduce((t, c) => t + c.width, 0);
        this.text(sub, subX, y + h + 1, {
          size: 7.2, color: COLOR.ink300, width: columns[subCol].width - 12, lineBreak: true,
        });
      }

      this.pdf.y = y + rowH;
      index += 1;
    }

    this.onNewPage(null);
    this.rule(this.pdf.y);
    this.pdf.y += 4;
    return this;
  }

  /**
   * The totals block. Kept together: if the whole stack will not fit on the
   * current page it moves to the next one, so a grand total can never be
   * separated from the figures that produce it.
   */
  totals(rows, { width = 240 } = {}) {
    const lineH = 15;
    const grandH = 26;
    const needed = rows.reduce((t, r) => t + (r.grand ? grandH : lineH), 0) + 10;
    this.ensure(needed);

    const x = this.right - width;
    for (const r of rows) {
      if (r.divider) {
        this.rule(this.pdf.y + 2, { from: x, to: this.right });
        this.pdf.y += 8;
        continue;
      }
      const y = this.pdf.y;
      if (r.grand) {
        this.pdf.rect(x, y - 2, width, 22).fill(COLOR.brandDeep);
        this.text(r.label, x + 10, y + 4, { size: SIZE.grandTotal, font: FONT.bold, color: COLOR.white, width: width * 0.5 });
        this.text(r.value, x + width * 0.5, y + 4, {
          size: SIZE.grandTotal, font: FONT.bold, color: COLOR.white, width: width * 0.5 - 10, align: 'right',
        });
        this.pdf.y = y + grandH;
      } else {
        this.text(r.label, x, y, { size: SIZE.totalRow, color: r.strong ? COLOR.ink900 : COLOR.ink500, font: r.strong ? FONT.bold : FONT.regular, width: width * 0.55 });
        this.text(r.value, x + width * 0.55, y, {
          size: SIZE.totalRow, font: r.strong ? FONT.bold : FONT.regular,
          color: r.color || COLOR.ink900, width: width * 0.45 - 4, align: 'right',
        });
        this.pdf.y = y + lineH;
      }
    }
    this.pdf.y += 6;
    return this;
  }

  /** A free-text block (notes, terms) that flows and breaks cleanly. */
  note(label, body) {
    if (!body) return this;
    const h = this.measure(body, { size: SIZE.bodySm, width: this.width - 12 });
    this.ensure(h + 26);
    this.label(label, this.left, this.pdf.y);
    this.pdf.y += 12;
    this.text(body, this.left, this.pdf.y, { size: SIZE.bodySm, color: COLOR.ink500, width: this.width - 12, lineBreak: true });
    this.pdf.y += h + 10;
    return this;
  }

  /**
   * Stamp the footer on every page and finish.
   *
   * Written after all content so "Page X of Y" knows Y. The bottom margin is
   * temporarily released, because drawing inside the reserved footer band would
   * otherwise be treated by pdfkit as an overflow and append yet another page —
   * which is exactly how the previous generator produced a blank trailing sheet.
   */
  end({ footerNote } = {}) {
    const s = this.settings;
    const range = this.pdf.bufferedPageRange();
    const total = range.count;

    for (let i = 0; i < total; i++) {
      this.pdf.switchToPage(range.start + i);
      const saved = this.pdf.page.margins.bottom;
      this.pdf.page.margins.bottom = 0;

      const y = PAGE.height - PAGE.margin - 18;
      this.rule(y - 6, { color: COLOR.ink100 });

      const left = [s.businessName || 'ALMTech', s.phone, s.email].filter(Boolean).join('  ·  ');
      this.text(left, this.left, y, { size: 7.2, color: COLOR.ink300, width: this.width * 0.6 });
      if (footerNote) {
        this.text(footerNote, this.left, y + 9, { size: 7.2, color: COLOR.ink300, width: this.width * 0.6 });
      }
      this.text(`Page ${i + 1} of ${total}`, this.right - 160, y, {
        size: 7.2, color: COLOR.ink400, width: 160, align: 'right',
      });

      this.pdf.page.margins.bottom = saved;
    }

    this.pdf.flushPages();
    this.pdf.end();
    return this;
  }

  /** Pipe to an Express response with the right headers. */
  streamTo(res, filename, { download = false } = {}) {
    res.setHeader('Content-Type', 'application/pdf');
    // The filename is derived from a document number, but it is sanitised anyway so
    // no separator or quote can escape the header.
    const safe = String(filename).replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'document';
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${safe}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    this.pdf.pipe(res);
    return this;
  }
}

export { money, amount, docDate, COLOR, FONT, SIZE };
