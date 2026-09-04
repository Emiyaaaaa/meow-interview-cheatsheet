import { useEffect, useRef, useState } from "react";
import { Button, Card, Chip, Description, Label } from "@heroui/react";
import { Sparkles } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import {
  claimTrial,
  createPaymentOrder,
  fetchOrder,
  fetchPlans,
  type RechargePlan,
} from "../services/account";

/** 原价保留 1 位小数；折扣 = price/regular，向下取整到 2 位小数后换算为「折」。整十（如 50）显示为 5 折。 */
function formatDiscountLabel(price: number, regular: number): string {
  const regularFixed = Number(regular.toFixed(1));
  if (regularFixed <= 0) return "";
  if (price <= 0) return "免费";
  const ratio = Math.floor((price / regularFixed) * 100) / 100;
  const zhe = Math.floor(ratio * 100);
  return `${zhe % 10 === 0 ? zhe / 10 : zhe}折`;
}

function fenToYuan(fen: number) {
  return fen / 100;
}

export function RechargePage() {
  const { user, setUser, refreshUser } = useAuth();
  const [plans, setPlans] = useState<RechargePlan[]>([]);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("");
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void fetchPlans()
      .then((next) => {
        if (active) {
          setPlans(next);
          setLoadError("");
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : "套餐加载失败");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function handlePurchase(plan: RechargePlan) {
    if (!user || pendingPlanId) return;
    setPendingPlanId(plan.id);
    setActionError("");
    setStatusText("");
    try {
      if (plan.trial) {
        const next = await claimTrial();
        setUser(next);
        setStatusText("体验时长已到账");
        return;
      }

      const order = await createPaymentOrder(plan.id);
      await window.desktop.openExternal(order.checkout_url);
      setStatusText("请在浏览器完成微信支付");

      const startedAt = Date.now();
      while (activeRef.current && Date.now() - startedAt < 15 * 60 * 1000) {
        await sleep(2000);
        if (!activeRef.current) return;
        const latest = await fetchOrder(order.id);
        if (!activeRef.current) return;
        if (latest.status === "paid") {
          await refreshUser();
          setStatusText("支付成功，时长已到账");
          return;
        }
        if (latest.status === "failed" || latest.status === "closed") {
          throw new Error("支付未完成");
        }
      }
      throw new Error("等待支付超时，请稍后在订单中确认");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "开通失败");
    } finally {
      setPendingPlanId(null);
    }
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-5xl px-10 py-8">
        <h2 className="text-3xl font-semibold tracking-tight">时长充值</h2>
        <p className="mt-6 text-sm text-muted">请先使用微信登录后再充值。</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-10 py-8">
      <h2 className="text-3xl font-semibold tracking-tight">时长充值</h2>
      {loadError ? (
        <p className="mt-6 text-sm text-red-600">{loadError}</p>
      ) : null}
      {actionError ? (
        <p className="mt-4 text-sm text-red-600">{actionError}</p>
      ) : null}
      {statusText ? (
        <p className="mt-4 text-sm text-emerald-600">{statusText}</p>
      ) : null}
      <div className="mt-10 grid grid-cols-2 gap-5 lg:grid-cols-3">
        {plans.map((plan, index) => {
          const discountLabel = formatDiscountLabel(
            fenToYuan(plan.price_fen),
            fenToYuan(plan.regular_fen),
          );
          const claimedTrial = plan.trial && user.trial_claimed;
          const pending = pendingPlanId === plan.id;

          return (
            <Card
              className="rounded-lg border p-4 border-black/6 hover:border-black/30"
              key={plan.id}
            >
              {discountLabel ? (
                <Chip
                  size="sm"
                  variant="soft"
                  color={discountLabel === "免费" ? "warning" : "success"}
                  className="absolute right-1.5 top-1.5 rounded-sm px-2.5"
                >
                  <Sparkles className="size-3" />
                  <Chip.Label>{discountLabel}</Chip.Label>
                </Chip>
              ) : null}
              <div className="flex flex-col gap-1">
                <Label className="text-lg font-semibold">{plan.title}</Label>
                <Description>{`获得${plan.minutes}分钟面试时长`}</Description>
              </div>
              <div className="mt-8 flex items-end justify-between">
                <div className="flex items-baseline gap-2">
                  <p>
                    <span className="text-sm">¥</span>
                    <span className="text-3xl font-semibold">
                      {plan.price_fen === 0 ? "0" : fenToYuan(plan.price_fen)}
                    </span>
                  </p>
                  <span className="text-sm text-muted line-through">
                    ¥{fenToYuan(plan.regular_fen)}
                  </span>
                </div>
                <Button
                  className={index === 1 ? "bg-black text-white" : ""}
                  isDisabled={Boolean(claimedTrial) || Boolean(pendingPlanId)}
                  isPending={pending}
                  variant={index === 1 ? "primary" : "outline"}
                  onPress={() => void handlePurchase(plan)}
                >
                  {claimedTrial
                    ? "已领取"
                    : plan.trial
                      ? "领取"
                      : pending
                        ? "支付中"
                        : "开通"}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
