import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Logo } from '../components/Logo';
import { friendlyError } from '../lib/errors';

export function SetPasswordPage() {
  const { clearRecovery, refreshProfile, session } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 10) return setError('Use at least 10 characters.');
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return setError('Include at least one letter and one number.');
    if (password !== confirm) return setError('The passwords do not match.');
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      window.history.replaceState(null, '', '/');
      clearRecovery();
      await refreshProfile();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit} noValidate>
        <Logo className="auth-logo" />
        <h1>Choose your password</h1>
        <p className="muted">Signed in as {session?.user.email}. Set a password to finish setting up your account.</p>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <div className="field">
          <label htmlFor="np">New password</label>
          <input id="np" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="np-hint" />
          <p id="np-hint" className="hint">
            At least 10 characters, including a letter and a number.
          </p>
        </div>
        <div className="field">
          <label htmlFor="cp">Confirm password</label>
          <input id="cp" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </div>
  );
}
