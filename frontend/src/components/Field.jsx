import { useId } from 'react';

/**
 * A labelled form control.
 *
 * The audit found 83 labels in the app with zero `htmlFor`, so none were
 * programmatically associated with their input. This generates a stable id, wires
 * label→control, and threads `aria-invalid` / `aria-describedby` for errors and
 * hints — clicking a label now focuses its field, and screen readers announce the
 * relationship.
 *
 * Children receive the generated id via a render prop so any control works:
 *   <Field label="Amount">{(id) => <input id={id} className="input" />}</Field>
 */
export default function Field({ label, hint, error, required, children, className = '', htmlFor }) {
  const auto = useId();
  const id = htmlFor || auto;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="label">
          {label}
          {required && <span className="req" aria-hidden>*</span>}
        </label>
      )}
      {typeof children === 'function'
        ? children(id, { 'aria-describedby': describedBy, 'aria-invalid': error ? 'true' : undefined, 'aria-required': required || undefined })
        : children}
      {hint && !error && <p id={hintId} className="field-hint">{hint}</p>}
      {error && (
        <p id={errorId} className="field-error" role="alert">
          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}
