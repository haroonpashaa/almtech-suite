/* ---------------------------------------------------------------------------
   Backward-compatible entry point.

   `streamInvoicePDF` keeps its original name, signature and behaviour — it still
   takes (res, { invoice, customer, settings }) and streams an A4 invoice — so the
   existing route and controller call site are untouched.

   What changed is underneath. The original implementation positioned every cell
   absolutely and never checked the page boundary, which pdfkit answers by adding a
   page rather than clipping. Measured on real data:

     -  2-item invoice  →   2 pages, the second holding only the footer
     - 40-item invoice  → 146 pages, with single cells stranded on their own page

   It is now rendered by the shared document engine, which measures and flows.
   --------------------------------------------------------------------------- */
export { streamInvoicePDF } from './pdf/index.js';
