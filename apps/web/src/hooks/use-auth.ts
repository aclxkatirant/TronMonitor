'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api, isApiError } from '@/lib/api';
import type { AuthStatus, SessionUser, UserProfile } from '@/lib/types';

export const ME_QUERY_KEY = ['auth', 'me'] as const;
export const AUTH_STATUS_KEY = ['auth', 'status'] as const;

export function useMe(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async () => {
      try {
        return await api.get<UserProfile>('/auth/me');
      } catch (error) {
        if (isApiError(error) && error.status === 401) return null;
        throw error;
      }
    },
    enabled: options.enabled ?? true,
    staleTime: 60_000,
  });
}

export function useAuthStatus(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: AUTH_STATUS_KEY,
    queryFn: () => api.get<AuthStatus>('/auth/status'),
    enabled: options.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => api.post<{ user: SessionUser }>('/auth/login', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      router.replace('/');
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: (input: { email: string; fullName: string; password: string }) =>
      api.post<{ user: SessionUser }>('/auth/register', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: AUTH_STATUS_KEY });
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      router.replace('/');
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSettled: async () => {
      queryClient.setQueryData(ME_QUERY_KEY, null);
      await queryClient.invalidateQueries();
      router.replace('/giris');
    },
  });
}

export function hasPermission(user: Pick<SessionUser, 'permissions'> | null | undefined, permission: string): boolean {
  return !!user?.permissions.includes(permission);
}
