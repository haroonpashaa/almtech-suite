// Paste a spreadsheet selection into consecutive cart lines in row-major order.
// Every cell is validated before the caller changes the cart, so mixed tables are atomic failures.
export function parsePricingPaste(text, remaining) {
  const rows = String(text).trim().split(/\r?\n/).map((row) => row.split('\t'));
  const width = rows[0]?.length || 0;
  if (!width || rows.some((row) => row.length !== width)) throw new Error('Paste a rectangular range of prices.');
  const cells = rows.flat();
  if (!cells.length || cells.length > remaining) throw new Error(`Paste up to ${remaining} price${remaining === 1 ? '' : 's'} starting here.`);
  return cells.map((cell) => {
    const value = cell.trim();
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value)) throw new Error(`Invalid price "${value}". Use numbers with up to 2 decimal places.`);
    const amount = Number(value.replaceAll(',', ''));
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`Invalid price "${value}".`);
    return String(amount);
  });
}
