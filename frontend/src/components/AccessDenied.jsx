import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/* ---------------------------------------------------------------------------
   Previously a wrong-role user was redirected to "/" with no explanation, which
   reads as a broken link rather than a permission boundary. The permissions
   themselves are unchanged — only the way they are communicated.
   --------------------------------------------------------------------------- */
export default function AccessDenied({ roles }) {
  const { user } = useAuth();
  const allowed = (roles || []).join(' or ');

  return (
    <div className="flex items-center justify-center p-6 min-h-[60vh]">
      <div className="card max-w-md w-full p-6 text-center" role="alert">
        <div className="w-12 h-12 rounded-lg bg-ink-50 text-ink-400 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
        </div>
        <h1 className="t-section">You do not have access to this screen</h1>
        <p className="t-sub mt-1.5">
          {allowed
            ? <>This area is limited to <span className="font-medium text-ink-700">{allowed}</span> users. </>
            : 'This area is restricted. '}
          You are signed in as <span className="font-medium text-ink-700">{user?.name}</span>
          {user?.role && <> ({user.role})</>}.
        </p>
        <p className="t-meta mt-2">
          If you need access, ask an administrator to change your role.
        </p>
        <div className="mt-5">
          <Link to="/" className="btn-primary">Back to dashboard</Link>
        </div>
      </div>
    </div>
  );
}
