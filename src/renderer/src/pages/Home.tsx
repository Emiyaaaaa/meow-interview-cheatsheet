import { useState, type FormEvent } from "react";
import {
  Button,
  Chip,
  cn,
  Input,
  Label,
  Modal,
  TextField,
} from "@heroui/react";
import {
  BadgeDollarSign,
  CirclePause,
  Clock,
  LogIn,
  Play,
  Settings,
  UserRound,
} from "lucide-react";
import { useAppName } from "../appName";
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
  const { elapsedSeconds } = useInterview();
  const [page, setPage] = useState<Page>("prepare");
  const [phone, setPhone] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [codeSent, setCodeSent] = useState(false);

  function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^1\d{10}$/.test(phoneInput) || codeInput.length !== 6) return;
    setPhone(phoneInput);
    setLoginOpen(false);
    setCodeInput("");
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
              时长剩余 {formatDuration(elapsedSeconds)}
              <Chip className="ml-2" variant="soft" color="warning">
                <CirclePause className="size-3" />
                <Chip.Label>已暂停</Chip.Label>
              </Chip>
            </span>
          </div>
          {phone ? (
            <div className="flex items-center gap-3 rounded-xl border border-black/8 bg-[#fafafa] p-3">
              <div className="grid size-9 place-items-center rounded-full bg-black text-white">
                <UserRound className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted">当前账号</p>
                <p className="truncate text-sm font-medium">{phone}</p>
              </div>
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

      <Modal.Backdrop isOpen={loginOpen} onOpenChange={setLoginOpen}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Icon className="bg-black text-white">
                <UserRound className="size-5" />
              </Modal.Icon>
              <Modal.Heading>手机号登录</Modal.Heading>
            </Modal.Header>
            <form onSubmit={handleLogin}>
              <Modal.Body className="gap-5">
                <p className="text-sm text-muted">
                  登录后即可同步你的剩余时长与面试记录。
                </p>
                <TextField name="phone" type="tel">
                  <Label>手机号</Label>
                  <Input
                    fullWidth
                    maxLength={11}
                    placeholder="请输入 11 位手机号"
                    value={phoneInput}
                    onChange={(event) =>
                      setPhoneInput(
                        event.currentTarget.value.replace(/\D/g, ""),
                      )
                    }
                  />
                </TextField>
                <div className="flex items-end gap-2">
                  <TextField className="min-w-0 flex-1" name="code">
                    <Label>验证码</Label>
                    <Input
                      fullWidth
                      maxLength={6}
                      placeholder="请输入验证码"
                      value={codeInput}
                      onChange={(event) =>
                        setCodeInput(
                          event.currentTarget.value.replace(/\D/g, ""),
                        )
                      }
                    />
                  </TextField>
                  <Button
                    className="mb-px shrink-0"
                    isDisabled={!/^1\d{10}$/.test(phoneInput)}
                    type="button"
                    variant="secondary"
                    onPress={() => setCodeSent(true)}
                  >
                    {codeSent ? "已发送 123456" : "获取验证码"}
                  </Button>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  type="button"
                  variant="secondary"
                  onPress={() => setLoginOpen(false)}
                >
                  取消
                </Button>
                <Button
                  className="bg-black text-white"
                  isDisabled={
                    !/^1\d{10}$/.test(phoneInput) || codeInput.length !== 6
                  }
                  type="submit"
                >
                  登录
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
