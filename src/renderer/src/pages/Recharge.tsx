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
  Spinner,
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

function showErrorToast(title: string, description?: string) {
  toast(title, {
    description: description && description !== title ? description : undefined,
    variant: "danger",
    timeout: 0,
  });
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function RechargePage() {
  const { user, setUser, refreshUser, requestPhoneBind } = useAuth();
  const [plans, setPlans] = useState<RechargePlan[]>(
    () => getCachedPlans() ?? [],
  );
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  const [purchaseQr, setPurchaseQr] = useState<string | null>(null);
  const [purchaseQrError, setPurchaseQrError] = useState("");
  const [refundOrderId, setRefundOrderId] = useState<Key | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refundContact, setRefundContact] = useState("");
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const [activationCode, setActivationCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [epayQr, setEpayQr] = useState<string | null>(null);
  const [epayPlanTitle, setEpayPlanTitle] = useState("");
  const [epayAmountFen, setEpayAmountFen] = useState<number | null>(null);
  const historyModal = useOverlayState();
  const refundModal = useOverlayState();
  const purchaseModal = useOverlayState();
  const pollTokenRef = useRef(0);
  const activeRef = useRef(true);
  const purchaseLockRef = useRef(false);
  const purchaseGenRef = useRef(0);

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
        if (active) setPlans(next);
      })
      .catch((error: unknown) => {
        if (active) showErrorToast("套餐加载失败", errorMessage(error, "套餐加载失败"));
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
    purchaseModal.open();
    if (purchaseQr) return;
    try {
      setPurchaseQrError("");
      setPurchaseQr(await fetchPurchaseQrcode());
    } catch (error) {
      const message = errorMessage(error, "购买码获取失败");
      setPurchaseQrError(message);
      showErrorToast("购买码获取失败", message);
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
      showErrorToast("请输入激活码");
      return;
    }
    setRedeeming(true);
    try {
      const result = await redeemActivationCode(code);
      setUser(result.user);
      setActivationCode("");
      toast.success("激活成功", { description: "时长已到账" });
      await reloadOrders();
    } catch (error) {
      showErrorToast("兑换激活码失败", errorMessage(error, "兑换激活码失败"));
    } finally {
      setRedeeming(false);
    }
  }

  async function handleRefund() {
    const orderId = typeof refundOrderId === "string" ? refundOrderId : "";
    const reason = refundReason.trim();
    if (!orderId) {
      showErrorToast("请选择退款订单");
      return;
    }
    if (!reason) {
      showErrorToast("请填写退款原因");
      return;
    }
    setRefundSubmitting(true);
    try {
      await applyRefund(orderId, reason, refundContact);
      toast.success("退款申请已提交", { description: "请等待审核" });
      refundModal.close();
      await reloadOrders();
    } catch (error) {
      showErrorToast("提交退款申请失败", errorMessage(error, "提交退款申请失败"));
    } finally {
      setRefundSubmitting(false);
    }
  }

  function clearEpaySession() {
    setEpayQr(null);
    setEpayPlanTitle("");
    setEpayAmountFen(null);
  }

  function cancelEpay() {
    pollTokenRef.current += 1;
    purchaseGenRef.current += 1;
    purchaseLockRef.current = false;
    clearEpaySession();
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
    setEpayAmountFen(order.amount_total);

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
        clearEpaySession();
        toast.success("支付成功", { description: "时长已到账" });
        await reloadOrders();
        return;
      }
      if (latest.status === "failed" || latest.status === "closed") {
        clearEpaySession();
        throw new Error("支付未完成");
      }
    }
    if (pollTokenRef.current !== pollToken) return;
    clearEpaySession();
    throw new Error("等待支付超时，请稍后在订单中确认");
  }

  async function handlePurchase(plan: RechargePlan) {
    if (purchaseLockRef.current) return;
    if (!user) {
      toast("请登录");
      return;
    }

    const gen = purchaseGenRef.current + 1;
    purchaseGenRef.current = gen;
    purchaseLockRef.current = true;
    setPendingPlanId(plan.id);
    try {
      if (!plan.trial) {
        if (!user.phone) {
          const bound = await requestPhoneBind();
          if (!bound) return;
        }
        if (user.wechat_bound === false) {
          clearEpaySession();
          await startEpay(plan);
          return;
        }
        const channel = await fetchPaymentChannel();
        if (channel !== "epay") {
          void openPurchaseModal();
          return;
        }
        clearEpaySession();
        await startEpay(plan);
        return;
      }

      setUser(await claimTrial());
      toast.success("体验时长已到账");
    } catch (error) {
      clearEpaySession();
      const fallback = plan.trial ? "领取失败" : "开通失败";
      showErrorToast(fallback, errorMessage(error, fallback));
    } finally {
      if (purchaseGenRef.current === gen) {
        purchaseLockRef.current = false;
        setPendingPlanId(null);
      }
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-10 py-8">
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-3">
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
                  isDisabled={claimedTrial}
                  isPending={pending}
                  onPress={() => void handlePurchase(plan)}
                >
                  {({ isPending: loading }) => (
                    <>
                      {loading ? <Spinner color="current" size="sm" /> : null}
                      {claimedTrial
                        ? "已领取"
                        : plan.trial
                          ? loading
                            ? "领取中"
                            : "领取"
                          : "购买"}
                    </>
                  )}
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
            isDisabled={redeeming}
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
        isOpen={epayQr != null}
        onOpenChange={(open) => {
          if (!open) cancelEpay();
        }}
      >
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{epayPlanTitle || "微信支付"}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col items-center gap-4 text-center">
              <div className="flex flex-col items-center gap-1">
                <Description>付款金额</Description>
                <p className="text-3xl font-semibold tracking-tight">
                  {epayAmountFen == null ? "—" : formatAmount(epayAmountFen)}
                </p>
              </div>
              <div className="rounded-md bg-white p-3">
                {epayQr ? (
                  <QRCodeSVG value={epayQr} size={200} level="M" includeMargin />
                ) : null}
              </div>
              <Description className="text-center">
                请使用微信扫一扫完成支付
              </Description>
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="outline">
                取消支付
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

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
