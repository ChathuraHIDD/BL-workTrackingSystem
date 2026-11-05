import { useAuth } from '../context/AuthContext';
import { Logo } from '../components/Logo';

export function NoAccessPage() {
  const { session, signOut, refreshProfile } = useAuth();
  return (
    <div className="auth-page">
      <div className="auth-card">
        <Logo className="auth-logo" />
        <h1>Account not active</h1>
        <p className="muted">
          You are signed in as <strong>{session?.user.email}</strong>, but this login is not linked to an active Work Tracker
          account. Please ask an administrator to activate your access.
        </p>
        <div className="row gap">
          <button className="btn btn-secondary" onClick={() => refreshProfile()}>
            Check again
          </button>
          <button className="btn btn-primary" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
