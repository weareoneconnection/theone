import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeTool } from '@/lib/theone/agent-engine/tools';
import { runAgentTask, compactHistory, buildAgentReceipt } from '@/lib/theone/agent-engine/loop';
import { resolveWorkspacePath } from '@/lib/theone/agent-engine/workspace';
import type { AgentMessage, AgentSessionState, LLMClient, LLMResponse } from '@/lib/theone/agent-engine/types';

let workspace: string;
let state: AgentSessionState;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-engine-test-'));
  state = { workspace, readFiles: new Set(), editedFiles: new Set(), commands: [] };
});

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

const call = (name: string, input: Record<string, unknown>) =>
  executeTool(state, { id: `t_${Math.random().toString(36).slice(2)}`, name: name as never, input });

describe('workspace confinement', () => {
  it('rejects paths escaping the workspace', () => {
    expect(() => resolveWorkspacePath(workspace, '../../etc/passwd')).toThrow(/escapes/);
    expect(() => resolveWorkspacePath(workspace, 'src/ok.ts')).not.toThrow();
  });
});

describe('read_file', () => {
  it('returns numbered lines and respects offset/limit', async () => {
    await fs.writeFile(path.join(workspace, 'a.txt'), 'one\ntwo\nthree\nfour\n');
    const result = await call('read_file', { file_path: 'a.txt', offset: 2, limit: 2 });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('2\ttwo');
    expect(result.output).toContain('3\tthree');
    expect(result.output).not.toContain('one');
  });

  it('errors on missing files', async () => {
    const result = await call('read_file', { file_path: 'missing.txt' });
    expect(result.ok).toBe(false);
  });
});

