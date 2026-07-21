import { TOOL_DEFINITIONS } from "./tools";
import type { AgentMessage, LLMClient, LLMResponse, ToolCall, ToolName } from "./types";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export function getAgentEngineConfig() {
  return {
    apiKey: String(process.env.ANTHROPIC_API_KEY || "").trim(),
    model: String(process.env.AGENT_ENGINE_MODEL || "claude-sonnet-5").trim(),
    maxTokens: 8192,
  };
}

type CacheControl = { type: "ephemeral" };
const CACHE_CONTROL: CacheControl = { type: "ephemeral" };

type ImageSource = { type: "base64"; media_type: string; data: string };
type ToolResultContent =
  | { type: "text"; text: string }
  | { type: "image"; source: ImageSource };

type AnthropicContentBlock =
  | { type: "text"; text: string; cache_control?: CacheControl }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown>; cache_control?: CacheControl }
  | { type: "tool_result"; tool_use_id: string; content: string | ToolResultContent[]; is_error?: boolean; cache_control?: CacheControl };

type AnthropicMessage = { role: "user" | "assistant"; content: string | AnthropicContentBlock[] };

// Prompt-caching breakpoints: tools and system are stable across the whole
// run; the tail breakpoint moves forward each turn so every request re-reads
// the shared history prefix from cache instead of re-billing it.
const CACHED_TOOLS = TOOL_DEFINITIONS.map((tool, index) =>
  index === TOOL_DEFINITIONS.length - 1 ? { ...tool, cache_control: CACHE_CONTROL } : tool
);

function withTailCacheBreakpoint(messages: AnthropicMessage[]): AnthropicMessage[] {
  if (!messages.length) return messages;
  const last = messages[messages.length - 1];
  const content: AnthropicContentBlock[] = typeof last.content === "string"
    ? [{ type: "text", text: last.content }]
    : last.content.map((block) => ({ ...block }));
  if (!content.length) return messages;
  content[content.length - 1] = { ...content[content.length - 1], cache_control: CACHE_CONTROL };
  return [...messages.slice(0, -1), { ...last, content }];
}

// Convert engine history into Anthropic message format. Tool results become
// user-role tool_result blocks, per the Messages API contract.
function toAnthropicMessages(messages: AgentMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
    } else if (message.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      if (message.content) blocks.push({ type: "text", text: message.content });
      for (const call of message.toolCalls) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      out.push({ role: "assistant", content: blocks.length > 0 ? blocks : [{ type: "text", text: "(empty)" }] });
    } else {
      out.push({
        role: "user",
        content: message.results.map((result) => ({
          type: "tool_result" as const,
          tool_use_id: result.toolCallId,
          // Attach any images as vision blocks alongside the text output.
          content: result.images?.length
            ? [
                { type: "text" as const, text: result.output },
                ...result.images.map((image) => ({
                  type: "image" as const,
                  source: { type: "base64" as const, media_type: image.mediaType, data: image.data },
                })),
              ]
            : result.output,
          ...(result.ok ? {} : { is_error: true }),
        })),
      });
    }
  }
  return out;
}

export const anthropicLLMClient: LLMClient = async ({ system, messages, model, signal }): Promise<LLMResponse> => {
  const { apiKey, maxTokens } = getAgentEngineConfig();
  if (!apiKey) {
    return {
      text: "",
      toolCalls: [],
      stopReason: "error",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": API_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: [{ type: "text", text: system, cache_control: CACHE_CONTROL }],
      tools: CACHED_TOOLS,
      messages: withTailCacheBreakpoint(toAnthropicMessages(messages)),
    }),
    signal: signal ? AbortSignal.any([AbortSignal.timeout(300_000), signal]) : AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 500)}`);
  }

  const json = await res.json() as {
    content?: AnthropicContentBlock[];
    stop_reason?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };

  const text = (json.content || [])
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  const toolCalls: ToolCall[] = (json.content || [])
    .filter((block): block is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } => block.type === "tool_use")
    .map((block) => ({ id: block.id, name: block.name as ToolName, input: block.input || {} }));

  return {
    text,
    toolCalls,
    stopReason: json.stop_reason === "tool_use" ? "tool_use"
      : json.stop_reason === "max_tokens" ? "max_tokens"
        : "end_turn",
    usage: {
      inputTokens: json.usage?.input_tokens || 0,
      outputTokens: json.usage?.output_tokens || 0,
      cacheCreationInputTokens: json.usage?.cache_creation_input_tokens || 0,
      cacheReadInputTokens: json.usage?.cache_read_input_tokens || 0,
    },
  };
};
