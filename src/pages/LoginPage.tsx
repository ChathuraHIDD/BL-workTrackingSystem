import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { Logo } from '../components/Logo';
import { friendlyError } from '../lib/errors';

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        if (!password) throw new Error('Enter your password.');
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message);
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/`,
        });
        if (error) throw error;
        setInfo('If an account exists for this email, a password reset link has been sent.');
      }
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
        <h1>{mode === 'login' ? 'Sign in to Work Tracker' : 'Reset your password'}</h1>
        <p className="muted">
          {mode === 'login'
            ? 'Use the account your administrator created for you.'
            : 'We will email you a secure link to choose a new password.'}
        </p>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        {info && (
          <div className="alert alert-success" role="status">
            {info}
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email address</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        {mode === 'login' && (
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
        )}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Send reset link'}
        </button>
        <button
          type="button"
          className="btn btn-link"
          onClick={() => {
            setMode(mode === 'login' ? 'reset' : 'login');
            setError('');
            setInfo('');
          }}
        >
          {mode === 'login' ? 'Forgot your password?' : 'Back to sign in'}
        </button>
        <p className="muted small center">Accounts are created by an administrator. Public registration is disabled.</p>
      </form>
    </div>
  );
}
