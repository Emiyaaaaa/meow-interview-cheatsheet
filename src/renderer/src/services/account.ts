import { SERVICE_URL } from "./config";
import {
  authHeaders,
  clearSessionToken,
  getSessionToken,
  setSessionToken,
} from "../../../shared/session";

export interface AccountUser {
  id: string;
  nickname: string | null;
  avatar_url: string | null;
  remaining_seconds: number;
  trial_claimed: boolean;
}

export interface RechargePlan {
  id: string;
  title: string;
  minutes: number;
  price_fen: number;
  regular_fen: number;
  trial: boolean;
}

export interface PaymentOrder {
  id: string;
  out_trade_no: string;
  status: string;
  checkout_url: string;
  amount_total: number;
  minutes: number;
}

export class AccountRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AccountRequestError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = getSessionToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${SERVICE_URL}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw new AccountRequestError("服务返回了无法解析的内容", response.status);
    }
  }
  if (!response.ok) {
    throw new AccountRequestError(readErrorMessage(data, response.status), response.status);
  }
  return data as T;
}

function readErrorMessage(data: unknown, status: number) {
  if (data && typeof data === "object") {
    const record = data as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof record.error === "string" && record.error.trim()) return record.error;
    if (
      record.error &&
      typeof record.error === "object" &&
      record.error.message
    ) {
      return record.error.message;
    }
    if (record.message) return record.message;
  }
  return `请求失败 (${status})`;
}

export async function startWechatLogin() {
  return request<{ state2: string; start_url: string }>("/auth/start", {
    method: "POST",
  });
}

export async function waitWechatLogin(state2: string) {
  return request<
    | { status: "pending" }
    | { status: "ready"; token: string; user: AccountUser }
    | { status: "error"; message: string }
  >(`/auth/wait?state2=${encodeURIComponent(state2)}`);
}

export async function fetchMe() {
  if (!getSessionToken()) {
    throw new AccountRequestError("请先登录", 401);
  }
  const result = await request<{ user: AccountUser }>("/auth/me");
  return result.user;
}

export async function logoutAccount() {
  try {
    if (getSessionToken()) {
      await request<{ ok: boolean }>("/auth/logout", { method: "POST" });
    }
  } finally {
    clearSessionToken();
  }
}

export function persistSessionToken(token: string) {
  setSessionToken(token);
}

export async function fetchPlans() {
  const result = await request<{ plans: RechargePlan[] }>("/plans");
  return result.plans;
}

export async function claimTrial() {
  const result = await request<{ user: AccountUser }>("/trial", {
    method: "POST",
    body: "{}",
  });
  return result.user;
}

export async function createPaymentOrder(planId: string) {
  return request<PaymentOrder>("/orders", {
    method: "POST",
    body: JSON.stringify({ plan_id: planId }),
  });
}

export async function fetchOrder(orderId: string) {
  const result = await request<{ order: { id: string; status: string } }>(
    `/orders/${encodeURIComponent(orderId)}`,
  );
  return result.order;
}

export interface AccountOrder {
  id: string;
  out_trade_no: string;
  description: string;
  amount_total: number;
  minutes: number;
  status: string;
  created_at: string;
  paid_at: string | null;
  order_type?: "payment" | "activation_code";
  activation_code?: string | null;
}

export async function fetchOrders() {
  const result = await request<{ orders: AccountOrder[] }>("/orders");
  return result.orders;
}

export async function redeemActivationCode(code: string) {
  const result = await request<{ order: AccountOrder; user: AccountUser }>(
    "/activation-codes/redeem",
    {
      method: "POST",
      body: JSON.stringify({ code }),
    },
  );
  return result;
}

export async function applyRefund(orderId: string, reason: string, contact: string) {
  const result = await request<{ order: AccountOrder }>(
    `/orders/${encodeURIComponent(orderId)}/refund`,
    {
      method: "POST",
      body: JSON.stringify({
        reason,
        contact: contact.trim() || undefined,
      }),
    },
  );
  return result.order;
}

export async function sendUsageHeartbeat(seconds: number) {
  return request<{ deducted_seconds: number; remaining_seconds: number }>(
    "/usage/heartbeat",
    {
      method: "POST",
      body: JSON.stringify({ seconds }),
    },
  );
}

export { authHeaders, getSessionToken };
