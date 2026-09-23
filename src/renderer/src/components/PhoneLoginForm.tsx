import { useEffect, useState } from "react";
import { Button, Input, TextField } from "@heroui/react";
import { useAuth } from "../context/AuthContext";
import {
  loginWithPhone,
  persistSessionToken,
  sendPhoneLoginCode,
} from "../services/account";

const PHONE_PATTERN = /^1[3-9]\d{9}$/;

export function PhoneLoginForm({ active }: { active: boolean }) {
  const { setUser } = useAuth();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [retryUntil, setRetryUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setPhone("");
    setCode("");
    setError("");
    setRetryUntil(0);
  }, [active]);

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
      const result = await sendPhoneLoginCode(nextPhone);
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

  async function handleLogin() {
    if (submitting) return;
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
    setSubmitting(true);
    setError("");
    try {
      const result = await loginWithPhone(nextPhone, nextCode);
      persistSessionToken(result.token);
      setUser(result.user);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <div>
        <p className="text-base font-semibold">手机号登录</p>
      </div>
      <TextField
        name="login-phone"
        value={phone}
        onChange={(value) => setPhone(value.replace(/\D/g, "").slice(0, 11))}
      >
        <Input inputMode="numeric" placeholder="请输入手机号" />
      </TextField>
      <div className="flex items-end gap-2">
        <TextField
          className="flex-1"
          name="login-code"
          value={code}
          onChange={(value) => setCode(value.replace(/\D/g, "").slice(0, 8))}
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
      <Button
        className="bg-brand text-white w-full mt-4"
        isPending={submitting}
        onPress={() => void handleLogin()}
      >
        注册/登录
      </Button>
    </div>
  );
}
