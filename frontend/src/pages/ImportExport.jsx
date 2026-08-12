import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { datetime, errorMessage } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Table from '../components/Table.jsx';
import { Badge, Spinner } from '../components/ui.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

const ACTION_TONE = { CREATE: 'success', UPDATE: 'warning', SKIP: 'neutral', ERROR: 'danger' };
const STATUS_TONE = { completed: 'success', completed_with_errors: 'warning', failed: 'danger' };

// Export types that accept a date range, and the two report exports that take a
// single date / month. Everything else exports in full.
const RANGE_EXPORTS = new Set(['sales', 'purchases', 'payments', 'expenses', 'account-ledgers', 'deals', 'profit-loss']);

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ImportExport() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('import');

  // Import state
  const [type, setType] = useState('products');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmImport, setConfirmImport] = useState(false);
  const fileRef = useRef(null);

  // Export state
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [exporting, setExporting] = useState('');

  const { data: types } = useQuery({
    queryKey: ['data-types'],
    queryFn: async () => (await api.get('/data/types')).data,
  });
  const { data: history } = useQuery({
    queryKey: ['import-history'],
    queryFn: async () => (await api.get('/data/history')).data,
  });

  const current = types?.imports?.find((t) => t.key === type);

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  function pickFile(f) {
    setFile(f);
    setPreview(null);
    setResult(null);
  }

  async function validate() {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post(`/data/import/${type}/validate`, fd);
      setPreview(data);
      if (data.summary.invalid > 0) toast.error(`${data.summary.invalid} row(s) have problems — review below`);
      else toast.success(`${data.summary.valid} row(s) ready to import`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!file || !preview) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post(`/data/import/${type}/commit`, fd);
      setResult(data);
      setPreview(null);
      toast.success(`Imported — ${data.result.created} created, ${data.result.updated} updated`);
      qc.invalidateQueries({ queryKey: ['import-history'] });
      // Anything the import may have moved.
      ['dashboard', 'accounts-summary', 'products', 'expenses', 'receivables', 'payables', 'finance-position', 'deals'].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] })
      );
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate() {
    try {
      const res = await api.get(`/data/templates/${type}`, { responseType: 'blob' });
      downloadBlob(res.data, `almtech-template-${type}.xlsx`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function downloadErrors() {
    const errors = result?.errors || preview?.rows?.flatMap((r) => r.errors.map((e) => ({ row: r.excelRow, ...e }))) || [];
    if (!errors.length) return;
    try {
      const res = await api.post(`/data/import/${type}/errors-file`, { errors, label: current?.label }, { responseType: 'blob' });
      downloadBlob(res.data, `import-errors-${type}.xlsx`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function runExport(key) {
    setExporting(key);
    try {
      const params = {};
      if (RANGE_EXPORTS.has(key)) {
        if (from) params.from = from;
        if (to) params.to = to;
      }
      if (key === 'expenses-daily') params.date = day;
      if (key === 'expenses-monthly') params.month = month;
      const res = await api.get(`/data/export/${key}`, { params, responseType: 'blob' });
      downloadBlob(res.data, `almtech-${key}-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('Export downloaded');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting('');
    }
  }

  const errorRows = preview?.rows?.filter((r) => r.action === 'ERROR') || [];
  const okRows = preview?.rows?.filter((r) => r.action !== 'ERROR') || [];

  return (
    <div>
      <PageHeader
        title="Import & Export"
        subtitle="Move data between Excel and ALM Suite"
        icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>}
      />
      <div className="page page-w space-y-4">
        <div className="segment w-fit">
          <button onClick={() => setTab('import')} className={`segment-item ${tab === 'import' ? 'segment-item-active' : ''}`}>Import</button>
          <button onClick={() => setTab('export')} className={`segment-item ${tab === 'export' ? 'segment-item-active' : ''}`}>Export</button>
          <button onClick={() => setTab('history')} className={`segment-item ${tab === 'history' ? 'segment-item-active' : ''}`}>History</button>
        </div>

        {/* ---------------- IMPORT ---------------- */}
        {tab === 'import' && (
          <>
            <div className="card p-5 space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[220px]">
                  <label htmlFor="importexport-what-are-you-importing-23" className="label">What are you importing?</label>
                  <select id="importexport-what-are-you-importing-23" className="select" value={type} onChange={(e) => { setType(e.target.value); reset(); }}>
                    {(types?.imports || []).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </div>
                <button className="btn-secondary" onClick={downloadTemplate}>Download template</button>
              </div>

              {current && (
                <div className="rounded-lg bg-ink-25 border border-ink-100 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-ink-400 mb-1.5">How this import works</div>
                  <ul className="text-sm text-ink-600 space-y-1 list-disc pl-4">
                    {current.instructions.map((i, k) => <li key={k}>{i}</li>)}
                  </ul>
                  <div className="text-xs text-ink-400 mt-2">
                    Required columns: <span className="font-medium text-ink-600">{current.requiredColumns.join(', ')}</span>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => pickFile(e.target.files?.[0] || null)}
                  className="text-sm text-ink-600 file:mr-3 file:btn-sm file:bg-white file:border file:border-ink-200 file:text-ink-700 file:rounded-lg file:cursor-pointer"
                />
                <button className="btn-secondary" onClick={validate} disabled={!file || busy}>
                  {busy && !result ? <><Spinner className="w-4 h-4" /> Checking…</> : 'Preview & validate'}
                </button>
                {file && <button className="btn-secondary" onClick={reset}>Clear</button>}
                <span className="text-xs text-ink-400">Nothing is saved until you confirm. Max 10 MB, .xlsx only.</span>
              </div>
            </div>

            {preview && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {[
                    ['Total rows', preview.summary.totalRows, ''],
                    ['Valid', preview.summary.valid, 'text-emerald-600'],
                    ['Invalid', preview.summary.invalid, preview.summary.invalid ? 'text-red-600' : ''],
                    ['Will create', preview.summary.create, 'text-emerald-600'],
                    ['Will update', preview.summary.update, 'text-amber-600'],
                    ['Will skip', preview.summary.skip, 'text-ink-400'],
                  ].map(([label, value, cls]) => (
                    <div key={label} className="card p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{label}</div>
                      <div className={`mt-1 text-xl font-semibold num ${cls || 'text-ink-900'}`}>{value}</div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button className="btn-primary" onClick={() => setConfirmImport(true)} disabled={busy || preview.summary.valid === 0}>
                    {busy ? <><Spinner className="w-4 h-4" /> Importing…</> : `Confirm import of ${preview.summary.valid} row(s)`}
                  </button>
                  {preview.summary.invalid > 0 && (
                    <button className="btn-secondary" onClick={downloadErrors}>Download {preview.summary.invalid} failed row(s)</button>
                  )}
                  <span className="text-xs text-ink-400">
                    {preview.summary.invalid > 0 ? 'Invalid rows are skipped — valid rows still import.' : 'All rows passed validation.'}
                  </span>
                </div>

                {errorRows.length > 0 && (
                  <div>
                    <div className="section-title mb-2">Problems found</div>
                    <Table
                      empty="No problems"
                      columns={[
                        { key: 'row', label: 'Excel Row', className: 'text-right num text-ink-500', render: (r) => r.excelRow },
                        { key: 'field', label: 'Field', render: (r) => r.errors.map((e) => e.field).join(', ') },
                        { key: 'value', label: 'Value', render: (r) => <span className="font-mono text-[12px] text-ink-500">{r.errors.map((e) => e.value).filter(Boolean).join(', ') || '—'}</span> },
                        { key: 'reason', label: 'Reason', render: (r) => <span className="text-red-600">{r.errors.map((e) => e.message).join('; ')}</span> },
                      ]}
                      rows={errorRows}
                    />
                  </div>
                )}

                {okRows.length > 0 && (
                  <div>
                    <div className="section-title mb-2">Ready to import</div>
                    <Table
                      empty="Nothing to import"
                      columns={[
                        { key: 'row', label: 'Excel Row', className: 'text-right num text-ink-500', render: (r) => (r.excelRows ? r.excelRows.join(', ') : r.excelRow) },
                        { key: 'action', label: 'Action', render: (r) => <Badge tone={ACTION_TONE[r.action]} dot>{r.action}</Badge> },
                        { key: 'key', label: 'Identifier', render: (r) => <span className="font-mono text-[12px] text-ink-600">{r.key || '—'}</span> },
                        { key: 'note', label: 'What will happen', render: (r) => <span className="text-ink-600">{r.note || '—'}</span> },
                      ]}
                      rows={okRows.slice(0, 300)}
                    />
                    {okRows.length > 300 && <p className="text-xs text-ink-400 mt-2">Showing the first 300 of {okRows.length} rows.</p>}
                  </div>
                )}
              </>
            )}

            {result && (
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-ink-900">Import complete</h3>
                  <Badge tone={STATUS_TONE[result.status]} dot>{result.status.replace(/_/g, ' ')}</Badge>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[['Created', result.result.created, 'text-emerald-600'], ['Updated', result.result.updated, 'text-amber-600'], ['Skipped', result.result.skipped, 'text-ink-400'], ['Failed', result.result.failed, result.result.failed ? 'text-red-600' : 'text-ink-400']].map(([l, v, c]) => (
                    <div key={l}>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{l}</div>
                      <div className={`mt-1 text-xl font-semibold num ${c}`}>{v}</div>
                    </div>
                  ))}
                </div>
                {result.errors.length > 0 && (
                  <button className="btn-secondary mt-4" onClick={downloadErrors}>Download {result.errors.length} failed row(s)</button>
                )}
                <button className="btn-secondary mt-4 ml-2" onClick={reset}>Import another file</button>
              </div>
            )}
          </>
        )}

        {/* ---------------- EXPORT ---------------- */}
        {tab === 'export' && (
          <>
            <div className="card p-5">
              <div className="flex flex-wrap items-end gap-3">
                <div><label htmlFor="importexport-from-203" className="label">From</label><input id="importexport-from-203" className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
                <div><label htmlFor="importexport-to-204" className="label">To</label><input id="importexport-to-204" className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
                <div><label htmlFor="importexport-daily-report-date-205" className="label">Daily report date</label><input id="importexport-daily-report-date-205" className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></div>
                <div><label htmlFor="importexport-monthly-report-month-206" className="label">Monthly report month</label><input id="importexport-monthly-report-month-206" className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
                {(from || to) && <button className="btn-secondary" onClick={() => { setFrom(''); setTo(''); }}>Clear range</button>}
              </div>
              <p className="text-xs text-ink-400 mt-3">
                The date range applies to Sales, Purchases, Payments, Expenses, Account Ledgers, Deals and P&amp;L. Leave it blank to export everything.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(types?.exports || []).map((e) => (
                <button
                  key={e.key}
                  onClick={() => runExport(e.key)}
                  disabled={!!exporting}
                  className="card card-hover p-4 text-left flex items-center justify-between gap-3 disabled:opacity-60"
                >
                  <div>
                    <div className="font-medium text-ink-900 text-sm">{e.label}</div>
                    <div className="text-xs text-ink-400 mt-0.5">
                      {RANGE_EXPORTS.has(e.key) ? 'Respects the date range' : e.key.startsWith('expenses-') ? 'Uses the report date above' : 'Full export'}
                    </div>
                  </div>
                  {exporting === e.key ? (
                    <Spinner className="w-4 h-4 text-brand-600" />
                  ) : (
                    <svg className="w-4 h-4 text-ink-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {/* ---------------- HISTORY ---------------- */}
        {tab === 'history' && (
          <>
            <p className="text-xs text-ink-400">Only import results are recorded — uploaded spreadsheets are parsed in memory and never stored.</p>
            <Table
              empty="No imports yet"
              columns={[
                { key: 'createdAt', label: 'When', render: (r) => <span className="text-ink-500 whitespace-nowrap">{datetime(r.createdAt)}</span> },
                { key: 'label', label: 'Type', render: (r) => <span className="font-medium text-ink-900">{r.label}</span> },
                { key: 'filename', label: 'File', render: (r) => <span className="font-mono text-[12px] text-ink-500">{r.filename}</span> },
                { key: 'importedBy', label: 'By', render: (r) => <span className="text-ink-500">{r.importedBy || '—'}</span> },
                { key: 'totalRows', label: 'Rows', className: 'text-right num text-ink-500', render: (r) => r.totalRows },
                { key: 'created', label: 'Created', className: 'text-right num text-emerald-600', render: (r) => r.created },
                { key: 'updated', label: 'Updated', className: 'text-right num text-amber-600', render: (r) => r.updated },
                { key: 'skipped', label: 'Skipped', className: 'text-right num text-ink-400', render: (r) => r.skipped },
                { key: 'failed', label: 'Failed', className: 'text-right num', render: (r) => <span className={r.failed ? 'text-red-600' : 'text-ink-400'}>{r.failed}</span> },
                { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]} dot>{r.status.replace(/_/g, ' ')}</Badge> },
              ]}
              rows={history || []}
            />
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirmImport}
        onClose={() => setConfirmImport(false)}
        onConfirm={commit}
        tone="primary"
        title="Import these records?"
        description="This writes to the database. Rows that failed validation are skipped — everything else is applied."
        consequences={preview ? [
          `${preview.summary.create} record(s) will be created`,
          `${preview.summary.update} existing record(s) will be updated`,
          `${preview.summary.skip} row(s) already present will be skipped`,
          preview.summary.invalid > 0
            ? `${preview.summary.invalid} invalid row(s) will not be imported`
            : 'Every row passed validation',
        ] : []}
        confirmLabel="Import now"
      />

    </div>
  );
}