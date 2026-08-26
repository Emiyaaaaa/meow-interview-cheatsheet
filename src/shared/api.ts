const host = import.meta.env.VITE_API_HOST?.trim();

if (!host) {
  throw new Error("缺少 VITE_API_HOST，请在项目根目录的 .env 中配置网关地址");
}

export const API_HOST = host;

export const API_BASE_URL = `https://${API_HOST}`;

export const ASR_WS_URL = `wss://${API_HOST}/api-ws/v1/inference`;

export const CHAT_COMPLETIONS_URL = `${API_BASE_URL}/v1/chat/completions`;
