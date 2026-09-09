import { useEffect, useRef, useState } from "react";
import type { Key } from "@heroui/react";
import {
  Button,
  Card,
  Chip,
  Description,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  Table,
  TextArea,
  TextField,
  toast,
  useOverlayState,
} from "@heroui/react";
import { QRCodeSVG } from "qrcode.react";
import { Sparkles } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import {
  applyRefund,
  claimTrial,
  createPaymentOrder,
  fetchOrder,
  fetchOrders,
  fetchPlans,
  type AccountOrder,
  type RechargePlan,
} from "../services/account";

const HISTORY_STATUSES = new Set(["paid", "refund_pending", "refunded"]);

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

function formatAmount(fen: number) {
  return `¥${fenToYuan(fen).toFixed(2)}`;
}

function orderStatusLabel(status: string) {
  if (status === "paid") return "已支付";
  if (status === "refund_pending") return "退款审核中";
  if (status === "refunded") return "已退款";
  return status;
}

function orderStatusColor(status: string) {
  if (status === "paid") return "success" as const;
  if (status === "refund_pending") return "warning" as const;
  if (status === "refunded") return "default" as const;
  return "default" as const;
}

export function RechargePage() {
  const { user, setUser, refreshUser } = useAuth();
  const [plans, setPlans] = useState<RechargePlan[]>([]);
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("");
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [qrPlanTitle, setQrPlanTitle] = useState("");
  const [refundOrderId, setRefundOrderId] = useState<Key | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refundContact, setRefundContact] = useState("");
  const [refundError, setRefundError] = useState("");
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const refundModal = useOverlayState();
  const activeRef = useRef(true);
  const pollTokenRef = useRef(0);

  const historyOrders = orders.filter((order) => HISTORY_STATUSES.has(order.status));
  const refundableOrders = orders.filter((order) => order.status === "paid");

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      pollTokenRef.current += 1;
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

  useEffect(() => {
    if (!user) {
      setOrders([]);
      return;
    }
    let active = true;
    void fetchOrders()
      .then((next) => {
        if (active) setOrders(next);
      })
      .catch(() => {
        if (active) setOrders([]);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  async function reloadOrders() {
    if (!user) return;
    try {
      setOrders(await fetchOrders());
    } catch {
      /* keep current list */
    }
  }

  function cancelPayment() {
    pollTokenRef.current += 1;
    setQrPayload(null);
    setQrPlanTitle("");
    setPendingPlanId(null);
    setStatusText("已取消支付");
  }

  function openRefundModal() {
    setRefundOrderId(refundableOrders[0]?.id ?? null);
    setRefundReason("");
    setRefundContact("");
    setRefundError("");
    refundModal.open();
  }

  async function handleRefund() {
    const orderId = typeof refundOrderId === "string" ? refundOrderId : "";
    const reason = refundReason.trim();
    if (!orderId) {
      setRefundError("请选择退款订单");
      return;
    }
    if (!reason) {
      setRefundError("请填写退款原因");
      return;
    }
    setRefundSubmitting(true);
    setRefundError("");
    try {
      await applyRefund(orderId, reason, refundContact);
      toast("退款申请已提交，请等待审核");
      refundModal.close();
      await reloadOrders();
    } catch (error) {
      setRefundError(error instanceof Error ? error.message : "提交退款申请失败");
    } finally {
      setRefundSubmitting(false);
    }
  }

  async function handlePurchase(plan: RechargePlan) {
    if (pendingPlanId) return;
    if (!user) {
      toast("请先登录");
      return;
    }
    setPendingPlanId(plan.id);
    setActionError("");
    setStatusText("");
    setQrPayload(null);
    try {
      if (plan.trial) {
        const next = await claimTrial();
        setUser(next);
        setStatusText("体验时长已到账");
        setPendingPlanId(null);
        return;
      }

      const order = await createPaymentOrder(plan.id);
      if (!order.checkout_url) {
        throw new Error("未获取到支付二维码");
      }

      const pollToken = pollTokenRef.current + 1;
      pollTokenRef.current = pollToken;
      setQrPayload(order.checkout_url);
      setQrPlanTitle(plan.title);
      setStatusText("请使用微信扫码支付");

      const startedAt = Date.now();
      while (
        activeRef.current &&
        pollTokenRef.current === pollToken &&
        Date.now() - startedAt < 15 * 60 * 1000
      ) {
        await sleep(2000);
        if (!activeRef.current || pollTokenRef.current !== pollToken) return;
        const latest = await fetchOrder(order.id);
        if (!activeRef.current || pollTokenRef.current !== pollToken) return;
        if (latest.status === "paid") {
          await refreshUser();
          setQrPayload(null);
          setQrPlanTitle("");
          setStatusText("支付成功，时长已到账");
          await reloadOrders();
          return;
        }
        if (latest.status === "failed" || latest.status === "closed") {
          throw new Error("支付未完成");
        }
      }
      if (pollTokenRef.current !== pollToken) return;
      throw new Error("等待支付超时，请稍后在订单中确认");
    } catch (error) {
      setQrPayload(null);
      setQrPlanTitle("");
      setActionError(error instanceof Error ? error.message : "开通失败");
    } finally {
      setPendingPlanId(null);
    }
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

      {qrPayload ? (
        <Card className="mt-6 max-w-sm rounded-lg border border-black/10 p-5">
          <div className="flex flex-col items-center gap-3">
            <Label className="text-base font-semibold">
              {qrPlanTitle || "微信支付"}
            </Label>
            <Description>请使用微信扫一扫完成支付</Description>
            <div className="rounded-md bg-white p-3">
              <QRCodeSVG value={qrPayload} size={200} level="M" includeMargin />
            </div>
            <Button variant="outline" onPress={cancelPayment}>
              取消支付
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="mt-10 grid grid-cols-2 gap-5 lg:grid-cols-3">
        {plans.map((plan, index) => {
          const discountLabel = formatDiscountLabel(
            fenToYuan(plan.price_fen),
            fenToYuan(plan.regular_fen),
          );
          const claimedTrial = Boolean(plan.trial && user?.trial_claimed);
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

      <section className="mt-14">
        <h3 className="text-xl font-semibold tracking-tight">充值记录</h3>
        {historyOrders.length === 0 ? (
          <p className="mt-4 text-sm text-muted">暂无充值记录</p>
        ) : (
          <Table className="mt-4">
            <Table.ScrollContainer>
              <Table.Content aria-label="充值记录" className="min-w-[520px]">
                <Table.Header>
                  <Table.Column isRowHeader>订单号</Table.Column>
                  <Table.Column>充值时长</Table.Column>
                  <Table.Column>支付金额</Table.Column>
                  <Table.Column>状态</Table.Column>
                </Table.Header>
                <Table.Body>
                  {historyOrders.map((order) => (
                    <Table.Row id={order.id} key={order.id}>
                      <Table.Cell>
                        <span className="font-mono text-sm">{order.out_trade_no}</span>
                      </Table.Cell>
                      <Table.Cell>{order.minutes}分钟</Table.Cell>
                      <Table.Cell>{formatAmount(order.amount_total)}</Table.Cell>
                      <Table.Cell>
                        <Chip size="sm" variant="soft" color={orderStatusColor(order.status)}>
                          <Chip.Label>{orderStatusLabel(order.status)}</Chip.Label>
                        </Chip>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        )}
      </section>

      <div className="mt-12 flex justify-center border-t border-black/6 pt-8">
        <Button
          isDisabled={!user || refundableOrders.length === 0}
          variant="outline"
          onPress={openRefundModal}
        >
          申请退款
        </Button>
      </div>

      <Modal.Backdrop isOpen={refundModal.isOpen} onOpenChange={refundModal.setOpen}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-md">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>申请退款</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              <Select
                className="w-full"
                isRequired
                placeholder="请选择退款订单"
                value={refundOrderId}
                onChange={setRefundOrderId}
              >
                <Label>退款订单</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {refundableOrders.map((order) => {
                      const label = `${order.out_trade_no} · ${order.minutes}分钟 · ${formatAmount(order.amount_total)}`;
                      return (
                        <ListBox.Item id={order.id} key={order.id} textValue={label}>
                          {label}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      );
                    })}
                  </ListBox>
                </Select.Popover>
              </Select>
              <TextField
                isRequired
                name="reason"
                value={refundReason}
                onChange={setRefundReason}
              >
                <Label>退款原因</Label>
                <TextArea
                  className="min-h-24"
                  placeholder="请说明申请退款的原因"
                />
              </TextField>
              <TextField name="contact" value={refundContact} onChange={setRefundContact}>
                <Label>联系方式（选填）</Label>
                <Input placeholder="手机号 / 微信 / 邮箱" />
              </TextField>
              {refundError ? (
                <p className="text-sm text-red-600">{refundError}</p>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="outline">
                取消
              </Button>
              <Button
                className="bg-black text-white"
                isDisabled={refundSubmitting}
                isPending={refundSubmitting}
                onPress={() => void handleRefund()}
              >
                提交
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
