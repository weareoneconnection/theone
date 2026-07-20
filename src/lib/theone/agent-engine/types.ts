// TheOne Agent Engine — self-hosted coding agent loop.
// Tool schemas deliberately mirror Claude Code's observable tool behavior
// (Read/Edit/Bash/Grep-Glob) so the model's training priors apply directly.

export type ToolName = 'read_file' | 'edit_file' | 'bash' | 'search';

export type ToolCall = {
  id: string;
  name: ToolName;
  input: Record<string, unknown>;
};

export type ToolResult = {
  toolCallId: string;
  ok: boolean;
  output: string;
};

export type AgentMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls: ToolCall[] }
  | { role: 'tool'; results: ToolResult[] };

export type AgentEvent = {
  type: 'turn' | 'tool_call' | 'tool_result' | 'text' | 'compaction' | 'done' | 'error';
  at: string;
  detail: string;
};

export type AgentRunStatus = 'completed' | 'max_turns' | 'budget_exceeded' | 'aborted' | 'error';

export type AgentUsage = {
  inputTokens: number;
  outputTokens: number;
  llmCalls: number;
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
  error?: string;
};

// TheOne governance contract: one receipt per agent run, returned to the
// control plane as proof of what happened (proofPolicy.receiptRequired).
export type AgentReceipt = {
  schemaVersion: 'theone.agent_receipt.v1';
  status: AgentRunStatus;
  summary: string;
  turns: number;
  toolCalls: number;
  editedFiles: string[];
  commands: string[];
  usage: AgentUsage;
  snapshotCommit: string | null;
  diffStat: string;
  diff: string;
  startedAt: string;
  finishedAt: string;
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
};

export type AgentSessionState = {
  workspace: string;
  // Claude Code parity: a file must be read before it may be edited.
  readFiles: Set<string>;
  editedFiles: Set<string>;
  commands: string[];
};

export type LLMResponse = {
  text: string;
  toolCalls: ToolCall[];
  stopReason: 'tool_use' | 'end_turn' | 'max_tokens' | 'error';
  usage: { inputTokens: number; outputTokens: number };
};

export type LLMClient = (input: {
  system: string;
  messages: AgentMessage[];
  model: string;
}) => Promise<LLMResponse>;
