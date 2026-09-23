import { useEffect, useState } from "react";
import { Button, Input, Modal, TextField } from "@heroui/react";
import { useAuth } from "../context/AuthContext";
import { bindPhone, sendPhoneCode } from "../services/account";

const PHONE_PATTERN = /^1[3-9]\d{9}$/;

export function BindPhoneModal() {
  const { bindPhoneOpen, completePhoneBind, logout } = useAuth();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [binding, setBinding] = useState(false);
  const [retryUntil, setRetryUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!bindPhoneOpen) return;
    setPhone("");
    setCode("");
    setError("");
    setRetryUntil(0);
  }, [bindPhoneOpen]);

  useEffect(() => {
    if (retryUntil <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [retryUntil]);

  const secondsLeft = Math.max(0, Math.ceil((retryUntil - now) / 1000));

  async function handleSend() {
    if (sending || secondsLeft > 0) return;
    const nextPhone = phone.trim();
    if (!PHONE_PATTERN.test(nextPhone)) {
      setError("请输入正确的手机号");
      return;
    }
    setSending(true);
    setError("");
    try {
      const result = await sendPhoneCode(nextPhone);
      const sentAt = Date.now();
      setNow(sentAt);
      setRetryUntil(sentAt + result.retry_after * 1000);
    } catch (sendError) {
      setError(
        sendError instanceof Error ? sendError.message : "发送验证码失败",
      );
    } finally {
      setSending(false);
    }
  }

  async function handleBind() {
    if (binding) return;
    const nextPhone = phone.trim();
    const nextCode = code.trim();
    if (!PHONE_PATTERN.test(nextPhone)) {
      setError("请输入正确的手机号");
      return;
    }
    if (!/^\d{4,8}$/.test(nextCode)) {
      setError("请输入验证码");
      return;
    }
    setBinding(true);
    setError("");
    try {
      const nextUser = await bindPhone(nextPhone, nextCode);
      completePhoneBind(nextUser);
    } catch (bindError) {
      setError(bindError instanceof Error ? bindError.message : "绑定失败");
    } finally {
      setBinding(false);
    }
  }

  return (
    <Modal.Backdrop
      isOpen={bindPhoneOpen}
      isDismissable={false}
      isKeyboardDismissDisabled
      onOpenChange={() => {
        // 没绑手机号之前不能关掉，只能退出登录。
      }}
    >
      <Modal.Container size="sm">
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>绑定手机号</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="gap-4 flex flex-col">
            <TextField
              name="phone"
              value={phone}
              onChange={(value) =>
                setPhone(value.replace(/\D/g, "").slice(0, 11))
              }
            >
              <Input inputMode="numeric" placeholder="请输入手机号" />
            </TextField>
            <div className="flex items-end gap-2">
              <TextField
                className="flex-1"
                name="code"
                value={code}
                onChange={(value) =>
                  setCode(value.replace(/\D/g, "").slice(0, 8))
                }
              >
                <Input inputMode="numeric" placeholder="6 位验证码" />
              </TextField>
              <Button
                className="mb-0.5 shrink-0"
                isDisabled={secondsLeft > 0}
                isPending={sending}
                variant="secondary"
                onPress={() => void handleSend()}
              >
                {secondsLeft > 0 ? `${secondsLeft}s` : "获取验证码"}
              </Button>
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onPress={() => void logout()}>
              退出
            </Button>
            <Button
              className="bg-brand text-white"
              isPending={binding}
              onPress={() => void handleBind()}
            >
              确认绑定
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
