import { useEffect, useRef } from 'react';

/**
 * Dialog surface with real focus management: focus moves into the dialog on open,
 * Tab is trapped inside it, and focus returns to whatever opened it on close. That
 * matters here because several dialogs confirm irreversible financial actions and
 * must be operable without a mouse.
 */
export default function Modal({ open, onClose, title, subtitle, children, footer, size = 'lg', initialFocusRef }) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);

  // Held in refs, and deliberately NOT in the effect's dependencies.
  //
  // Every caller passes an inline arrow — onClose={() => setShowAdd(false)} — which is
  // a new function on every render. With onClose in the dependency array, typing a
  // single character re-rendered the page, gave the effect a new identity, and tore it
  // down and set it up again: focus was pulled out of the field the user was typing in
  // and moved to the first control in the dialog, the close button. The second
  // keystroke then went nowhere. Focus setup belongs to opening the dialog, not to
  // every render while it is open.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialFocusHolder = useRef(initialFocusRef);
  initialFocusHolder.current = initialFocusRef;

  useEffect(() => {
    if (!open) return;

    restoreRef.current = document.activeElement;
    // Stop the page behind the dialog from scrolling under it.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll(
          'a[href], button:not([disabled]), textarea, input:not([type="hidden"]), select, [tabindex]:not([tabindex="-1"])'
        ) || []
      ).filter((el) => el.offsetParent !== null);

    // Move focus in — the caller's preferred target, else the first control.
    const t = setTimeout(() => {
      (initialFocusHolder.current?.current || focusables()[0] || panelRef.current)?.focus?.();
    }, 0);

    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-3xl' };
  const titleId = 'modal-title';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-start justify-center p-0 sm:p-6 overflow-y-auto overscroll-contain">
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative w-full ${widths[size]} sm:mt-[6vh] sm:mb-12 bg-white rounded-t-[14px] sm:rounded-[10px] border border-ink-100 shadow-pop animate-scale-in focus:outline-none flex flex-col max-h-[92dvh] sm:max-h-[88vh]`}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-ink-100">
          <div className="min-w-0">
            <h2 id={titleId} className="t-section">{title}</h2>
            {subtitle && <p className="t-sub mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn-icon text-ink-400 hover:text-ink-700 hover:bg-ink-100 -mr-1.5 -mt-1" aria-label="Close dialog">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-5 py-5 overflow-y-auto overscroll-contain flex-1 min-h-0">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-ink-100 bg-ink-25 sm:rounded-b-[10px] shrink-0 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:pb-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
