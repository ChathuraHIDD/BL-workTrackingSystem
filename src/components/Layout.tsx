import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  BarChart3,
  ClipboardList,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  UserCircle2,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { unreadCount } from '../lib/api';
import { ROLE_LABELS } from '../lib/types';
import { Logo } from './Logo';

export function Layout() {
  const { profile, isStaff, isAdmin, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const employeeId = profile?.employee?.id;

  useEffect(() => setOpen(false), [location.pathname]);

  const unread = useQuery({
    queryKey: ['unread', employeeId],
    queryFn: () => unreadCount(employeeId!),
    enabled: !!employeeId,
    refetchInterval: 60_000,
  });

  const nav = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, show: true },
    { to: '/tasks', label: isStaff ? 'All Work Records' : 'My Tasks', icon: ClipboardList, show: true },
    { to: employeeId ? `/employees/${employeeId}` : '/', label: 'My Workload', icon: UserCircle2, show: !!employeeId },
    { to: '/employees', label: 'Employees', icon: Users, end: true, show: isStaff },
    { to: '/reports', label: 'Reports', icon: FileSpreadsheet, show: true },
    { to: '/notifications', label: 'Notifications', icon: Bell, show: !!employeeId },
    { to: '/settings', label: 'Administration', icon: Settings, show: isAdmin },
  ];

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`} aria-label="Main navigation">
        <div className="sidebar-brand">
          <Link to="/" aria-label="Dashboard home">
            <Logo />
          </Link>
          <button className="icon-btn sidebar-close" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={20} />
          </button>
        </div>
        <nav>
          <ul>
            {nav
              .filter((n) => n.show)
              .map((n) => (
                <li key={n.label}>
                  <NavLink to={n.to} end={n.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <n.icon size={18} aria-hidden />
                    <span>{n.label}</span>
                    {n.label === 'Notifications' && (unread.data ?? 0) > 0 && (
                      <span className="nav-count" aria-label={`${unread.data} unread`}>
                        {unread.data}
                      </span>
                    )}
                  </NavLink>
                </li>
              ))}
          </ul>
        </nav>
        <div className="sidebar-footer">
          <div className="user-card">
            <div className="avatar" aria-hidden>
              {(profile?.employee?.full_name ?? profile?.email ?? '?').slice(0, 1).toUpperCase()}
            </div>
            <div className="user-meta">
              <strong>{profile?.employee?.full_name ?? profile?.email}</strong>
              <span>{profile ? ROLE_LABELS[profile.role] : ''}</span>
            </div>
          </div>
          <button className="nav-link signout" onClick={() => signOut()}>
            <LogOut size={18} aria-hidden />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
      {open && <div className="sidebar-scrim" onClick={() => setOpen(false)} aria-hidden />}

      <div className="main-col">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}>
            <Menu size={22} />
          </button>
          <div className="topbar-title">
            <BarChart3 size={18} aria-hidden className="brand-ico" />
            <span>Work Tracking System</span>
          </div>
          {employeeId && (
            <Link to="/notifications" className="icon-btn bell" aria-label={`Notifications${unread.data ? `, ${unread.data} unread` : ''}`}>
              <Bell size={20} />
              {(unread.data ?? 0) > 0 && <span className="bell-dot">{unread.data! > 99 ? '99+' : unread.data}</span>}
            </Link>
          )}
        </header>
        <main id="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  useEffect(() => {
    document.title = `${title} · Battery Lab Energy`;
  }, [title]);
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