describe('edit_file', () => {
  it('requires read before edit', async () => {
    await fs.writeFile(path.join(workspace, 'b.txt'), 'hello world');
    const result = await call('edit_file', { file_path: 'b.txt', old_string: 'hello', new_string: 'goodbye' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('read');
  });

  it('performs exact unique replacement after read', async () => {
    await fs.writeFile(path.join(workspace, 'b.txt'), 'hello world');
    await call('read_file', { file_path: 'b.txt' });
    const result = await call('edit_file', { file_path: 'b.txt', old_string: 'hello', new_string: 'goodbye' });
    expect(result.ok).toBe(true);
    expect(await fs.readFile(path.join(workspace, 'b.txt'), 'utf8')).toBe('goodbye world');
  });

  it('rejects ambiguous matches and suggests replace_all', async () => {
    await fs.writeFile(path.join(workspace, 'c.txt'), 'aaa bbb aaa');
    await call('read_file', { file_path: 'c.txt' });
    const result = await call('edit_file', { file_path: 'c.txt', old_string: 'aaa', new_string: 'x' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('2 locations');
  });

  it('replace_all replaces every occurrence', async () => {
    await fs.writeFile(path.join(workspace, 'c.txt'), 'aaa bbb aaa');
    await call('read_file', { file_path: 'c.txt' });
    const result = await call('edit_file', { file_path: 'c.txt', old_string: 'aaa', new_string: 'x', replace_all: true });
    expect(result.ok).toBe(true);
    expect(await fs.readFile(path.join(workspace, 'c.txt'), 'utf8')).toBe('x bbb x');
  });

  it('creates a new file with empty old_string', async () => {
    const result = await call('edit_file', { file_path: 'new/dir/d.txt', old_string: '', new_string: 'content' });
    expect(result.ok).toBe(true);
    expect(await fs.readFile(path.join(workspace, 'new/dir/d.txt'), 'utf8')).toBe('content');
  });

  it('gives a whitespace hint when old_string is close but not exact', async () => {
    await fs.writeFile(path.join(workspace, 'e.txt'), 'function foo() {\n  return 1;\n}');
    await call('read_file', { file_path: 'e.txt' });
    const result = await call('edit_file', { file_path: 'e.txt', old_string: 'function foo() {\n    return 1;\n}', new_string: 'x' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('whitespace');
  });
});

describe('bash', () => {
  it('runs commands in the workspace and returns output', async () => {
    await fs.writeFile(path.join(workspace, 'f.txt'), 'data');
    const result = await call('bash', { command: 'ls' });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('f.txt');
  });

  it('returns failures verbatim with exit code', async () => {
    const result = await call('bash', { command: 'node -e "console.error(\'boom\'); process.exit(2)"' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('exit 2');
    expect(result.output).toContain('boom');
  });
});

describe('search', () => {
  it('grep finds content matches', async () => {
    await fs.writeFile(path.join(workspace, 'g.ts'), 'export function target() {}');
    const result = await call('search', { mode: 'grep', pattern: 'function target' });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('g.ts');
  });

  it('grep reports no matches without erroring', async () => {
    await fs.writeFile(path.join(workspace, 'g.ts'), 'nothing here');
    const result = await call('search', { mode: 'grep', pattern: 'zzz_not_present' });
    expect(result.ok).toBe(true);
    expect(result.output).toBe('No matches.');
  });
});

describe('agent loop', () => {
  const scripted = (responses: LLMResponse[]): LLMClient => {
    let index = 0;
    return async () => responses[Math.min(index++, responses.length - 1)];
  };

  it('executes tool calls then finishes on a text-only response', async () => {
    await fs.writeFile(path.join(workspace, 'target.txt'), 'old value');
    const client = scripted([
      {
        text: 'Reading the file.',
        toolCalls: [{ id: 'c1', name: 'read_file', input: { file_path: 'target.txt' } }],
        stopReason: 'tool_use',
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      {
        text: 'Editing.',
        toolCalls: [{ id: 'c2', name: 'edit_file', input: { file_path: 'target.txt', old_string: 'old value', new_string: 'new value' } }],
        stopReason: 'tool_use',
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      {
        text: 'Done: replaced old value with new value.',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const result = await runAgentTask({ objective: 'Update target.txt', workspace, snapshot: false }, client);

    expect(result.status).toBe('completed');
    expect(result.turns).toBe(3);
    expect(result.toolCalls).toBe(2);
    expect(result.editedFiles).toHaveLength(1);
    expect(await fs.readFile(path.join(workspace, 'target.txt'), 'utf8')).toBe('new value');
    expect(result.usage.inputTokens).toBe(30);
  });

  it('stops at max turns', async () => {
    const client = scripted([{
      text: 'Looping.',
      toolCalls: [{ id: 'c1', name: 'bash', input: { command: 'true' } }],
      stopReason: 'tool_use',
      usage: { inputTokens: 1, outputTokens: 1 },
    }]);

    const result = await runAgentTask({ objective: 'Loop forever', workspace, maxTurns: 3, snapshot: false }, client);
    expect(result.status).toBe('max_turns');
    expect(result.turns).toBe(3);
  });

  it('reports llm_unavailable when the client is unconfigured', async () => {
    const client: LLMClient = async () => ({
      text: '', toolCalls: [], stopReason: 'error', usage: { inputTokens: 0, outputTokens: 0 },
    });
    const result = await runAgentTask({ objective: 'Anything', workspace, snapshot: false }, client);
    expect(result.status).toBe('error');
    expect(result.error).toBe('llm_unavailable');
  });

  it('feeds tool errors back to the model for self-correction', async () => {
    let sawError = false;
    const client: LLMClient = async ({ messages }) => {
      const last = messages[messages.length - 1] as AgentMessage;
      if (last.role === 'tool' && last.results.some((r) => !r.ok)) sawError = true;
      if (messages.length === 1) {
        return {
          text: '',
          toolCalls: [{ id: 'c1', name: 'edit_file', input: { file_path: 'nope.txt', old_string: 'x', new_string: 'y' } }],
          stopReason: 'tool_use',
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      }
      return { text: 'Recovered.', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } };
    };

    const result = await runAgentTask({ objective: 'Trigger error', workspace, snapshot: false }, client);
    expect(result.status).toBe('completed');
    expect(sawError).toBe(true);
  });

  it('marks completed runs unverified when no verification command ran', async () => {
    const client = scripted([
      {
        text: 'Editing without verifying.',
        toolCalls: [{ id: 'c1', name: 'bash', input: { command: 'echo hello' } }],
        stopReason: 'tool_use',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      { text: 'Done.', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    const result = await runAgentTask({ objective: 'No verify', workspace, snapshot: false }, client);
    expect(result.status).toBe('completed');
    expect(result.verified).toBe(false);
  });

  it('marks completed runs verified after a test command', async () => {
    const client = scripted([
      {
        text: 'Verifying.',
        toolCalls: [{ id: 'c1', name: 'bash', input: { command: 'true # npm test placeholder' } }],
        stopReason: 'tool_use',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      { text: 'Done.', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    const result = await runAgentTask({ objective: 'Verify', workspace, snapshot: false }, client);
    expect(result.verified).toBe(true);
  });

  it('aborts when the signal fires', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = scripted([{
      text: 'Should not matter.',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    }]);
    const result = await runAgentTask(
      { objective: 'Abort me', workspace, snapshot: false, signal: controller.signal },
      client,
    );
    expect(result.status).toBe('aborted');
  });

  it('injects prior session context into the system prompt', async () => {
    let seenSystem = '';
    const client: LLMClient = async ({ system }) => {
      seenSystem = system;
      return { text: 'Done.', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } };
    };
    await runAgentTask(
      { objective: 'Follow-up', workspace, snapshot: false, priorContext: 'Outcome (completed): fixed parseAmount' },
      client,
    );
    expect(seenSystem).toContain('# Previous session in this workspace');
    expect(seenSystem).toContain('fixed parseAmount');
  });

  it('streams events through onEvent', async () => {
    const types: string[] = [];
    const client = scripted([
      {
        text: 'Working.',
        toolCalls: [{ id: 'c1', name: 'bash', input: { command: 'echo hi' } }],
        stopReason: 'tool_use',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      { text: 'Done.', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    await runAgentTask(
      { objective: 'Stream', workspace, snapshot: false, onEvent: (event) => types.push(event.type) },
      client,
    );
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types).toContain('done');
  });

  it('plan mode refuses edits and returns a plan without changing files', async () => {
    await fs.writeFile(path.join(workspace, 'target.txt'), 'original');
    let sawBlock = false;
    const client: LLMClient = async ({ messages }) => {
      const last = messages[messages.length - 1] as AgentMessage;
      if (last.role === 'tool' && last.results.some((r) => !r.ok && r.output.includes('plan mode'))) sawBlock = true;
      if (messages.length === 1) {
        return {
          text: 'Trying to edit in plan mode.',
          toolCalls: [{ id: 'c1', name: 'edit_file', input: { file_path: 'target.txt', old_string: 'original', new_string: 'changed' } }],
          stopReason: 'tool_use',
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      }
      return { text: 'Plan: 1. edit target.txt 2. run tests', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } };
    };
    const result = await runAgentTask({ objective: 'Change target', workspace, snapshot: false, planOnly: true }, client);
    expect(result.status).toBe('completed');
    expect(sawBlock).toBe(true);
    expect(result.editedFiles).toHaveLength(0);
    expect(await fs.readFile(path.join(workspace, 'target.txt'), 'utf8')).toBe('original');
    expect(result.summary).toContain('Plan');
  });

  it('counts llm calls in usage', async () => {
    const client = scripted([
      {
        text: 'One tool call.',
        toolCalls: [{ id: 'c1', name: 'bash', input: { command: 'true' } }],
        stopReason: 'tool_use',
        usage: { inputTokens: 5, outputTokens: 5 },
      },
      { text: 'Done.', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 5, outputTokens: 5 } },
    ]);
    const result = await runAgentTask({ objective: 'Count calls', workspace, snapshot: false }, client);
    expect(result.usage.llmCalls).toBe(2);
    expect(result.snapshotCommit).toBeNull();
  });
});

describe('bash secret redaction', () => {
  it('does not expose credential env vars to subprocesses', async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test-secret-value';
    try {
      const result = await call('bash', { command: 'echo "key=[${ANTHROPIC_API_KEY}]"' });
      expect(result.ok).toBe(true);
      expect(result.output).toContain('key=[]');
      expect(result.output).not.toContain('sk-test-secret-value');
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
    }
  });
});

describe('agent receipt', () => {
  const git = async (args: string[]) => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    await promisify(execFile)('git', args, { cwd: workspace });
  };

  it('snapshots a git workspace and captures the diff in the receipt', async () => {
    await git(['init']);
    await git(['config', 'user.email', 'test@test.local']);
    await git(['config', 'user.name', 'test']);
    await fs.writeFile(path.join(workspace, 'target.txt'), 'old value\n');
    await git(['add', '-A']);
    await git(['commit', '-m', 'initial']);

    const client: LLMClient = async ({ messages }) => {
      if (messages.length === 1) {
        return {
          text: 'Reading.',
          toolCalls: [{ id: 'c1', name: 'read_file', input: { file_path: 'target.txt' } }],
          stopReason: 'tool_use',
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      }
      if (messages.length === 3) {
        return {
          text: 'Editing.',
          toolCalls: [{ id: 'c2', name: 'edit_file', input: { file_path: 'target.txt', old_string: 'old value', new_string: 'new value' } }],
          stopReason: 'tool_use',
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      }
      return { text: 'Done.', toolCalls: [], stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } };
    };

    const startedAt = new Date().toISOString();
    const result = await runAgentTask({ objective: 'Update target.txt', workspace }, client);
    expect(result.status).toBe('completed');
    expect(result.snapshotCommit).toMatch(/^[0-9a-f]{40}$/);

    const receipt = await buildAgentReceipt(result, workspace, {
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    expect(receipt.schemaVersion).toBe('theone.agent_receipt.v1');
    expect(receipt.diffStat).toContain('target.txt');
    expect(receipt.diff).toContain('-old value');
    expect(receipt.diff).toContain('+new value');
    expect(receipt.usage.llmCalls).toBe(3);
    expect(receipt.usage.inputTokens).toBe(30);
  });
});

describe('compactHistory', () => {
  it('leaves small histories untouched', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'task' },
      { role: 'tool', results: [{ toolCallId: 'a', ok: true, output: 'short' }] },
    ];
    const { messages: out, compacted } = compactHistory(messages);
    expect(compacted).toBe(0);
    expect(out).toEqual(messages);
  });

  it('compacts oldest large tool outputs but preserves recent messages', () => {
    const big = 'x'.repeat(60_000);
    const messages: AgentMessage[] = [
      { role: 'user', content: 'task' },
      ...Array.from({ length: 10 }, (): AgentMessage => ({
        role: 'tool',
        results: [{ toolCallId: 'a', ok: true, output: big }],
      })),
    ];
    const { messages: out, compacted } = compactHistory(messages);
    expect(compacted).toBeGreaterThan(0);
    // Last 6 messages stay intact.
    const lastSix = out.slice(-6);
    for (const message of lastSix) {
      if (message.role === 'tool') {
        expect(message.results[0].output).toBe(big);
      }
    }
  });
});
