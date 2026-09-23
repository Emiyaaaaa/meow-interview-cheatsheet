import { useEffect, useState } from "react";
import { AlertDialog, Button, Chip, cn, Modal, Spinner } from "@heroui/react";
import {
  AudioLines,
  BadgeDollarSign,
  CirclePause,
  Clock,
  History,
  LogIn,
  LogOut,
  MessageCircle,
  Play,
  RefreshCw,
  Settings,
  User,
} from "lucide-react";
import { useAppName } from "../appName";
import { PhoneLoginForm } from "../components/PhoneLoginForm";
import { UpdateEntry } from "../components/UpdateEntry";
import { useAuth } from "../context/AuthContext";
import { useInterview } from "../context/InterviewContext";
import { fetchWechatQrLoginEnabled, prefetchPlans } from "../services/account";
import { ContactPage } from "./Contact";
import { InterviewPreparePage } from "./InterviewPrepare";
import { InterviewRecordsPage } from "./InterviewRecords";
import { RechargePage } from "./Recharge";
import { SettingsPage } from "./Settings";

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}小时${minutes}分钟`;
}

type Page =
  "prepare" | "mock" | "records" | "recharge" | "settings" | "contact";

export function HomePage() {
  const { appName, setAppName } = useAppName();
  const { isStarted } = useInterview();
  const {
    user,
    remainingSeconds,
    isLoggingIn,
    loginError,
    loginQrImage,
    login,
    cancelLogin,
    logout,
  } = useAuth();
  const [page, setPage] = useState<Page>("prepare");
  const [loginOpen, setLoginOpen] = useState(false);
  const [wechatQrEnabled, setWechatQrEnabled] = useState<boolean | null>(null);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [mockOpen, setMockOpen] = useState(false);

  useEffect(() => {
    void prefetchPlans();
  }, []);

  useEffect(() => {
    void window.desktop.isMockInterviewOpen().then(setMockOpen);
    return window.desktop.onMockInterviewVisibility(setMockOpen);
  }, []);

  useEffect(() => {
    if (user) setLoginOpen(false);
  }, [user]);

  useEffect(() => {
    if (!loginOpen) {
      setWechatQrEnabled(null);
      return;
    }
    let cancelled = false;
    void fetchWechatQrLoginEnabled()
      .then((enabled) => {
        if (cancelled) return;
        setWechatQrEnabled(enabled);
        if (enabled) void login();
      })
      .catch(() => {
        if (cancelled) return;
        setWechatQrEnabled(true);
        void login();
      });
    return () => {
      cancelled = true;
    };
  }, [login, loginOpen]);

  function handleLoginOpenChange(open: boolean) {
    if (!open) cancelLogin();
    setLoginOpen(open);
  }

  async function handleLogoutConfirm() {
    await logout();
  }

  return (
    <div className="flex h-screen min-h-160">
      <aside className="flex w-64 shrink-0 flex-col bg-white px-4 py-5">
        <nav className="flex flex-col gap-2 font-normal" aria-label="主导航">
          <Button
            fullWidth
            className={cn(
              "justify-start",
              page === "prepare" && "bg-accent/10",
            )}
            variant="ghost"
            onPress={() => setPage("prepare")}
          >
            <span className="flex items-center gap-3">
              <Play
                className={cn("size-4", page === "prepare" && "text-brand")}
              />
              开始面试
            </span>
          </Button>
          <Button
            fullWidth
            className={cn("justify-start", page === "mock" && "bg-accent/10")}
            variant="ghost"
            onPress={() => setPage("mock")}
          >
            <span className="flex items-center gap-3">
              <AudioLines
                className="size-4"
                color={page === "mock" ? "#7c3aed" : undefined}
              />
              模拟面试
            </span>
          </Button>
          <Button
            fullWidth
            className={cn(
              "justify-start",
              page === "records" && "bg-accent/10",
            )}
            variant="ghost"
            onPress={() => setPage("records")}
          >
            <span className="flex items-center gap-3">
              <History
                className="size-4"
                color={page === "records" ? "#0d9488" : undefined}
              />
              面试记录
            </span>
          </Button>
          <Button
            fullWidth
            className={cn(
              "justify-start",
              page === "recharge" && "bg-accent/10",
            )}
            variant="ghost"
            onPress={() => setPage("recharge")}
          >
            <span className="flex items-center gap-3">
              <Clock
                className="size-4"
                color={page === "recharge" ? "orange" : undefined}
              />
              时长充值
              <Chip
                size="sm"
                variant="primary"
                className="px-2 bg-success-soft text-success-soft-foreground"
              >
                <BadgeDollarSign className="size-4" />
                <Chip.Label>0元试用！</Chip.Label>
              </Chip>
            </span>
          </Button>
          <Button
            fullWidth
            className={cn(
              "justify-start",
              page === "settings" && "bg-accent/10",
            )}
            variant="ghost"
            onPress={() => setPage("settings")}
          >
            <span className="flex items-center gap-3">
              <Settings
                className="size-4"
                color={page === "settings" ? "#3a83f7" : undefined}
              />
              设置
            </span>
          </Button>
          <Button
            fullWidth
            className={cn(
              "justify-start",
              page === "contact" && "bg-accent/10",
            )}
            variant="ghost"
            onPress={() => setPage("contact")}
          >
            <span className="flex items-center gap-3">
              <MessageCircle className="size-4" />
              联系我们
            </span>
          </Button>
        </nav>

        <div className="mt-auto flex flex-col gap-2">
          <div className="flex w-full justify-center items-center gap-3">
            <span className="font-mono text-sm text-muted">
              时长剩余 {formatDuration(remainingSeconds)}
              <Chip className="ml-2" variant="soft" color="warning">
                <CirclePause className="size-3" />
                <Chip.Label>
                  {mockOpen ? "模拟面试中" : isStarted ? "面试中" : "已暂停"}
                </Chip.Label>
              </Chip>
            </span>
          </div>
          {user ? (
            <div className="flex h-9 w-full items-center gap-2 rounded-md bg-[#ecebeb] px-3">
              {user.avatar_url ? (
                <img
                  alt=""
                  className="size-6 shrink-0 rounded-full object-cover"
                  src={user.avatar_url}
                />
              ) : (
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-white">
                  <User className="size-3.5" />
                </span>
              )}
              <p className="min-w-0 flex-1 truncate text-sm font-medium">
                {user.nickname || "微信用户"}
              </p>
              <Button
                aria-label="退出登录"
                size="sm"
                variant="ghost"
                className="size-7 min-w-7 shrink-0 p-0"
                onPress={() => setLogoutOpen(true)}
              >
                <LogOut className="size-4" />
              </Button>
            </div>
          ) : (
            <Button
              fullWidth
              variant="tertiary"
              onPress={() => setLoginOpen(true)}
            >
              <LogIn className="size-4" />
              登录
            </Button>
          )}
          <UpdateEntry />
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">
        {page === "prepare" ? (
          <InterviewPreparePage />
        ) : page === "mock" ? (
          <InterviewPreparePage variant="mock" />
        ) : page === "records" ? (
          <InterviewRecordsPage />
        ) : page === "recharge" ? (
          <RechargePage />
        ) : page === "contact" ? (
          <ContactPage />
        ) : (
          <SettingsPage appName={appName} onAppNameChange={setAppName} />
        )}
      </main>

      <Modal.Backdrop isOpen={loginOpen} onOpenChange={handleLoginOpenChange}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-3xl">
            <Modal.CloseTrigger />
            <Modal.Body className="mt-6 mb-2">
              <div className="flex items-stretch gap-8">
                <div className="flex min-w-0 flex-5 flex-col items-center gap-4">
                  <p className="text-base font-semibold">微信扫码登录</p>
                  {wechatQrEnabled === false ? (
                    <p className="max-w-52 text-center text-sm text-muted">
                      微信扫码服务维护中，请使用手机号登录
                    </p>
                  ) : (
                  <div className="relative flex size-40 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-white p-1">
                    {loginQrImage ? (
                      <img
                        alt="微信扫码登录"
                        className={cn(
                          "size-full rounded-full",
                          wechatQrEnabled === true &&
                            !isLoggingIn &&
                            "blur-sm grayscale",
                        )}
                        src={loginQrImage}
                      />
                    ) : (
                      <Spinner size="lg" />
                    )}
                    {wechatQrEnabled === true && !isLoggingIn ? (
                      <div
                        className={cn(
                          "absolute inset-0 flex items-center justify-center",
                          loginQrImage && "bg-black/35",
                        )}
                      >
                        <Button
                          aria-label="刷新二维码"
                          isIconOnly
                          className="bg-brand text-white"
                          onPress={() => void login()}
                        >
                          <RefreshCw className="size-5" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  )}
                  {wechatQrEnabled !== false && loginError ? (
                    <p className="text-center text-sm text-red-600">
                      {loginError}
                    </p>
                  ) : null}
                </div>
                <div className="min-w-0 flex-[6] border-l border-black/8 pl-8">
                  <PhoneLoginForm active={loginOpen} />
                </div>
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <AlertDialog.Backdrop isOpen={logoutOpen} onOpenChange={setLogoutOpen}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-100">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Heading>确认退出登录？</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">
                退出后需要重新扫码登录才能继续使用账号相关功能。
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                取消
              </Button>
              <Button
                slot="close"
                variant="danger"
                onPress={() => void handleLogoutConfirm()}
              >
                退出登录
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  );
}
