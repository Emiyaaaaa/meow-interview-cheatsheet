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
  loginQrImage: string | null;
  user: AccountUser | null;
  remainingSeconds: number;
  cancelLogin: () => void;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<AccountUser | null>;
  setRemainingSeconds: (seconds: number) => void;
  setUser: (user: AccountUser | null) => void;
  bindPhoneOpen: boolean;
  requestPhoneBind: () => Promise<boolean>;
  completePhoneBind: (user: AccountUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginQrImage, setLoginQrImage] = useState<string | null>(null);
  const [user, setUser] = useState<AccountUser | null>(null);
  const [bindPhoneOpen, setBindPhoneOpen] = useState(false);
  const loginGeneration = useRef(0);
  const bindWaiters = useRef<Array<(ok: boolean) => void>>([]);

  const settlePhoneBind = useCallback((ok: boolean) => {
    setBindPhoneOpen(false);
    const waiters = bindWaiters.current.splice(0);
    for (const waiter of waiters) waiter(ok);
  }, []);

  const requestPhoneBind = useCallback(() => {
    if (user?.phone) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      bindWaiters.current.push(resolve);
      setBindPhoneOpen(true);
    });
  }, [user?.phone]);

  const completePhoneBind = useCallback(
    (next: AccountUser) => {
      setUser(next);
      settlePhoneBind(true);
    },
    [settlePhoneBind],
  );

  useEffect(() => {
    if (user && !user.phone) {
      setBindPhoneOpen(true);
      return;
    }
    if (user?.phone) {
      settlePhoneBind(true);
    }
  }, [user, settlePhoneBind]);

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
    return window.desktop.onMockInterviewVisibility((open) => {
      if (!open) void refreshUser();
    });
  }, [refreshUser]);

  const login = useCallback(async () => {
    const generation = ++loginGeneration.current;
    setIsLoggingIn(true);
    setLoginError(null);
    setLoginQrImage(null);
    try {
      const started = await startWechatLogin();
      if (loginGeneration.current !== generation) return;
      setLoginQrImage(started.qr_image);

      while (loginGeneration.current === generation) {
        const result = await waitWechatLogin(started.state2);
        if (loginGeneration.current !== generation) return;
        if (result.status === "ready") {
          persistSessionToken(result.token);
          setUser(result.user);
          setIsLoggingIn(false);
          setLoginQrImage(null);
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
    setLoginQrImage(null);
  }, []);

  const logout = useCallback(async () => {
    loginGeneration.current += 1;
    setIsLoggingIn(false);
    settlePhoneBind(false);
    await logoutAccount();
    setUser(null);
  }, [settlePhoneBind]);

  const setRemainingSeconds = useCallback((seconds: number) => {
    setUser((current) =>
      current ? { ...current, remaining_seconds: seconds } : current,
    );
  }, []);

  useEffect(() => {
    return window.desktop.onMockInterviewRemaining((seconds) => {
      setRemainingSeconds(seconds);
    });
  }, [setRemainingSeconds]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isReady,
      isLoggingIn,
      loginError,
      loginQrImage,
      user,
      remainingSeconds: user?.remaining_seconds ?? 0,
      cancelLogin,
      login,
      logout,
      refreshUser,
      setRemainingSeconds,
      setUser,
      bindPhoneOpen,
      requestPhoneBind,
      completePhoneBind,
    }),
    [
      bindPhoneOpen,
      cancelLogin,
      completePhoneBind,
      isLoggingIn,
      isReady,
      login,
      loginError,
      loginQrImage,
      logout,
      refreshUser,
      requestPhoneBind,
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
