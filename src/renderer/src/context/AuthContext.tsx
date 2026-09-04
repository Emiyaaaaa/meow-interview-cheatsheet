import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  fetchMe,
  logoutAccount,
  persistSessionToken,
  startWechatLogin,
  waitWechatLogin,
  type AccountUser,
} from "../services/account";
import { clearSessionToken } from "../../../shared/session";

interface AuthContextValue {
  isReady: boolean;
  isLoggingIn: boolean;
  loginError: string | null;
  user: AccountUser | null;
  remainingSeconds: number;
  applySessionToken: (token: string) => Promise<void>;
  cancelLogin: () => void;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<AccountUser | null>;
  setRemainingSeconds: (seconds: number) => void;
  setUser: (user: AccountUser | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readTokenFromAuthUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("token")?.trim() || "";
  } catch {
    return "";
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [user, setUser] = useState<AccountUser | null>(null);
  const loginGeneration = useRef(0);

  const applySessionToken = useCallback(async (token: string) => {
    persistSessionToken(token);
    const next = await fetchMe();
    setUser(next);
    setLoginError(null);
    setIsLoggingIn(false);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const next = await fetchMe();
      setUser(next);
      return next;
    } catch {
      clearSessionToken();
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    void refreshUser().finally(() => {
      if (active) setIsReady(true);
    });
    return () => {
      active = false;
    };
  }, [refreshUser]);

  useEffect(() => {
    return window.desktop.onAuthCallback((url) => {
      const token = readTokenFromAuthUrl(url);
      if (!token) return;
      loginGeneration.current += 1;
      void applySessionToken(token).catch((error: unknown) => {
        setLoginError(error instanceof Error ? error.message : "登录失败");
      });
    });
  }, [applySessionToken]);

  const login = useCallback(async () => {
    const generation = ++loginGeneration.current;
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const started = await startWechatLogin();
      await window.desktop.openExternal(started.start_url);

      while (loginGeneration.current === generation) {
        const result = await waitWechatLogin(started.state2);
        if (loginGeneration.current !== generation) return;
        if (result.status === "ready") {
          persistSessionToken(result.token);
          setUser(result.user);
          setIsLoggingIn(false);
          return;
        }
        if (result.status === "error") {
          throw new Error(result.message);
        }
        await sleep(1500);
      }
    } catch (error) {
      if (loginGeneration.current !== generation) return;
      setLoginError(error instanceof Error ? error.message : "登录失败");
      setIsLoggingIn(false);
    }
  }, []);

  const cancelLogin = useCallback(() => {
    loginGeneration.current += 1;
    setIsLoggingIn(false);
  }, []);

  const logout = useCallback(async () => {
    loginGeneration.current += 1;
    setIsLoggingIn(false);
    await logoutAccount();
    setUser(null);
  }, []);

  const setRemainingSeconds = useCallback((seconds: number) => {
    setUser((current) =>
      current ? { ...current, remaining_seconds: seconds } : current,
    );
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isReady,
      isLoggingIn,
      loginError,
      user,
      remainingSeconds: user?.remaining_seconds ?? 0,
      applySessionToken,
      cancelLogin,
      login,
      logout,
      refreshUser,
      setRemainingSeconds,
      setUser,
    }),
    [
      applySessionToken,
      cancelLogin,
      isLoggingIn,
      isReady,
      login,
      loginError,
      logout,
      refreshUser,
      setRemainingSeconds,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

// Context consumers live next to the provider by design.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
