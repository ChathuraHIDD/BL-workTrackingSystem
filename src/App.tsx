import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { supabaseConfigured } from './lib/supabase';
import { Layout } from './components/Layout';
import { Loading } from './components/States';
import { LoginPage } from './pages/LoginPage';
import { SetPasswordPage } from './pages/SetPasswordPage';
import { NoAccessPage } from './pages/NoAccessPage';
import { SetupRequiredPage } from './pages/SetupRequiredPage';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const TaskDetailPage = lazy(() => import('./pages/TaskDetailPage'));
const TaskFormPage = lazy(() => import('./pages/TaskFormPage'));
const EmployeesPage = lazy(() => import('./pages/EmployeesPage'));
const EmployeeProfilePage = lazy(() => import('./pages/EmployeeProfilePage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

function StaffOnly({ children }: { children: ReactNode }) {
  const { isStaff } = useAuth();
  return isStaff ? <>{children}</> : <Navigate to="/" replace />;
}
function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return isAdmin ? <>{children}</> : <Navigate to="/" replace />;
}

export function App() {
  const { session, profile, loading, noAccess, recovery } = useAuth();

  if (!supabaseConfigured) return <SetupRequiredPage />;
  if (loading) return <Loading label="Starting…" />;
  if (session && recovery) return <SetPasswordPage />;
  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  if (noAccess || !profile) return <NoAccessPage />;

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="tasks/new" element={<StaffOnly><TaskFormPage /></StaffOnly>} />
          <Route path="tasks/:id" element={<TaskDetailPage />} />
          <Route path="tasks/:id/edit" element={<StaffOnly><TaskFormPage /></StaffOnly>} />
          <Route path="employees" element={<StaffOnly><EmployeesPage /></StaffOnly>} />
          <Route path="employees/:id" element={<EmployeeProfilePage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="settings" element={<AdminOnly><SettingsPage /></AdminOnly>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
