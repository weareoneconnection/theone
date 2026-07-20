import { anthropicLLMClient, getAgentEngineConfig } from './llm-client';
import { buildSystemPrompt } from './system-prompt';
import { executeTool } from './tools';
import { diffAgainstSnapshot, snapshotWorkspace } from './workspace';
import type {
  AgentEvent,
  AgentMessage,
  AgentReceipt,
  AgentRunResult,
  AgentSessionState,
  AgentTask,
  LLMClient,
} from './types';

const DEFAULT_MAX_TURNS = 50;
const DEFAULT_MAX_TOOL_CALLS = 200;
// History budget before compaction, in characters (~50k tokens).
const HISTORY_CHAR_BUDGET = 200_000;
const COMPACTED_PLACEHOLDER = '[result compacted — re-run the tool if you need this output again]';

// Soft verification gate: commands that count as "the agent verified its work".
const VERIFICATION_COMMAND =
  /\b(tests?|vitest|jest|pytest|tsc|typecheck|type-check|lint|eslint|build|check|cargo\s+(test|check)|go\s+test|mvn\s+(test|verify)|gradle\s+(test|check))\b/i;

function now() {
  return new Date().toISOString();
}

// Deterministic compaction: replace the oldest tool outputs with placeholders
// until the history fits the budget. Task objective and recent turns survive.
export function compactHistory(messages: AgentMessage[]): { messages: AgentMessage[]; compacted: number } {
  const size = (items: AgentMessage[]) => items.reduce((total, message) => {
    if (message.role === 'tool') return total + message.results.reduce((s, r) => s + r.output.length, 0);
    if (message.role === 'assistant') return total + message.content.length;
    return total + message.content.length;
  }, 0);

  if (size(messages) <= HISTORY_CHAR_BUDGET) return { messages, compacted: 0 };

  let compacted = 0;
  const result = [...messages];
  // Never compact the last 6 messages — the model needs recent context intact.
  for (let index = 0; index < result.length - 6 && size(result) > HISTORY_CHAR_BUDGET; index += 1) {
    const message = result[index];
    if (message.role === 'tool') {
      const shrunk = message.results.map((r) =>
        r.output.length > 500 ? { ...r, output: COMPACTED_PLACEHOLDER } : r,
      );
      if (shrunk.some((r, i) => r.output !== message.results[i].output)) {
        result[index] = { role: 'tool', results: shrunk };
        compacted += 1;
      }
    }
  }
  return { messages: result, compacted };
}

