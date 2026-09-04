const serviceUrl =
  import.meta.env.VITE_SERVICE_URL?.trim() || "http://localhost:3000";

export const SERVICE_URL = serviceUrl.replace(/\/$/, "");

export const SERVICE_WS_URL = SERVICE_URL.replace(/^http/i, "ws");

export const ARKASR_WS_URL = `${SERVICE_WS_URL}/ark-openspeech/api/v3/sauc/bigmodel_async`;

export const FUNASR_WS_URL = `${SERVICE_WS_URL}/qwen-asr/api-ws/v1/inference`;

export const FILES_URL = `${SERVICE_URL}/api/v3/files`;

export const DEFAULT_CHAT_MODEL =
  import.meta.env.VITE_CHAT_MODEL?.trim() || "doubao-seed-2-1-pro-260628";

/** OpenAI SDK 会请求 `{CHAT_BASE_URL}/responses`，由服务端按模型名转发到真正的上游。 */
export const CHAT_BASE_URL = SERVICE_URL;
