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
import { Sparkles } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "../context/AuthContext";
import {
  applyRefund,
  claimTrial,
  createEpayOrder,
  fetchOrder,
  fetchOrders,
  fetchPaymentChannel,
  fetchPurchaseQrcode,
  getCachedPlans,
  prefetchPlans,
  redeemActivationCode,
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

function formatCodeInput(value: string) {
  const raw = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  const parts = [raw.slice(0, 4), raw.slice(4, 8), raw.slice(8, 12)].filter(
    Boolean,
  );
  return parts.join("-");
}

function orderTypeOf(order: AccountOrder) {
  return order.order_type === "activation_code" ? "activation_code" : "payment";
}

function orderStatusLabel(order: AccountOrder) {
  if (orderTypeOf(order) === "activation_code" && order.status === "paid")
    return "已兑换";
  if (order.status === "paid") return "已支付";
  if (order.status === "refund_pending") return "退款审核中";
  if (order.status === "refunded") return "已退款";
  return order.status;
}

function orderStatusColor(order: AccountOrder) {
  if (orderTypeOf(order) === "activation_code" && order.status === "paid")
    return "success" as const;
  if (order.status === "paid") return "success" as const;
  if (order.status === "refund_pending") return "warning" as const;
  if (order.status === "refunded") return "default" as const;
  return "default" as const;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function RechargePage() {
  const { user, setUser, refreshUser, requestPhoneBind } = useAuth();
  const [plans, setPlans] = useState<RechargePlan[]>(
    () => getCachedPlans() ?? [],
  );
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("");
  const [purchaseQr, setPurchaseQr] = useState<string | null>(null);
  const [purchaseQrError, setPurchaseQrError] = useState("");
  const [refundOrderId, setRefundOrderId] = useState<Key | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refundContact, setRefundContact] = useState("");
  const [refundError, setRefundError] = useState("");
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const [activationCode, setActivationCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [epayQr, setEpayQr] = useState<string | null>(null);
  const [epayPlanTitle, setEpayPlanTitle] = useState("");
  const historyModal = useOverlayState();
  const refundModal = useOverlayState();
  const purchaseModal = useOverlayState();
  const pollTokenRef = useRef(0);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      pollTokenRef.current += 1;
    };
  }, []);

  const historyOrders = orders.filter((order) =>
    HISTORY_STATUSES.has(order.status),
  );
  // Apple 支付的订单只能由用户向 Apple 申请退款，这里不提供入口。
  const refundableOrders = orders.filter(
    (order) =>
      order.status === "paid" &&
      orderTypeOf(order) !== "activation_code" &&
      order.pay_platform !== "ios",
  );

  useEffect(() => {
    let active = true;
    void prefetchPlans()
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

  async function openPurchaseModal() {
    setActionError("");
    setStatusText("");
    purchaseModal.open();
    if (purchaseQr) return;
    try {
      setPurchaseQrError("");
      setPurchaseQr(await fetchPurchaseQrcode());
    } catch (error) {
      setPurchaseQrError(
        error instanceof Error ? error.message : "购买码获取失败",
      );
    }
  }

  /** 支付发生在手机上，桌面端只能在用户关掉引导后主动同步一次余额。 */
  function handlePurchaseOpenChange(open: boolean) {
    purchaseModal.setOpen(open);
    if (!open && user) {
      void refreshUser();
      void reloadOrders();
    }
  }

  function openRefundModal() {
    if (!user) {
      toast("请登录");
      return;
    }
    setRefundOrderId(refundableOrders[0]?.id ?? null);
    setRefundReason("");
    setRefundContact("");
    setRefundError("");
    refundModal.open();
  }

  async function handleRedeem() {
    if (redeeming) return;
    if (!user) {
      toast("请登录");
      return;
    }
    const code = activationCode.trim();
    if (!code) {
      setActionError("请输入激活码");
      return;
    }
    setRedeeming(true);
    setActionError("");
    setStatusText("");
    try {
      const result = await redeemActivationCode(code);
      setUser(result.user);
      setActivationCode("");
      setStatusText("激活成功，时长已到账");
      toast("激活码兑换成功");
      await reloadOrders();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "兑换激活码失败");
    } finally {
      setRedeeming(false);
    }
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
      setRefundError(
        error instanceof Error ? error.message : "提交退款申请失败",
      );
    } finally {
      setRefundSubmitting(false);
    }
  }

  function cancelEpay() {
    pollTokenRef.current += 1;
    setEpayQr(null);
    setEpayPlanTitle("");
    setPendingPlanId(null);
  }

  async function startEpay(plan: RechargePlan) {
    const order = await createEpayOrder(plan.id);
    if (!order.checkout_url) {
      throw new Error("未获取到支付二维码");
    }

    const pollToken = pollTokenRef.current + 1;
    pollTokenRef.current = pollToken;
    setEpayQr(order.checkout_url);
    setEpayPlanTitle(plan.title);
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
        setEpayQr(null);
        setEpayPlanTitle("");
        setStatusText("支付成功，时长已到账");
        await reloadOrders();
        return;
      }
      if (latest.status === "failed" || latest.status === "closed") {
        setEpayQr(null);
        setEpayPlanTitle("");
        throw new Error("支付未完成");
      }
    }
    if (pollTokenRef.current !== pollToken) return;
    setEpayQr(null);
    setEpayPlanTitle("");
    throw new Error("等待支付超时，请稍后在订单中确认");
  }

  async function handlePurchase(plan: RechargePlan) {
    if (pendingPlanId) return;
    if (!user) {
      toast("请登录");
      return;
    }
    if (!plan.trial) {
      setPendingPlanId(plan.id);
      setActionError("");
      setStatusText("");
      try {
        if (!user.phone) {
          const bound = await requestPhoneBind();
          if (!bound) return;
        }
        if (user.wechat_bound === false) {
          setEpayQr(null);
          await startEpay(plan);
          return;
        }
        const channel = await fetchPaymentChannel();
        if (channel !== "epay") {
          void openPurchaseModal();
          return;
        }
        setEpayQr(null);
        await startEpay(plan);
      } catch (error) {
        setEpayQr(null);
        setEpayPlanTitle("");
        setActionError(error instanceof Error ? error.message : "开通失败");
      } finally {
        setPendingPlanId(null);
      }
      return;
    }

    setPendingPlanId(plan.id);
    setActionError("");
    setStatusText("");
    try {
      setUser(await claimTrial());
      setStatusText("体验时长已到账");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "领取失败");
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
        <p className="mt-4 text-sm text-brand">{statusText}</p>
      ) : null}

      {epayQr ? (
        <Card className="mt-6 max-w-sm rounded-lg border border-black/10 p-5">
          <div className="flex flex-col items-center gap-3">
            <Label className="text-base font-semibold">
              {epayPlanTitle || "微信支付"}
            </Label>
            <Description>请使用微信扫一扫完成支付</Description>
            <div className="rounded-md bg-white p-3">
              <QRCodeSVG value={epayQr} size={200} level="M" includeMargin />
            </div>
            <Button variant="outline" onPress={cancelEpay}>
              取消支付
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="mt-10 grid grid-cols-2 gap-5 lg:grid-cols-3">
        {plans.map((plan) => {
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
                  className="bg-brand/20 text-brand"
                  isDisabled={Boolean(claimedTrial) || Boolean(pendingPlanId)}
                  isPending={pending}
                  onPress={() => void handlePurchase(plan)}
                >
                  {claimedTrial
                    ? "已领取"
                    : plan.trial
                      ? pending
                        ? "领取中"
                        : "领取"
                      : "购买"}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-10 max-w-xl rounded-lg border border-black/6 p-4">
        <div className="flex flex-col gap-1">
          <Label className="text-lg font-semibold">激活码兑换</Label>
        </div>
        <div className="flex items-end gap-3">
          <TextField
            className="flex-1"
            name="activation-code"
            value={activationCode}
            onChange={(value) => setActivationCode(formatCodeInput(value))}
          >
            <Input
              placeholder="XXXX-XXXX-XXXX"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleRedeem();
                }
              }}
            />
          </TextField>
          <Button
            className="bg-brand text-white"
            isDisabled={redeeming || Boolean(pendingPlanId)}
            isPending={redeeming}
            onPress={() => void handleRedeem()}
          >
            {redeeming ? "兑换中" : "兑换"}
          </Button>
        </div>
      </Card>

      <div className="mt-12 flex justify-center gap-3 border-t border-black/6 pt-8">
        <Button variant="outline" onPress={historyModal.open}>
          充值记录
        </Button>
        <Button
          isDisabled={Boolean(user) && refundableOrders.length === 0}
          variant="outline"
          onPress={openRefundModal}
        >
          申请退款
        </Button>
      </div>

      <Modal.Backdrop
        isOpen={purchaseModal.isOpen}
        onOpenChange={handlePurchaseOpenChange}
      >
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>微信扫码购买</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="items-center gap-4">
              <div className="flex size-50 items-center justify-center rounded-md border border-black/10 bg-white">
                {purchaseQr ? (
                  <img
                    alt="微信扫码购买时长"
                    className="size-full"
                    src={purchaseQr}
                  />
                ) : (
                  <span className="text-sm text-muted">
                    {purchaseQrError ? "购买码获取失败" : "正在生成购买码…"}
                  </span>
                )}
              </div>
              <Description>
                用微信扫描上方小程序码，在小程序内选择套餐完成支付。支付成功后时长会自动到账，关闭本窗口即可刷新。
              </Description>
              {purchaseQrError ? (
                <p className="text-sm text-red-600">{purchaseQrError}</p>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" className="bg-brand text-white">
                我已完成支付
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <Modal.Backdrop
        isOpen={historyModal.isOpen}
        onOpenChange={historyModal.setOpen}
      >
        <Modal.Container size="lg">
          <Modal.Dialog className="sm:max-w-4xl">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>充值记录</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {historyOrders.length === 0 ? (
                <p className="text-sm text-muted">暂无充值记录</p>
              ) : (
                <Table>
                  <Table.ScrollContainer>
                    <Table.Content aria-label="充值记录" className="min-w-180">
                      <Table.Header>
                        <Table.Column isRowHeader>订单号</Table.Column>
                        <Table.Column>类型</Table.Column>
                        <Table.Column>充值时长</Table.Column>
                        <Table.Column>支付金额</Table.Column>
                        <Table.Column>激活码</Table.Column>
                        <Table.Column>状态</Table.Column>
                      </Table.Header>
                      <Table.Body>
                        {historyOrders.map((order) => (
                          <Table.Row id={order.id} key={order.id}>
                            <Table.Cell>
                              <span className="font-mono text-sm">
                                {order.out_trade_no}
                              </span>
                            </Table.Cell>
                            <Table.Cell>
                              {orderTypeOf(order) === "activation_code"
                                ? "激活码订单"
                                : "支付订单"}
                            </Table.Cell>
                            <Table.Cell>{order.minutes}分钟</Table.Cell>
                            <Table.Cell>
                              {formatAmount(order.amount_total)}
                            </Table.Cell>
                            <Table.Cell>
                              {order.activation_code ? (
                                <span className="font-mono text-sm">
                                  {order.activation_code}
                                </span>
                              ) : (
                                "—"
                              )}
                            </Table.Cell>
                            <Table.Cell>
                              <Chip
                                size="sm"
                                variant="soft"
                                color={orderStatusColor(order)}
                              >
                                <Chip.Label>
                                  {orderStatusLabel(order)}
                                </Chip.Label>
                              </Chip>
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                </Table>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <Modal.Backdrop
        isOpen={refundModal.isOpen}
        onOpenChange={refundModal.setOpen}
      >
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
                        <ListBox.Item
                          id={order.id}
                          key={order.id}
                          textValue={label}
                        >
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
              <TextField
                name="contact"
                value={refundContact}
                onChange={setRefundContact}
              >
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
                className="bg-brand text-white"
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
