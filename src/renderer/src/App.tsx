import { useState, type FormEvent } from "react";
import { Button, Input, Label, Modal, TextField } from "@heroui/react";
import {
  ChevronRight,
  CircleDollarSign,
  LogIn,
  Play,
  Sparkles,
  UserRound,
} from "lucide-react";
import { InterviewPage } from "./pages/InterviewPage";
import { RechargePage } from "./pages/RechargePage";

type Page = "interview" | "recharge";

export function App() {
  const [page, setPage] = useState<Page>("interview");
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
    <div className="flex h-screen min-h-160 bg-[#f4f4f4] text-foreground">
      <aside className="flex w-64 shrink-0 flex-col border-r border-black/8 bg-white px-4 py-5">
        <div className="mb-10 flex items-center gap-3 px-2">
          <div className="grid size-10 place-items-center rounded-xl bg-black text-white">
            <Sparkles className="size-5" />
          </div>
          <div>
            <h1 className="font-semibold tracking-tight">神奇面试小抄</h1>
            <p className="text-xs text-muted">AI 面试助手</p>
          </div>
        </div>

        <nav className="flex flex-col gap-2" aria-label="主导航">
          <Button
            className={`h-11 justify-between px-3 ${
              page === "interview"
                ? "bg-black text-white"
                : "bg-transparent text-foreground"
            }`}
            variant={page === "interview" ? "primary" : "ghost"}
            onPress={() => setPage("interview")}
          >
            <span className="flex items-center gap-3">
              <Play className="size-4" />
              开始面试
            </span>
            <ChevronRight className="size-4 opacity-60" />
          </Button>
          <Button
            className={`h-11 justify-between px-3 ${
              page === "recharge"
                ? "bg-black text-white"
                : "bg-transparent text-foreground"
            }`}
            variant={page === "recharge" ? "primary" : "ghost"}
            onPress={() => setPage("recharge")}
          >
            <span className="flex items-center gap-3">
              <CircleDollarSign className="size-4" />
              时长充值
            </span>
            <ChevronRight className="size-4 opacity-60" />
          </Button>
        </nav>

        <div className="mt-auto">
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
              className="h-11 bg-black text-white"
              fullWidth
              onPress={() => setLoginOpen(true)}
            >
              <LogIn className="size-4" />
              登录
            </Button>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">
        {page === "interview" ? <InterviewPage /> : <RechargePage />}
      </main>

      <Modal.Backdrop
        isOpen={loginOpen}
        onOpenChange={setLoginOpen}
        variant="blur"
      >
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
                      setPhoneInput(event.currentTarget.value.replace(/\D/g, ""))
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
