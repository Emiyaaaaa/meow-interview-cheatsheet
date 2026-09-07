/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEBUG?: string;
  readonly VITE_SERVICE_URL?: string;
  readonly VITE_AI_SERVICE_URL?: string;
  readonly VITE_ASR_PROVIDER?: string;
  readonly VITE_CHAT_MODEL?: string;
}
