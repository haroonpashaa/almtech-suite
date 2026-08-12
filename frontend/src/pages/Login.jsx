import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage } from '../lib/format.js';
import { Spinner } from '../components/ui.jsx';

/* The demo shortcuts exist so a developer does not retype credentials all day. They
   must never reach a deployed server: the panel advertises three valid addresses to
   anyone who opens the login page, and offers one-click sign-in with passwords that
   are published in the repository. `import.meta.env.DEV` is true only under `vite dev`
   and is statically false in a production build, so the whole block — including these
   strings — is removed by the bundler rather than merely hidden. */
const SHOW_DEMO_ACCOUNTS = import.meta.env.DEV;

const demoAccounts = SHOW_DEMO_ACCOUNTS
  ? [
      { label: 'Admin', email: 'admin@almtech.org', password: 'admin1234' },
      { label: 'Sales', email: 'sales@almtech.org', password: 'sales1234' },
      { label: 'Stock', email: 'stock@almtech.org', password: 'stock1234' },
    ]
  : [];

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  // A deployed login screen starts empty; only local development pre-fills.
  const [email, setEmail] = useState(SHOW_DEMO_ACCOUNTS ? 'admin@almtech.org' : '');
  const [password, setPassword] = useState(SHOW_DEMO_ACCOUNTS ? 'admin1234' : '');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center bg-brand-soft overflow-hidden">
      {/* Background: dot grid + brand gradient orbs */}
      <div className="absolute inset-0 bg-grid-fade bg-grid opacity-60" />
      <div className="absolute -top-40 -left-32 w-[28rem] h-[28rem] rounded-full bg-brand-400/20 blur-3xl" />
      <div className="absolute -bottom-40 -right-32 w-[28rem] h-[28rem] rounded-full bg-brand-700/15 blur-3xl" />

      <div className="relative w-full max-w-sm px-6 animate-fade-up">
        <div className="flex flex-col items-center mb-8">
          <img src="/almtech-logo-tight.png" alt="ALMTech" className="h-10 object-contain" />
          <div className="mt-3 flex items-center gap-3">
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-brand-600" />
            <div className="text-[11px] text-ink-500 uppercase tracking-[0.3em] font-semibold">
              Business Suite
            </div>
            <div className="h-px w-8 bg-gradient-to-l from-transparent to-brand-400" />
          </div>
        </div>

        <form onSubmit={submit} className="card p-7 shadow-lift rounded-2xl">
          <h1 className="text-xl font-semibold text-ink-900 tracking-tight">Welcome back</h1>
          <p className="text-sm text-ink-500 mt-1">Sign in to your workspace to continue.</p>

          <div className="mt-6 space-y-4">
            <div>
              <label htmlFor="login-email-address-25" className="label">Email address</label>
              <input id="login-email-address-25"
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                placeholder="you@company.com"
                required
              />
            </div>
            <div>
              <label htmlFor="login-password" className="label">Password</label>
              <div className="relative">
                <input
                  id="login-password"
                  className="input pr-10"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-300 hover:text-ink-500 transition p-1"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPw ? (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 4.2A9.1 9.1 0 0 1 12 4c5 0 9 4.5 10 8-.3 1-1 2.2-2 3.3M6.6 6.6C4 8.2 2.6 10.6 2 12c1 3.5 5 8 10 8 1.6 0 3-.4 4.3-1M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-8 10-8 10 8 10 8-3.5 8-10 8-10-8-10-8z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </div>
            </div>
          </div>

          <button className="btn-primary btn-lg w-full mt-6" disabled={loading}>
            {loading ? <><Spinner className="w-4 h-4" /> Signing in…</> : 'Sign in'}
          </button>

          {SHOW_DEMO_ACCOUNTS && (
          <div className="mt-6 pt-5 border-t border-ink-100">
            <div className="text-[11px] text-ink-400 mb-2 text-center uppercase tracking-wider font-medium">
              Demo accounts
            </div>
            <div className="grid grid-cols-3 gap-2">
              {demoAccounts.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  onClick={() => { setEmail(a.email); setPassword(a.password); }}
                  className={`text-xs font-medium py-1.5 rounded-lg border transition ${
                    email === a.email
                      ? 'border-brand-300 bg-brand-50 text-brand-700'
                      : 'border-ink-200 text-ink-500 hover:border-ink-300 hover:bg-ink-50'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          )}
        </form>

        <div className="mt-6 text-center text-[11px] text-ink-400">
          Protected · v0.1 · © ALMTech
        </div>
      </div>
    </div>
  );
}
