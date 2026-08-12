import { api } from '../api/client.js';

/* ---------------------------------------------------------------------------
   Opening a document.

   The invoice PDF link used to be a plain <a href="/api/invoices/:id/pdf">. That
   could never work: the API authenticates with a Bearer token held in
   localStorage, and a browser navigation cannot attach a request header. The link
   returned 401 every time — verified against the running server.

   Fetching through the shared axios client keeps the interceptor (and therefore
   the token, and the 401 redirect) and hands back a blob we can open or save.
   --------------------------------------------------------------------------- */

async function fetchPdf(path, params = {}) {
  const res = await api.get(path, { params, responseType: 'blob' });
  // An error body is JSON, not a PDF; surface the real message rather than
  // opening a window containing a serialised error.
  if (res.data?.type && !res.data.type.includes('pdf')) {
    const text = await res.data.text();
    let msg = 'The document could not be generated.';
    try { msg = JSON.parse(text).message || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.data;
}

/** Open a document in a new tab. Falls back to a download if popups are blocked. */
export async function viewDocument(path, params) {
  const blob = await fetchPdf(path, params);
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
  }
  // Give the tab time to take the blob before the URL is revoked.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Save a document to disk under a readable name. */
export async function downloadDocument(path, filename, params) {
  const blob = await fetchPdf(path, { ...params, download: 1 });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${String(filename || 'document').replace(/[^\w.\-]+/g, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Share, where the platform genuinely supports sharing a file. No polyfill and no
 * dependency: if the browser cannot do it, the caller simply does not offer it.
 */
export function canShareFiles() {
  return typeof navigator !== 'undefined'
    && typeof navigator.canShare === 'function'
    && typeof navigator.share === 'function'
    && (() => { try { return navigator.canShare({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] }); } catch { return false; } })();
}

export async function shareDocument(path, filename, params) {
  const blob = await fetchPdf(path, params);
  const file = new File([blob], `${String(filename || 'document').replace(/[^\w.\-]+/g, '_')}.pdf`, { type: 'application/pdf' });
  await navigator.share({ files: [file], title: filename });
}
