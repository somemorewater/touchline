'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { onAuthExpired, refreshSession, setAccessToken } from '@/lib/api/client';
import { authApi } from '@/lib/api/endpoints';
import type { CurrentUser, RoleName } from '@/lib/api/types';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: AuthStatus;
  user: CurrentUser | null;
  bootstrapError: string | null;
  login(email: string, password: string): Promise<CurrentUser>;
  register(input: { email: string; password: string; displayName: string }): Promise<CurrentUser>;
  logout(): Promise<void>;
  logoutAll(): Promise<void>;
  refreshUser(): Promise<CurrentUser | null>;
  can(permission: string): boolean;
  canIn(permission: string, competitionId: string | undefined): boolean;
  scopesFor(permission: string): string[];
  hasRole(role: RoleName): boolean;
  isSuperAdmin: boolean;
  isCompetitionAdmin: boolean;
  isCaptain: boolean;
  isOfficial: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  // A 401 that survives a refresh means the session is gone. Clear identity
  // and cached responses so another account can never see the old data.
  useEffect(() => onAuthExpired(clearSession), [clearSession]);

  const refreshUser = useCallback(async (): Promise<CurrentUser | null> => {
    const token = await refreshSession();
    if (!token) {
      clearSession();
      return null;
    }
    try {
      const me = await authApi.me();
      if (mounted.current) {
        setUser(me);
        setStatus('authenticated');
      }
      return me;
    } catch {
      clearSession();
      return null;
    }
  }, [clearSession]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await refreshSession();
      if (cancelled) return;
      if (!token) {
        setStatus('anonymous');
        return;
      }
      try {
        const me = await authApi.me();
        if (cancelled) return;
        setUser(me);
        setStatus('authenticated');
      } catch {
        if (!cancelled) {
          setBootstrapError('Your session could not be restored. Sign in again.');
          clearSession();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await authApi.login(email, password);
      setAccessToken(result.accessToken);
      const me = await authApi.me();
      setUser(me);
      setStatus('authenticated');
      setBootstrapError(null);
      queryClient.clear();
      return me;
    },
    [queryClient],
  );

  const register = useCallback(
    async (input: { email: string; password: string; displayName: string }) => {
      await authApi.register(input);
      return login(input.email, input.password);
    },
    [login],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const logoutAll = useCallback(async () => {
    try {
      await authApi.logoutAll();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(() => {
    const permissions = new Set(user?.permissions ?? []);
    const scoped = new Map((user?.scopes ?? []).map((scope) => [scope.competitionId, new Set(scope.permissions)]));
    const roles = new Set((user?.roles ?? []).map((assignment) => assignment.role));
    const isSuperAdmin = roles.has('super_admin');

    const can = (permission: string) => isSuperAdmin || permissions.has(permission);
    const canIn = (permission: string, competitionId: string | undefined) => {
      if (can(permission)) return true;
      if (!competitionId) return false;
      return scoped.get(competitionId)?.has(permission) ?? false;
    };
    const scopesFor = (permission: string) => {
      const out: string[] = [];
      for (const [competitionId, granted] of scoped) {
        if (granted.has(permission)) out.push(competitionId);
      }
      return out;
    };

    return {
      status,
      user,
      bootstrapError,
      login,
      register,
      logout,
      logoutAll,
      refreshUser,
      can,
      canIn,
      scopesFor,
      hasRole: (role) => roles.has(role),
      isSuperAdmin,
      isCompetitionAdmin: roles.has('competition_admin') || isSuperAdmin,
      isCaptain: roles.has('team_captain'),
      isOfficial: roles.has('match_official'),
    };
  }, [status, user, bootstrapError, login, register, logout, logoutAll, refreshUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
