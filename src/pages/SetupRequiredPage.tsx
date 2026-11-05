import { Logo } from '../components/Logo';

export function SetupRequiredPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <Logo className="auth-logo" />
        <h1>Configuration required</h1>
        <p className="muted">
          The database connection is not configured. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>{' '}
          (see <code>.env.example</code> and the README), then rebuild or restart the app.
        </p>
      </div>
    </div>
  );
}
