import { useEffect, useState } from "react";
import { Button, Chip, cn, Modal } from "@heroui/react";
import {
  BadgeDollarSign,
  CirclePause,
  Clock,
  LogIn,
  LogOut,
  Play,
  Settings,
  UserRound,
} from "lucide-react";
import { useAppName } from "../appName";
import { useAuth } from "../context/AuthContext";
import { useInterview } from "../context/InterviewContext";
import { InterviewPreparePage } from "./InterviewPrepare";
import { RechargePage } from "./Recharge";
import { SettingsPage } from "./Settings";

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}小时${minutes}分钟`;
}

type Page = "prepare" | "recharge" | "settings";

export function HomePage() {
  const { appName, setAppName } = useAppName();
  const { isStarted } = useInterview();
  const {
    user,
    remainingSeconds,
    isLoggingIn,
    loginError,
    login,
    cancelLogin,
    logout,
  } = useAuth();
  const [page, setPage] = useState<Page>("prepare");
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    if (user) setLoginOpen(false);
  }, [user]);

  function handleLoginOpenChange(open: boolean) {
    if (!open) cancelLogin();
    setLoginOpen(open);
  }

  return (
    <div className="flex h-screen min-h-160">
      <aside className="flex w-64 shrink-0 flex-col bg-white px-4 py-5">
        <nav
          className="flex flex-col gap-2 mt-5 font-normal"
          aria-label="主导航"
        >
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
                className="size-4"
                color={page === "prepare" ? "green" : undefined}
              />
              开始面试
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
        </nav>

        <div className="mt-auto flex flex-col gap-2">
          <div className="flex w-full justify-center items-center gap-3">
            <span className="font-mono text-sm text-muted">
              时长剩余 {formatDuration(user ? remainingSeconds : 0)}
              <Chip className="ml-2" variant="soft" color="warning">
                <CirclePause className="size-3" />
                <Chip.Label>{isStarted ? "面试中" : "已暂停"}</Chip.Label>
              </Chip>
            </span>
          </div>
          {user ? (
            <div className="flex items-center gap-3 rounded-xl border border-black/8 bg-[#fafafa] p-3">
              {user.avatar_url ? (
                <img
                  alt=""
                  className="size-9 rounded-full object-cover"
                  src={user.avatar_url}
                />
              ) : (
                <div className="grid size-9 place-items-center rounded-full bg-black text-white">
                  <UserRound className="size-4" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted">当前账号</p>
                <p className="truncate text-sm font-medium">
                  {user.nickname || "微信用户"}
                </p>
              </div>
              <Button
                aria-label="退出登录"
                size="sm"
                variant="ghost"
                onPress={() => void logout()}
              >
                <LogOut className="size-4" />
              </Button>
            </div>
          ) : (
            <Button
              fullWidth
              variant="tertiary"
              onPress={() => {
                setLoginOpen(true);
                void login();
              }}
            >
              <LogIn className="size-4" />
              登录
            </Button>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">
        {page === "prepare" ? (
          <InterviewPreparePage />
        ) : page === "recharge" ? (
          <RechargePage />
        ) : (
          <SettingsPage appName={appName} onAppNameChange={setAppName} />
        )}
      </main>

      <Modal.Backdrop isOpen={loginOpen} onOpenChange={handleLoginOpenChange}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Icon className="bg-[#07c160] text-white">
                <UserRound className="size-5" />
              </Modal.Icon>
              <Modal.Heading>微信扫码登录</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="gap-5">
              <p className="text-sm text-muted">
                已在浏览器打开微信扫码页。扫码确认后会自动回到应用。
              </p>
              {loginError ? (
                <p className="text-sm text-red-600">{loginError}</p>
              ) : (
                <p className="text-sm text-muted">
                  {isLoggingIn ? "等待扫码确认…" : "可重新发起登录"}
                </p>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button
                type="button"
                variant="secondary"
                onPress={() => handleLoginOpenChange(false)}
              >
                取消
              </Button>
              <Button
                className="bg-[#07c160] text-white"
                isPending={isLoggingIn}
                onPress={() => void login()}
              >
                {isLoggingIn ? "等待扫码" : "重新打开扫码"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
