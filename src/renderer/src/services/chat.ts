import OpenAI, { APIError, APIUserAbortError } from "openai";
import type {
  EasyInputMessage,
  ResponseCreateParams,
  ResponseInput,
} from "openai/resources/responses/responses";
import { getSessionToken } from "../../../shared/session";
import { CHAT_BASE_URL } from "./config";

const CHAT_CHECK_TIMEOUT_MS = 8_000;

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  fileId?: string;
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

export async function checkChatConnection() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    CHAT_CHECK_TIMEOUT_MS,
  );

  try {
    await requestHealth("/health/chat", controller.signal, "对话服务检测失败");
  } catch (error) {
    if (isChatAbortError(error)) {
      throw new ChatRequestError("对话服务检测超时", 408);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function requestHealth(
  path: string,
  signal: AbortSignal,
  fallback: string,
) {
  const response = await fetch(`${CHAT_BASE_URL}${path}`, { signal });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw new ChatRequestError("服务返回了无法解析的内容", response.status);
    }
  }
  if (!response.ok) {
    throw new ChatRequestError(
      readHealthError(data, fallback),
      response.status,
    );
  }
}

function readHealthError(data: unknown, fallback: string) {
  if (data && typeof data === "object") {
    const record = data as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error;
    }
    if (
      record.error &&
      typeof record.error === "object" &&
      record.error.message?.trim()
    ) {
      return record.error.message;
    }
    if (record.message?.trim()) return record.message;
  }
  return fallback;
}

function buildParams(messages: ChatMessage[], options: ChatOptions) {
  const { input, instructions } = toResponseInput(messages, options.fileId);
  // 交叉 Record 是为了容纳 thinking 这类各家自定义字段。
  const params: Omit<ResponseCreateParams, "stream"> & Record<string, unknown> =
    {
      input,
      instructions,
      model: options.model,
      // 续接会话要求每一轮都被服务端保存，否则无法传 previous_response_id。
      store: options.store ?? true,
    };

  const previousResponseId = options.previousResponseId?.trim();
  if (previousResponseId) {
    params.previous_response_id = previousResponseId;
  }

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

function toResponseInput(
  messages: ChatMessage[],
  fileId?: string,
): { input: string | ResponseInput; instructions?: string } {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n");

  const attachedFileId = fileId?.trim();
  let fileAttached = false;
  const input: EasyInputMessage[] = messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      if (message.role === "user" && attachedFileId && !fileAttached) {
        fileAttached = true;
        return {
          role: "user" as const,
          content: [
            { type: "input_file" as const, file_id: attachedFileId },
            { type: "input_text" as const, text: message.content },
          ],
        };
      }
      return {
        content: message.content,
        role: message.role,
      };
    });

  if (
    !attachedFileId &&
    input.length === 1 &&
    input[0]?.role === "user" &&
    typeof input[0].content === "string"
  ) {
    return {
      input: input[0].content,
      instructions: instructions || undefined,
    };
  }

  return {
    input,
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
