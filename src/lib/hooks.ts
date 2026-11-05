import { useQuery } from '@tanstack/react-query';
import { listDepartments, listEmployees } from './api';
import { useAuth } from '../context/AuthContext';

export function useDepartments() {
  return useQuery({ queryKey: ['departments'], queryFn: listDepartments, staleTime: 5 * 60_000 });
}

export function useEmployees() {
  const { profile } = useAuth();
  return useQuery({ queryKey: ['employees'], queryFn: listEmployees, enabled: !!profile, staleTime: 60_000 });
}
