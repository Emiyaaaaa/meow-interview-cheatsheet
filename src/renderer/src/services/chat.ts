import OpenAI, { APIError, APIUserAbortError } from "openai";
import type { ResponseCreateParams } from "openai/resources/responses/responses";
import { getSessionToken } from "../../../shared/session";
import { CHAT_BASE_URL, DEFAULT_CHAT_MODEL } from "./config";

const CHAT_CHECK_TIMEOUT_MS = 8_000;

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  model: string;
  onDelta?: (text: string) => void;
  previousResponseId?: string;
  signal?: AbortSignal;
  store?: boolean;
  stream?: boolean;
}

export interface ChatResult {
  content: string;
  responseId: string;
}

export class ChatRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ChatRequestError";
    this.status = status;
  }
}

function getClient() {
  return new OpenAI({
    apiKey: getSessionToken() || "missing",
    baseURL: CHAT_BASE_URL,
    dangerouslyAllowBrowser: true,
  });
}

export async function chat(
  messages: ChatMessage[],
  options: ChatOptions,
): Promise<ChatResult> {
  const result =
    options.stream === false
      ? await createResponse(messages, options)
      : await streamResponse(messages, options);

  if (!result.content) {
    throw new ChatRequestError("模型未返回有效内容", 200);
  }
  return result;
}

export async function checkChatConnection(model = DEFAULT_CHAT_MODEL) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    CHAT_CHECK_TIMEOUT_MS,
  );

  try {
    await chat([{ role: "user", content: "hi" }], {
      model,
      signal: controller.signal,
      stream: false,
    });
  } catch (error) {
    if (isChatAbortError(error)) {
      throw new ChatRequestError("对话服务检测超时", 408);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function buildParams(messages: ChatMessage[], options: ChatOptions) {
  const { input, instructions } = toResponseInput(messages);
  // 交叉 Record 是为了容纳 thinking 这类各家自定义字段。
  const params: Omit<ResponseCreateParams, "stream"> & Record<string, unknown> =
    {
      input,
      instructions,
      model: options.model,
      previous_response_id: options.previousResponseId,
      // 续接会话要求上一轮被服务端保存下来。
      store: options.store ?? Boolean(options.previousResponseId),
    };

  if (options.model.toLowerCase().startsWith("doubao")) {
    params.thinking = { type: "disabled" };
  }

  return params;
}

async function createResponse(
  messages: ChatMessage[],
  options: ChatOptions,
): Promise<ChatResult> {
  const client = getClient();

  try {
    const response = await client.responses.create(
      { ...buildParams(messages, options), stream: false },
      { signal: options.signal },
    );
    const content = (response.output_text ?? "").trim();
    options.onDelta?.(content);
    return { content, responseId: response.id };
  } catch (error) {
    throw toChatError(error);
  }
}

async function streamResponse(
  messages: ChatMessage[],
  options: ChatOptions,
): Promise<ChatResult> {
  const client = getClient();
  let content = "";
  let responseId = "";

  try {
    const stream = await client.responses.create(
      { ...buildParams(messages, options), stream: true },
      { signal: options.signal },
    );

    for await (const event of stream) {
      if (event.type === "response.created") {
        responseId = event.response.id;
        continue;
      }
      if (event.type === "response.output_text.delta") {
        content += event.delta;
        options.onDelta?.(content);
        continue;
      }
      if (event.type === "response.completed") {
        responseId = event.response.id;
        continue;
      }
      if (
        event.type === "response.failed" ||
        event.type === "response.incomplete"
      ) {
        throw new ChatRequestError(
          event.response.error?.message || "模型生成失败",
          200,
        );
      }
      if (event.type === "error") {
        throw new ChatRequestError(event.message || "模型生成失败", 200);
      }
    }
  } catch (error) {
    throw toChatError(error);
  }

  return { content: content.trim(), responseId };
}

function toResponseInput(messages: ChatMessage[]) {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n");

  const input = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      content: message.content,
      role: message.role,
    }));

  return {
    input:
      input.length === 1 && input[0].role === "user" ? input[0].content : input,
    instructions: instructions || undefined,
  };
}

export function isChatAbortError(error: unknown) {
  return (
    error instanceof APIUserAbortError ||
    (error instanceof Error &&
      (error.name === "AbortError" || /abort/i.test(error.message)))
  );
}

function toChatError(error: unknown) {
  if (error instanceof ChatRequestError || isChatAbortError(error)) {
    return error;
  }
  if (error instanceof APIError) {
    return new ChatRequestError(
      error.message || `chat error: ${error.status ?? 0}`,
      error.status ?? 0,
    );
  }
  return error instanceof Error
    ? new ChatRequestError(error.message, 0)
    : new ChatRequestError("对话服务请求失败", 0);
}