export async function runAgentTask(
  task: AgentTask,
  llmClient: LLMClient = anthropicLLMClient,
): Promise<AgentRunResult> {
  const config = getAgentEngineConfig();
  const model = task.model || config.model;
  const maxTurns = Math.max(1, Math.min(task.maxTurns || DEFAULT_MAX_TURNS, 200));
  const maxToolCalls = Math.max(1, Math.min(task.maxToolCalls || DEFAULT_MAX_TOOL_CALLS, 1000));

  const state: AgentSessionState = {
    workspace: task.workspace,
    readFiles: new Set(),
    editedFiles: new Set(),
    commands: [],
  };

  const events: AgentEvent[] = [];
  const log = (type: AgentEvent['type'], detail: string) => {
    const event: AgentEvent = { type, at: now(), detail };
    events.push(event);
    try {
      task.onEvent?.(event);
    } catch {
      // A broken event sink must never take the run down.
    }
  };

  let snapshotCommit: string | null = null;
  if (task.snapshot !== false) {
    snapshotCommit = await snapshotWorkspace(task.workspace);
    log('turn', snapshotCommit ? `Workspace snapshot: ${snapshotCommit.slice(0, 12)}` : 'Workspace snapshot unavailable (not a git repo)');
  }

  const system = buildSystemPrompt({
    workspace: task.workspace,
    objective: task.objective,
    priorContext: task.priorContext,
  });
  let messages: AgentMessage[] = [{ role: 'user', content: task.objective }];
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    llmCalls: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
  let toolCallCount = 0;
  let turns = 0;
  let finalText = '';

  const ranVerification = () => state.commands.some((command) => VERIFICATION_COMMAND.test(command));

  const finish = (partial: Pick<AgentRunResult, 'status' | 'summary'> & { error?: string }): AgentRunResult => ({
    ...partial,
    turns,
    toolCalls: toolCallCount,
    editedFiles: Array.from(state.editedFiles),
    commands: state.commands,
    events,
    usage,
    snapshotCommit,
    verified: partial.status === 'completed' && ranVerification(),
  });

  const aborted = () => {
    log('error', 'Run aborted by user request.');
    return finish({ status: 'aborted', summary: 'Aborted by user request. Workspace keeps the edits applied so far; use the snapshot commit to roll back.' });
  };

  try {
    while (turns < maxTurns) {
      if (task.signal?.aborted) return aborted();
      turns += 1;

      const compaction = compactHistory(messages);
      messages = compaction.messages;
      if (compaction.compacted > 0) log('compaction', `Compacted ${compaction.compacted} old tool result(s).`);

      const response = await llmClient({ system, messages, model, signal: task.signal });
      usage.inputTokens += response.usage.inputTokens;
      usage.outputTokens += response.usage.outputTokens;
      usage.llmCalls += 1;
      usage.cacheCreationInputTokens += response.usage.cacheCreationInputTokens || 0;
      usage.cacheReadInputTokens += response.usage.cacheReadInputTokens || 0;

      if (response.stopReason === 'error') {
        return finish({
          status: 'error',
          summary: 'LLM client is not configured (ANTHROPIC_API_KEY missing) or returned an error.',
          error: 'llm_unavailable',
        });
      }

      messages.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls });
      if (response.text) log('text', response.text.slice(0, 500));

      // No tool calls → the agent is done.
      if (response.toolCalls.length === 0) {
        finalText = response.text;
        log('done', 'Agent finished without further tool calls.');
        break;
      }

      if (toolCallCount + response.toolCalls.length > maxToolCalls) {
        return finish({
          status: 'budget_exceeded',
          summary: `Stopped after ${toolCallCount} tool calls (limit ${maxToolCalls}). Last progress: ${response.text.slice(0, 300)}`,
        });
      }

      const results = [];
      for (const call of response.toolCalls) {
        if (task.signal?.aborted) return aborted();
        toolCallCount += 1;
        log('tool_call', `${call.name}(${JSON.stringify(call.input).slice(0, 200)})`);
        const result = await executeTool(state, call);
        log('tool_result', `${result.ok ? 'ok' : 'error'}: ${result.output.slice(0, 200)}`);
        results.push(result);
      }
      messages.push({ role: 'tool', results });
    }

    if (!finalText && turns >= maxTurns) {
      return finish({
        status: 'max_turns',
        summary: `Stopped after ${maxTurns} turns without completing.`,
      });
    }

    const completedRun = finish({
      status: 'completed',
      summary: finalText || 'Task completed.',
    });
    if (!completedRun.verified) {
      log('done', 'Verification gate: no test/lint/build/typecheck command was run — receipt marked unverified.');
    }
    return completedRun;
  } catch (error) {
    log('error', error instanceof Error ? error.message : String(error));
    return finish({
      status: 'error',
      summary: `Agent run failed: ${error instanceof Error ? error.message : String(error)}`,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// One receipt per run — the proof object TheOne's control plane stores
// (diff + verification commands + token usage for billing).
export async function buildAgentReceipt(
  result: AgentRunResult,
  workspace: string,
  timing: { startedAt: string; finishedAt: string },
): Promise<AgentReceipt> {
  const diff = result.snapshotCommit
    ? await diffAgainstSnapshot(workspace, result.snapshotCommit)
    : { diffStat: '', diff: '' };

  return {
    schemaVersion: 'theone.agent_receipt.v1',
    status: result.status,
    summary: result.summary,
    turns: result.turns,
    toolCalls: result.toolCalls,
    editedFiles: result.editedFiles,
    commands: result.commands,
    usage: result.usage,
    snapshotCommit: result.snapshotCommit,
    verified: result.verified,
    diffStat: diff.diffStat,
    diff: diff.diff,
    startedAt: timing.startedAt,
    finishedAt: timing.finishedAt,
  };
}
