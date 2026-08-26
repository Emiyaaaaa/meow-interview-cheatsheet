const DEFAULT_CHAT_MODEL = "qwen-plus";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
}

export interface ChatCompletionChoice {
  finish_reason: string | null;
  index: number;
  message: ChatMessage;
}

export interface ChatCompletionUsage {
  completion_tokens: number;
  prompt_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  choices: ChatCompletionChoice[];
  created?: number;
  id?: string;
  model: string;
  object?: string;
  usage?: ChatCompletionUsage;
}

interface ChatErrorBody {
  Code?: string;
  Message?: string;
  error?: {
    code?: string;
    message?: string;
    type?: string;
  };
  message?: string;
}

export class ChatRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ChatRequestError";
    this.status = status;
  }
}

export async function createChatCompletion(
  request: ChatCompletionRequest,
  options?: { signal?: AbortSignal },
): Promise<ChatCompletionResponse> {
  const requestId = crypto.randomUUID();
  const signal = options?.signal;
  const abort = () => window.desktop.abortChatCompletions(requestId);

  if (signal?.aborted) {
    abort();
    throw new DOMException("Aborted", "AbortError");
  }

  signal?.addEventListener("abort", abort, { once: true });

  try {
    const response = await window.desktop.chatCompletions(requestId, {
      model: request.model ?? DEFAULT_CHAT_MODEL,
      stream: false,
      messages: request.messages,
    });

    if (!response.ok) {
      throw new ChatRequestError(
        readErrorMessage(response.body, response.status),
        response.status,
      );
    }

    try {
      return JSON.parse(response.body) as ChatCompletionResponse;
    } catch {
      throw new ChatRequestError(
        "对话服务返回了无法解析的内容",
        response.status,
      );
    }
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export async function chat(
  messages: ChatMessage[],
  options?: { model?: string; signal?: AbortSignal },
) {
  const completion = await createChatCompletion(
    {
      messages,
      model: options?.model,
    },
    { signal: options?.signal },
  );
  const content = completion.choices[0]?.message.content?.trim();
  if (!content) {
    throw new ChatRequestError("模型未返回有效内容", 200);
  }
  return content;
}

const CHAT_CHECK_TIMEOUT_MS = 8_000;

export async function checkChatConnection() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    CHAT_CHECK_TIMEOUT_MS,
  );

  try {
    const completion = await createChatCompletion(
      {
        messages: [{ role: "user", content: "ping" }],
      },
      { signal: controller.signal },
    );
    if (!completion.choices?.length && !completion.id && !completion.model) {
      throw new ChatRequestError("对话服务未返回有效结果", 200);
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw new ChatRequestError("对话服务检测超时", 408);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /abort/i.test(error.message))
  );
}

function readErrorMessage(bodyText: string, status: number) {
  try {
    const body = JSON.parse(bodyText) as ChatErrorBody;
    return (
      body.error?.message ||
      body.Message ||
      body.message ||
      `chat error: ${status}`
    );
  } catch {
    return `chat error: ${bodyText || status}`;
  }
}
