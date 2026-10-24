import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../api/client.js';
import { newIdempotencyKey } from '../lib/idempotency.js';
import { errorMessage } from '../lib/format.js';

export function useSaleDraft(state, restore, onFinalized) {
  const latest = useRef(state); latest.current = state;
  const apply = useRef(restore); apply.current = restore;
  const finalized = useRef(onFinalized); finalized.current = onFinalized;
  const current = useRef({ id: newIdempotencyKey(), revision: 0 });
  const saved = useRef('');
  const chain = useRef(Promise.resolve());
  const debounce = useRef(null);
  const reloadGate = useRef(null);
  const [saving, setSaving] = useState(null);
  const [saveFailure, setSaveFailure] = useState(null);
  const actionInFlight = useRef(false);
  const stopped = useRef(false);
  const mounted = useRef(true);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const page = useRef(1);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const meaningful = s => s.cart.length || s.customer || s.notes || Object.keys(s.stockSelection || {}).length;

  function queueSave() {
    const snapshot = structuredClone(latest.current);
    const json = JSON.stringify(snapshot);
    const target = current.current;
    const pending = chain.current.catch(() => {}).then(async () => {
      if (stopped.current || target !== current.current || (!meaningful(snapshot) && !target.revision) || saved.current === json) return target;
      const request = { target, json };
      if (mounted.current) {
        setSaving(request);
        setSaveFailure(null);
        setStatus('Saving draft…');
      }
      try {
        const { data } = await api.put(`/sale-drafts/${target.id}`, { state: snapshot, revision: target.revision });
        target.revision = data.revision;
        if (target === current.current) saved.current = json;
        if (mounted.current) {
          if (target === current.current) setStatus(JSON.stringify(latest.current) === json ? 'Draft saved' : 'Unsaved changes');
          setDrafts(rows => [data, ...rows.filter(row => row._id !== data._id)]);
        }
        return target;
      } catch (error) {
        if (target === current.current) {
          const failure = { target, json, message: `Draft not saved: ${errorMessage(error)}` };
          if (mounted.current) { setSaveFailure(failure); setStatus(failure.message); }
        }
        throw error;
      } finally {
        if (mounted.current) setSaving(active => active === request ? null : active);
      }
    });
    chain.current = pending;
    return pending;
  }
  function flush() {
    // Reload owns an exclusive read boundary. Capture the snapshot only after
    // that boundary closes, so logout/manual flushes cannot race the GET.
    if (reloadGate.current) return reloadGate.current.promise.then(() => flushRef.current());
    return queueSave();
  }
  const flushRef = useRef(flush); flushRef.current = flush;
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    api.get('/sale-drafts').then(({ data }) => {
      if (cancelled) return;
      const rows = Array.isArray(data) ? data : [];
      setDrafts(rows); setHasMore(rows.length === 50);
      if (rows[0]) {
        current.current = { id: rows[0]._id, revision: rows[0].revision };
        saved.current = JSON.stringify(rows[0].state);
        latest.current = rows[0].state;
        apply.current(rows[0].state);
        setStatus('Draft restored');
      }
      setLoading(false);
    }).catch(error => { if (!cancelled) setStatus(`Cannot load drafts: ${errorMessage(error)}. Reload before editing.`); });
    const beforeLogout = event => { event.detail.tasks.push(flushRef.current()); };
    window.addEventListener('erp:before-logout', beforeLogout);
    return () => {
      cancelled = true; mounted.current = false;
      window.removeEventListener('erp:before-logout', beforeLogout);
      // In-app navigation keeps requests alive. A hard close can only preserve
      // the last acknowledged save; never represent an unacknowledged save as durable.
      if (!stopped.current) void flushRef.current().catch(() => {});
    };
  }, []);
  const json = JSON.stringify(state);
  useEffect(() => {
    if (loading || stopped.current) return;
    const timer = reloadGate.current ? null : setTimeout(() => {
      if (debounce.current === timer) debounce.current = null;
      if (!reloadGate.current) void flushRef.current().catch(() => {});
    }, 400);
    debounce.current = timer;
    const beforeUnload = event => {
      if ((meaningful(latest.current) || current.current.revision) && saved.current !== JSON.stringify(latest.current)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { clearTimeout(timer); if (debounce.current === timer) debounce.current = null; window.removeEventListener('beforeunload', beforeUnload); };
  }, [json, loading, busy]);

  async function switchDraft(id) {
    // State alone cannot reject two clicks before React renders the first one.
    if (busy || actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    try {
      const source = current.current;
      // An edit can arrive while the preceding save is in flight. Drain the
      // latest snapshot too, and stop immediately if any relevant save fails.
      do {
        await flushRef.current();
        if (!mounted.current) return;
      } while (!stopped.current && (meaningful(latest.current) || source.revision) && saved.current !== JSON.stringify(latest.current));
      const sourceJson = JSON.stringify(latest.current);
      const row = id ? (await api.get(`/sale-drafts/${id}`)).data : null;
      if (!mounted.current) return;
      if (current.current !== source || JSON.stringify(latest.current) !== sourceJson) {
        throw new Error('Draft changed while switching. Your edits are still here; save and try again.');
      }
      if (row?.status === 'finalized') {
        stopped.current = true;
        finalized.current?.(row.invoice);
        return;
      }
      current.current = { id: row?._id || newIdempotencyKey(), revision: row?.revision || 0 };
      saved.current = row ? JSON.stringify(row.state) : '';
      stopped.current = false;
      latest.current = row?.state || { cart: [], customer: '', notes: '' };
      apply.current(row?.state || null);
      setStatus(row ? 'Draft restored' : 'New sale');
    } catch (error) { toast.error(errorMessage(error)); }
    finally { actionInFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function discard() {
    if (busy || actionInFlight.current || !window.confirm('Discard this draft sale? No stock or payments will be changed.')) return;
    actionInFlight.current = true;
    setBusy(true);
    try {
      const target = await flush();
      if (target.revision) await api.delete(`/sale-drafts/${target.id}`, { data: { revision: target.revision } });
      setDrafts(rows => rows.filter(row => row._id !== target.id));
      current.current = { id: newIdempotencyKey(), revision: 0 };
      saved.current = ''; latest.current = { cart: [], customer: '', notes: '' }; apply.current(null); setStatus('Draft discarded');
    } catch (error) { toast.error(errorMessage(error)); }
    finally { actionInFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function loadMore() {
    if (busy || actionInFlight.current || !hasMore) return;
    actionInFlight.current = true;
    setBusy(true);
    try {
      const { data } = await api.get('/sale-drafts', { params: { page: page.current + 1, limit: 50 } });
      const rows = Array.isArray(data) ? data : [];
      page.current += 1; setHasMore(rows.length === 50);
      setDrafts(currentRows => [...currentRows, ...rows.filter(row => !currentRows.some(existing => existing._id === row._id))]);
    } catch (error) { toast.error(errorMessage(error)); }
    finally { actionInFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function reload() {
    if (busy || actionInFlight.current || !window.confirm('Save current edits and reload the latest saved draft?')) return;
    actionInFlight.current = true;
    clearTimeout(debounce.current);
    debounce.current = null;
    let release;
    const gate = { promise: new Promise(resolve => { release = resolve; }) };
    reloadGate.current = gate;
    setBusy(true);
    try {
      const source = current.current;
      // No debounce or public flush can enqueue a competing write while the
      // gate is held. Settle existing writes, then acknowledge the latest edit.
      await chain.current;
      do {
        if (!mounted.current) return;
        await queueSave();
      } while (!stopped.current && (meaningful(latest.current) || source.revision) && saved.current !== JSON.stringify(latest.current));
      if (!mounted.current) return;
      const sourceJson = JSON.stringify(latest.current);
      const acknowledgedRevision = source.revision;
      const { data } = await api.get(`/sale-drafts/${source.id}`);
      if (!mounted.current) return;
      if (reloadGate.current !== gate || current.current !== source || JSON.stringify(latest.current) !== sourceJson || source.revision !== acknowledgedRevision) {
        throw new Error('Draft changed during reload. Your latest edits were kept; save and try again.');
      }
      if (data._id !== source.id || !Number.isSafeInteger(data.revision) || data.revision < acknowledgedRevision) {
        throw new Error('The reload response is older than the saved draft. Your latest content and revision were kept.');
      }
      if (data.status === 'finalized') {
        stopped.current = true;
        finalized.current?.(data.invoice);
        return;
      }
      current.current = { id: data._id, revision: data.revision };
      saved.current = JSON.stringify(data.state); latest.current = data.state;
      setDrafts(rows => [data, ...rows.filter(row => row._id !== data._id)]);
      apply.current(data.state); setStatus('Draft restored');
    } catch (error) {
      // A save failure already has snapshot-specific status; keep it visible.
      if (mounted.current && saved.current === JSON.stringify(latest.current)) setStatus(`Reload failed: ${errorMessage(error)}`);
      toast.error(errorMessage(error));
    } finally {
      if (reloadGate.current === gate) reloadGate.current = null;
      release();
      actionInFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  // Derive dirty status during render: an edit must not retain a saved badge
  // until the debounce fires, or inherit an older request's acknowledgement.
  const stateJson = JSON.stringify(state);
  const activeSave = saving?.target === current.current ? saving : null;
  const needsSave = !loading && (meaningful(state) || current.current.revision) &&
    (saved.current !== stateJson || (activeSave && activeSave.json !== stateJson));
  let visibleStatus = status;
  if (needsSave) {
    const failure = saveFailure;
    visibleStatus = failure?.target === current.current && failure.json === stateJson
      ? failure.message : activeSave?.json === stateJson ? 'Saving draft…' : 'Unsaved changes';
  } else if (!loading && current.current.revision && /^(Draft saved|Unsaved changes|Saving draft|Draft not saved)/.test(status)) {
    visibleStatus = 'Draft saved';
  }
  return { loading, status: visibleStatus, drafts, busy, flush, switchDraft, discard, reload, hasMore, loadMore,
    pause() { stopped.current = true; },
    resume() { stopped.current = false; },
    complete() { stopped.current = true; } };
}

export function SaleDraftPanel({ draft, disabled }) {
  return <section className="card p-4 space-y-2" aria-label="Draft Sales">
    <h2 className="font-semibold">Draft Sales</h2>
    <p className="t-meta" role="status">{draft.status || 'Unfinished sales save automatically. Drafts do not reserve stock.'}</p>
    <div className="flex flex-wrap gap-2">
      <select className="input min-w-0 flex-1" aria-label="Reopen draft sale" value="" disabled={disabled || draft.busy} onChange={e => draft.switchDraft(e.target.value)}>
        <option value="">Reopen a saved draft…</option>
        {draft.drafts.map(row => <option key={row._id} value={row._id}>{row.state.cart[0]?.name || 'Sale'} · {row.state.cart.length} lines · {new Date(row.updatedAt).toLocaleString()}</option>)}
      </select>
      {draft.hasMore && <button type="button" className="btn-secondary" disabled={disabled || draft.busy} onClick={draft.loadMore}>More drafts</button>}
      <button type="button" className="btn-secondary" disabled={disabled || draft.busy} onClick={() => draft.switchDraft('')}>New sale</button>
      <button type="button" className="btn-secondary" disabled={disabled || draft.busy} onClick={draft.reload}>Reload saved draft</button>
      <button type="button" className="btn-secondary" disabled={disabled || draft.busy} onClick={draft.discard}>Discard draft</button>
    </div>
  </section>;
}
