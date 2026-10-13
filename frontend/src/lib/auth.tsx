/**
 * Login state for the whole app.
 *
 * On start it asks the server who is logged in (GET /auth/status).
 * The session itself lives in an httpOnly cookie that JavaScript cannot read,
 * so nothing secret is kept in the browser's storage.
 * If any request later gets "401 not logged in" (session expired, account
 * deactivated), the app returns to the login screen.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, errorMessage, type AuthStatus, type AuthUser } from "./api";

type Phase = "loading" | "setup" | "login" | "ready" | "offline";

interface AuthContextValue {
  phase: Phase;
  user: AuthUser | null;
  businessName: string | null;
  /** Why the app could not start (shown on the error screen). */
  startError: string | null;
  refresh: () => Promise<void>;
  signedIn: (user: AuthUser) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStartError(null);
      const { data } = await api.get<AuthStatus>("/auth/status");
      setBusinessName(data.businessName);
      setUser(data.user);
      setPhase(data.setupRequired ? "setup" : data.user ? "ready" : "login");
    } catch (error) {
      setStartError(errorMessage(error));
      setPhase("offline");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Any 401 from a protected endpoint sends the person back to the login screen.
  useEffect(() => {
    const id = api.interceptors.response.use(undefined, (error) => {
      const url: string = error?.config?.url ?? "";
      if (error?.response?.status === 401 && !url.startsWith("/auth/")) {
        setUser(null);
        setPhase("login");
      }
      return Promise.reject(error);
    });
    return () => api.interceptors.response.eject(id);
  }, []);

  const signedIn = useCallback((u: AuthUser) => {
    setUser(u);
    setPhase("ready");
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      setUser(null);
      setPhase("login");
    }
  }, []);

  return <AuthContext.Provider value={{ phase, user, businessName, startError, refresh, signedIn, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
