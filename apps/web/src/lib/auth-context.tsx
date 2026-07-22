"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { AuthResponse, AuthUser } from "@relay/shared";
import type { UserRole } from "@relay/shared";
import { api, tokenStore } from "./api";

// Where each role lands after auth.
export function homePathForRole(role: UserRole): string {
  switch (role) {
    case "DRIVER":
      return "/driver";
    case "OPERATOR":
      return "/operator";
    case "ADMIN":
      return "/admin";
    default:
      return "/app";
  }
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  signIn: (identifier: string, password: string) => Promise<AuthUser>;
  setSession: (resp: AuthResponse) => void;
  refreshUser: () => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tokenStore.access) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const setSession = useCallback((resp: AuthResponse) => {
    tokenStore.set(resp.accessToken, resp.refreshToken);
    setUser(resp.user);
  }, []);

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      const resp = await api.login({ identifier, password });
      setSession(resp);
      return resp.user;
    },
    [setSession]
  );

  const refreshUser = useCallback(async () => {
    if (!tokenStore.access) return;
    const u = await api.me();
    setUser(u);
  }, []);

  const signOut = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, setSession, refreshUser, signOut }),
    [user, loading, signIn, setSession, refreshUser, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
