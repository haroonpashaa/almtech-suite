import { Component } from 'react';
import { Link } from 'react-router-dom';

/* ---------------------------------------------------------------------------
   Before this existed, any render-time exception unmounted the whole React tree
   and left a blank white page with no way back except a manual reload. In a
   system somebody runs a business on all day, that is the difference between
   "one screen is broken" and "the application is gone".

   Two levels are used:
     - app level   (main.jsx)  — last resort, catches failures in the shell itself
     - route level (App.jsx)   — the common case: one screen fails, the sidebar,
                                 topbar and navigation all keep working, so the
                                 operator can carry on somewhere else.

   `resetKey` changes on navigation, which clears a stuck error when the user
   moves to another screen — without it, the boundary would stay broken forever.
   --------------------------------------------------------------------------- */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept as console.error deliberately: this is a real fault that belongs in the
    // browser console (and in whatever collects it), not a debug print.
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    // The stack is shown in development only. In production the error handler on
    // the server already refuses to leak internals; the client matches that.
    const isDev = import.meta.env.DEV;
    const { scope = 'screen' } = this.props;

    return (
      <div className="flex items-center justify-center p-6 min-h-[60vh]" role="alert">
        <div className="card max-w-lg w-full p-6 text-center">
          <div className="w-12 h-12 rounded-lg bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
          </div>
          <h1 className="t-section">
            {scope === 'app' ? 'The application could not start' : 'This screen could not be displayed'}
          </h1>
          <p className="t-sub mt-1.5">
            {scope === 'app'
              ? 'Something went wrong before the application finished loading. Your data has not been affected.'
              : 'Something went wrong while rendering this page. Your data has not been affected — nothing was saved or changed.'}
          </p>

          {isDev && (
            <pre className="mt-4 text-left text-[11px] leading-relaxed text-red-700 bg-red-50 border border-red-100 rounded-md p-3 overflow-auto max-h-48 whitespace-pre-wrap">
              {String(this.state.error?.stack || this.state.error)}
            </pre>
          )}

          <div className="mt-5 flex items-center justify-center gap-2">
            <button className="btn-secondary" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            {scope === 'app' ? (
              <button className="btn-primary" onClick={() => window.location.reload()}>Reload</button>
            ) : (
              <Link to="/" className="btn-primary" onClick={() => this.setState({ error: null })}>
                Back to dashboard
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }
}
