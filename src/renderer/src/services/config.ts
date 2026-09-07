export {
  AI_SERVICE_URL,
  ARKASR_WS_URL,
  FUNASR_WS_URL,
  CHAT_BASE_URL,
  DEFAULT_CHAT_MODEL,
  FILES_URL,
  SERVICE_URL,
} from "../../../shared/api";

export const IS_DEBUG = /^(1|true|yes)$/i.test(
  String(import.meta.env.DEBUG ?? "").trim(),
);
