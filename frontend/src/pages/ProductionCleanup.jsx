// ---------------------------------------------------------------------------
// TEMPORARY — one-time production data cleanup trigger, for the ALM Suite
// delivery handover only. Deliberately not linked from the sidebar
// (Layout.jsx) — reachable only by an Admin who navigates to this URL
// directly. Delete this file, its App.jsx route, and the backend route
// (routes/productionCleanup.routes.js + controllers/productionCleanup.controller.js
// + the app.js mount line) once the cleanup has been run and confirmed.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { api } from '../api/client.js';
import { errorMessage } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import { Badge, Spinner } from '../components/ui.jsx';

const CONFIRMATION_PHRASE = 'CLEAN ALMTECH PRODUCTION DATA';

function ResultPanel({ title, result }) {
  if (!result) return null;
  return (
    <div className={`card p-5 border-2 ${result.ok ? 'border-emerald-300' : 'border-red-300'}`}>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        <Badge tone={result.ok ? 'success' : 'danger'} dot>{result.ok ? 'Success' : 'Failed'}</Badge>
      </div>
      {result.target && (
        <div className="text-xs text-ink-600 space-y-0.5 mb-3">
          <div>Environment: <span className="font-mono">{result.target.environment}</span></div>
          <div>Connection source: <span className="font-mono">{result.target.connectionSource}</span></div>
          <div>Embedded fallback: <span className="font-mono">{result.target.embeddedFallback}</span></div>
          {result.target.databaseType && <div>Database type: <span className="font-mono">{result.target.databaseType}</span></div>}
          {result.target.databaseName && <div>Database name: <span className="font-mono">{result.target.databaseName}</span></div>}
        </div>
      )}
      {!result.ok && result.reason && (
        <p className="text-sm text-red-700 mb-3">{result.reason}</p>
      )}
      {result.before && (
        <div className="mb-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-400 mb-1">
            {result.after ? 'Before -> After' : 'Current counts (before)'}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-0.5 text-sm font-mono">
            {Object.keys(result.before).map((name) => (
              <div key={name} className="flex justify-between gap-2">
                <span className="text-ink-500">{name}</span>
                <span className="text-ink-900">{result.before[name]}{result.after ? ` -> ${result.after[name]}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {result.adminEmail && (
        <p className="text-sm text-emerald-700 mb-2">Bootstrap admin created: <span className="font-mono">{result.adminEmail}</span></p>
      )}
      {Array.isArray(result.log) && result.log.length > 0 && (
        <details className="mt-2">
          <summary className="text-xs text-ink-400 cursor-pointer">Full log ({result.log.length} lines)</summary>
          <pre className="text-[11px] bg-ink-50 rounded-lg p-3 mt-2 overflow-x-auto whitespace-pre-wrap">{result.log.join('\n')}</pre>
        </details>
      )}
    </div>
  );
}

export default function ProductionCleanup() {
  const [token, setToken] = useState('');
  const [confirmationText, setConfirmationText] = useState('');
  const [dryRunResult, setDryRunResult] = useState(null);
  const [executeResult, setExecuteResult] = useState(null);
  const [dryRunSucceeded, setDryRunSucceeded] = useState(false);
  const [busy, setBusy] = useState(false);

  const phraseMatches = confirmationText === CONFIRMATION_PHRASE;
  const canExecute = phraseMatches && dryRunSucceeded && !!token;

  async function runDryRun() {
    setBusy(true);
    setExecuteResult(null);
    try {
      const { data } = await api.post('/admin/production-cleanup', { mode: 'dry-run', token });
      setDryRunResult(data);
      setDryRunSucceeded(!!data.ok);
    } catch (e) {
      setDryRunResult({ ok: false, reason: errorMessage(e) });
      setDryRunSucceeded(false);
    } finally {
      setBusy(false);
    }
  }

  async function runExecute() {
    if (!canExecute) return;
    // Second, browser-native confirmation — a deliberate extra step beyond
    // the disabled-button gate, specifically because this action is
    // irreversible against live production data.
    const confirmed = window.confirm(
      'This will PERMANENTLY delete live production business data (products, customers, suppliers, sales, purchases, expenses, and all transaction history) and replace all logins with one new admin account.\n\n' +
      'This cannot be undone without restoring from a backup.\n\n' +
      'Are you completely sure you want to proceed?'
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      const { data } = await api.post('/admin/production-cleanup', {
        mode: 'execute',
        token,
        confirmationPhrase: confirmationText,
      });
      setExecuteResult(data);
    } catch (e) {
      setExecuteResult({ ok: false, reason: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Production Cleanup (Temporary)"
        subtitle="One-time delivery handover tool — not part of normal ALM Suite functionality"
      />
      <div className="page page-w space-y-4">
        <div className="card p-5 border-2 border-red-400 bg-red-50">
          <div className="flex items-start gap-3">
            <svg className="w-6 h-6 text-red-600 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
            <div>
              <h2 className="text-sm font-bold text-red-800">This screen affects LIVE PRODUCTION data</h2>
              <p className="text-sm text-red-700 mt-1">
                Running the cleanup here deletes real business records permanently — products, customers, suppliers, sales,
                purchases, expenses, and all financial transaction history — and replaces every login with a single new
                admin account. Only use this if you are the person responsible for the ALM Suite handover and you have
                already confirmed a backup exists. Do not use this screen unless you understand exactly what it does.
              </p>
            </div>
          </div>
        </div>

        <div className="card p-5 space-y-3">
          <div>
            <label htmlFor="pc-token" className="label">Cleanup token <span className="text-red-500">*</span></label>
            <input
              id="pc-token"
              type="password"
              autoComplete="off"
              className="input font-mono"
              value={token}
              onChange={(e) => { setToken(e.target.value); setDryRunSucceeded(false); }}
              placeholder="Paste the one-time cleanup token"
            />
            <p className="text-xs text-ink-400 mt-1">This is not your login password — it's the separate one-time token set up for this handover.</p>
          </div>

          <button className="btn-secondary" onClick={runDryRun} disabled={busy || !token}>
            {busy ? <><Spinner className="w-4 h-4" /> Checking…</> : 'Run Dry Run (reads only, changes nothing)'}
          </button>
        </div>

        <ResultPanel title="Dry Run Result" result={dryRunResult} />

        <div className="card p-5 space-y-3">
          <div>
            <label htmlFor="pc-confirm" className="label">
              Type the exact confirmation phrase to enable Execute <span className="text-red-500">*</span>
            </label>
            <input
              id="pc-confirm"
              className="input font-mono"
              value={confirmationText}
              onChange={(e) => setConfirmationText(e.target.value)}
              placeholder={CONFIRMATION_PHRASE}
            />
            <p className={`text-xs mt-1 ${phraseMatches ? 'text-emerald-600' : 'text-ink-400'}`}>
              Must exactly match: <span className="font-mono">{CONFIRMATION_PHRASE}</span>
            </p>
          </div>

          {!dryRunSucceeded && (
            <p className="text-xs text-amber-700">A successful Dry Run is required first — run it above before Execute can be used.</p>
          )}

          <button className="btn-primary bg-red-600 hover:bg-red-700 border-red-600" onClick={runExecute} disabled={busy || !canExecute}>
            {busy ? <><Spinner className="w-4 h-4" /> Running…</> : 'Execute Cleanup (permanent, cannot be undone)'}
          </button>
        </div>

        <ResultPanel title="Execute Result" result={executeResult} />
      </div>
    </div>
  );
}
