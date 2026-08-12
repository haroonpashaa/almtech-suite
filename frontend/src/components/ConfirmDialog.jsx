import { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import { Spinner } from './ui.jsx';

/**
 * Replaces window.confirm() and window.prompt() for anything that moves money.
 *
 * A browser dialog cannot show what a reversal will actually do — which account,
 * how much, which balances move. This can, and does: `consequences` is rendered as
 * an explicit list the user reads before committing.
 *
 * When `reasonRequired` is set the confirm button stays disabled until a reason is
 * typed, which is what the payment-reversal API demands anyway.
 */
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  consequences = [],
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',            // 'danger' | 'primary'
  reasonRequired = false,
  reasonLabel = 'Reason',
  reasonPlaceholder = '',
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const reasonRef = useRef(null);
  const confirmRef = useRef(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setBusy(false);
    }
  }, [open]);

  const blocked = reasonRequired && !reason.trim();

  async function confirm() {
    if (blocked || busy) return;
    setBusy(true);
    try {
      await onConfirm(reasonRequired ? reason.trim() : undefined);
      onClose?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      size="md"
      initialFocusRef={reasonRequired ? reasonRef : confirmRef}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>{cancelLabel}</button>
          <button
            ref={confirmRef}
            className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
            onClick={confirm}
            disabled={blocked || busy}
          >
            {busy ? <><Spinner className="w-4 h-4" /> Working…</> : confirmLabel}
          </button>
        </>
      }
    >
      {description && <p className="t-body">{description}</p>}

      {consequences.length > 0 && (
        <ul className="mt-3.5 space-y-1.5 rounded-md border border-ink-100 bg-ink-25 p-3">
          {consequences.map((c, i) => (
            <li key={i} className="flex gap-2 text-[13px] text-ink-600">
              <svg className="w-3.5 h-3.5 mt-0.5 shrink-0 text-ink-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}

      {reasonRequired && (
        <div className="mt-4">
          <label htmlFor="confirm-reason" className="label">
            {reasonLabel}<span className="req" aria-hidden>*</span>
          </label>
          <input
            id="confirm-reason"
            ref={reasonRef}
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonPlaceholder}
            aria-required="true"
            aria-invalid={blocked ? 'true' : undefined}
            onKeyDown={(e) => { if (e.key === 'Enter' && !blocked) confirm(); }}
          />
          {blocked && <p className="field-error">A reason is required and will be recorded against this entry.</p>}
        </div>
      )}
    </Modal>
  );
}
