import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage } from '../lib/format.js';

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@almtech.org');
  const [password, setPassword] = useState('admin1234');
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
      {/* Soft brand gradient orbs in background */}
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-brand-400/20 blur-3xl" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-brand-700/15 blur-3xl" />

      <div className="relative w-full max-w-sm px-6">
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

        <form onSubmit={submit} className="card p-7 shadow-lift">
          <h1 className="text-lg font-semibold text-ink-900">Sign in</h1>
          <p className="text-sm text-ink-500 mt-1">Welcome back. Sign in to continue.</p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="label">Email address</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
          </div>

          <button className="btn-primary-gradient w-full mt-6" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="mt-6 pt-5 border-t border-ink-100 text-[11px] text-ink-400 text-center">
            Protected · v0.1 · ALMTech
          </div>
        </form>
      </div>
    </div>
  );
}
