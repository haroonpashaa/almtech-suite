import { useState } from 'react';
import toast from 'react-hot-toast';
import { viewDocument, downloadDocument, shareDocument, canShareFiles } from '../lib/documents.js';
import { Spinner } from './ui.jsx';

/* ---------------------------------------------------------------------------
   One control for every printable document in the suite.

   Touch targets stay at the standard control height so the actions are usable on
   a phone, and Share appears only where the platform can genuinely share a file —
   no polyfill, no extra dependency.
   --------------------------------------------------------------------------- */

const ICONS = {
  view: <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />,
  download: <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />,
  share: <path d="M12 3v13M8 7l4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />,
};

function Icon({ name }) {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

export default function DocumentActions({
  path,                 // e.g. `/invoices/abc/pdf`
  filename,             // e.g. `INV-0042`
  params,               // optional query (from/to for statements)
  label = 'PDF',
  size = '',            // 'btn-sm' for table rows
  primary = false,
}) {
  const [busy, setBusy] = useState(null);
  const shareable = canShareFiles();

  async function run(kind, fn) {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      toast.error(e?.message || 'The document could not be generated.');
    } finally {
      setBusy(null);
    }
  }

  const btn = `${primary ? 'btn-primary' : 'btn-secondary'} ${size}`.trim();

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        className={btn}
        disabled={!!busy}
        onClick={() => run('view', () => viewDocument(path, params))}
        aria-label={`View ${filename} as PDF`}
      >
        {busy === 'view' ? <Spinner className="w-4 h-4" /> : <Icon name="view" />}
        {label}
      </button>
      <button
        className={`btn-secondary ${size}`.trim()}
        disabled={!!busy}
        onClick={() => run('download', () => downloadDocument(path, filename, params))}
        aria-label={`Download ${filename} as PDF`}
        title="Download PDF"
      >
        {busy === 'download' ? <Spinner className="w-4 h-4" /> : <Icon name="download" />}
        <span className="sr-only sm:not-sr-only">Download</span>
      </button>
      {shareable && (
        <button
          className={`btn-secondary ${size}`.trim()}
          disabled={!!busy}
          onClick={() => run('share', () => shareDocument(path, filename, params))}
          aria-label={`Share ${filename}`}
          title="Share"
        >
          {busy === 'share' ? <Spinner className="w-4 h-4" /> : <Icon name="share" />}
        </button>
      )}
    </span>
  );
}
