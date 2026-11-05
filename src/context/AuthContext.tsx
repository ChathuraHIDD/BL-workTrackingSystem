import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Employee, Role } from '../lib/types';

interface Profile {
  userId: string;
  email: string;
  role: Role;
  isActive: boolean;
  employee: Employee | null;
}

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  /** true while the initial session + profile load is running */
  loading: boolean;
  /** account exists in auth but has no active app account */
  noAccess: boolean;
  recovery: boolean;
  isAdmin: boolean;
  isStaff: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  clearRecovery: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

async function loadProfile(session: Session): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('app_users')
    .select('user_id, role, is_active, employee_id')
    .eq('user_id', session.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.is_active) return null;
  let employee: Employee | null = null;
  if (data.employee_id) {
    const res = await supabase.from('employee_directory').select('*').eq('id', data.employee_id).maybeSingle();
    if (res.error) throw res.error;
    employee = res.data as Employee | null;
  }
  return {
    userId: data.user_id,
    email: session.user.email ?? '',
    role: data.role as Role,
    isActive: data.is_active,
    employee,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [noAccess, setNoAccess] = useState(false);
  const [recovery, setRecovery] = useState(
    () => typeof window !== 'undefined' && /type=(recovery|invite)/.test(window.location.hash),
  );

  const resolve = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) {
      setProfile(null);
      setNoAccess(false);
      setLoading(false);
      return;
    }
    try {
      const p = await loadProfile(s);
      setProfile(p);
      setNoAccess(!p);
    } catch {
      setProfile(null);
      setNoAccess(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => resolve(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') setRecovery(false);
      if (event === 'TOKEN_REFRESHED') {
        setSession(s);
        return;
      }
      // defer to avoid calling Supabase inside the auth callback
      setTimeout(() => resolve(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [resolve]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      loading,
      noAccess,
      recovery,
      isAdmin: profile?.role === 'admin',
      isStaff: profile?.role === 'admin' || profile?.role === 'manager',
      signOut: async () => {
        await supabase.auth.signOut();
      },
      refreshProfile: async () => {
        const { data } = await supabase.auth.getSession();
        await resolve(data.session);
      },
      clearRecovery: () => setRecovery(false),
    }),
    [session, profile, loading, noAccess, recovery, resolve],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
