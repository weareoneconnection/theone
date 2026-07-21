// TheOne Agent Engine — self-hosted coding agent loop (OneClaw runtime port).
// Tool schemas deliberately mirror Claude Code's observable tool behavior
// (Read/Edit/Bash/Grep-Glob) so the model's training priors apply directly.

export type ToolName = "read_file" | "edit_file" | "bash" | "search" | "write_file" | "multi_edit" | "web_fetch" | "read_image";

export type ToolCall = {
  id: string;
  name: ToolName;
  input: Record<string, unknown>;
};

export type ToolImage = { mediaType: string; data: string };

export type ToolResult = {
  toolCallId: string;
  ok: boolean;
  output: string;
  // Vision: images returned to the model as base64 blocks (e.g. a screenshot
  // the agent read to debug UI). Sent as image content in the tool_result.
  images?: ToolImage[];
};

export type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls: ToolCall[] }
  | { role: "tool"; results: ToolResult[] };

export type AgentEvent = {
  type: "turn" | "tool_call" | "tool_result" | "text" | "compaction" | "done" | "error";
  at: string;
  detail: string;
};

export type AgentRunStatus = "completed" | "max_turns" | "budget_exceeded" | "aborted" | "error";

export type AgentUsage = {
  inputTokens: number;
  outputTokens: number;
  llmCalls: number;
  // Prompt-caching split: reads are ~10x cheaper than fresh input tokens.
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

export type AgentRunResult = {
  status: AgentRunStatus;
  summary: string;
  turns: number;
  toolCalls: number;
  editedFiles: string[];
  commands: string[];
  events: AgentEvent[];
  usage: AgentUsage;
  // Detached git commit recording the pre-run tree; null when the workspace
  // is not a git repository or snapshotting was disabled.
  snapshotCommit: string | null;
  // Soft verification gate: true only when the run completed AND at least one
  // verification-looking command (test/lint/build/typecheck) was executed.
  verified: boolean;
  // PR-only delivery outcome, present when the run was asked to deliver.
  delivery?: AgentDelivery;
  error?: string;
};

export type AgentDelivery = {
  attempted: boolean;
  ok: boolean;
  branch?: string;
  prUrl?: string;
  commit?: string;
  message: string;
};

export type AgentTask = {
  objective: string;
  workspace: string;
  maxTurns?: number;
  maxToolCalls?: number;
  model?: string;
  // When true, the workspace is snapshotted with git before the run so every
  // change can be rolled back.
  snapshot?: boolean;
  // Summary of the previous agent session in this workspace, injected into
  // the system prompt so follow-up tasks skip cold-start exploration.
  priorContext?: string;
  // Aborting mid-run returns status 'aborted'; the workspace keeps whatever
  // edits were already applied (snapshot commit still allows rollback).
  signal?: AbortSignal;
  // Called after each event is recorded — lets the runtime stream progress.
  onEvent?: (event: AgentEvent) => void;
  // PR-only auto-delivery: after a verified run, commit onto a fresh
  // theone-agent/* branch, push it, and open a pull request. Never pushes a
  // protected branch and never merges — merging stays a human action.
  deliver?: boolean;
  // Plan mode: the agent explores and returns a step-by-step plan without
  // changing any files. Nothing is delivered. Run again without it to execute.
  planOnly?: boolean;
};

export type AgentSessionState = {
  workspace: string;
  // Claude Code parity: a file must be read before it may be edited.
  readFiles: Set<string>;
  editedFiles: Set<string>;
  commands: string[];
  // Plan mode: exploration only. Mutating tools are refused so the run
  // produces a plan the user approves before anything changes.
  planMode?: boolean;
};

export type LLMResponse = {
  text: string;
  toolCalls: ToolCall[];
  stopReason: "tool_use" | "end_turn" | "max_tokens" | "error";
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
};

export type LLMClient = (input: {
  system: string;
  messages: AgentMessage[];
  model: string;
  signal?: AbortSignal;
}) => Promise<LLMResponse>;

// TheOne governance contract: one receipt per agent run, returned to the
// control plane as proof of what happened (proofPolicy.receiptRequired).
export type AgentReceipt = {
  schemaVersion: "theone.agent_receipt.v1";
  status: AgentRunStatus;
  summary: string;
  turns: number;
  toolCalls: number;
  editedFiles: string[];
  commands: string[];
  usage: AgentUsage;
  snapshotCommit: string | null;
  verified: boolean;
  diffStat: string;
  diff: string;
  delivery?: AgentDelivery;
  startedAt: string;
  finishedAt: string;
};
