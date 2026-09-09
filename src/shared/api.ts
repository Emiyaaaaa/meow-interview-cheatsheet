function trimUrl(value: string | undefined, fallback: string) {
  return (value?.trim() || fallback).replace(/\/$/, "");
}

/** 登录、支付、用量等账号服务 */
export const SERVICE_URL = trimUrl(
  import.meta.env.VITE_SERVICE_URL,
  "http://localhost:3000",
);

/** ASR、Chat、文件上传；未配置时回退到账号服务地址 */
export const AI_SERVICE_URL = trimUrl(
  import.meta.env.VITE_AI_SERVICE_URL,
  SERVICE_URL,
);

export const AI_SERVICE_WS_URL = AI_SERVICE_URL.replace(/^http/i, "ws");

export const ARKASR_WS_URL = `${AI_SERVICE_WS_URL}/ark-openspeech/api/v3/sauc/bigmodel_async`;

export const FUNASR_WS_URL = `${AI_SERVICE_WS_URL}/qwen-asr/api-ws/v1/inference`;

export const FILES_URL = `${AI_SERVICE_URL}/ark/api/v3/files`;

export const DEFAULT_CHAT_MODEL =
  import.meta.env.VITE_CHAT_MODEL?.trim() || "doubao-seed-2-1-pro-260628";

/** OpenAI SDK 会请求 `{CHAT_BASE_URL}/responses`，由服务端按模型名转发到真正的上游。 */
export const CHAT_BASE_URL = AI_SERVICE_URL;
