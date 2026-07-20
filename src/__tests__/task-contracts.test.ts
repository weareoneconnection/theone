import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { normalizeOneClawTaskContract } from '@/lib/theone/execution/task-contracts';
import { preflightOneClawTask } from '@/lib/theone/execution/preflight';
import type { ClassifiedIntent, OneClawTask } from '@/lib/theone/types';

const intent: ClassifiedIntent = {
  type: 'software_engineering' as ClassifiedIntent['type'],
  objective: 'Add a unit test for parseAmount handling negative input',
  entities: [],
  constraints: [],
  priority: 'normal' as ClassifiedIntent['priority'],
  confidence: 0.9,
  requiresApproval: true,
};

const task = (input: Record<string, unknown>): OneClawTask => ({
  taskName: 'code task',
  approvalMode: 'manual',
  steps: [{ id: 's1', action: 'code.patch.apply', input } as OneClawTask['steps'][number]],
  metadata: { workspacePath: '/tmp/repo' },
});

describe('normalizeOneClawTaskContract agent-engine handoff', () => {
  it('injects the intent objective into code.patch.apply steps without files[]', () => {
    const normalized = normalizeOneClawTaskContract({ task: task({}), intent });
    const step = normalized?.steps[0];
    expect(step?.input?.objective).toBe(intent.objective);
    expect(step?.input?.workspacePath).toBe('/tmp/repo');
  });

  it('leaves planner-generated files[] runs untouched', () => {
    const normalized = normalizeOneClawTaskContract({
      task: task({ files: [{ path: 'a.ts', content: 'x' }] }),
      intent,
    });
    expect(normalized?.steps[0]?.input?.objective).toBeUndefined();
  });

  it('treats path-only files[] as hints and still injects the objective', () => {
    const normalized = normalizeOneClawTaskContract({
      task: task({ files: [{ path: 'src/client.js' }] }),
      intent,
    });
    expect(normalized?.steps[0]?.input?.objective).toBe(intent.objective);
  });

  it('keeps an explicit step objective over the intent objective', () => {
    const normalized = normalizeOneClawTaskContract({
      task: task({ objective: 'Explicit narrower goal' }),
      intent,
    });
    expect(normalized?.steps[0]?.input?.objective).toBe('Explicit narrower goal');
  });
});

describe('preflight agent-mode contract', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.THEONE_CODE_LOCAL_BRIDGE_URL = 'http://localhost:4100';
    process.env.THEONE_CODE_WORKSPACE_ROOTS = '/app/workspaces';
  });
  afterEach(() => {
    process.env = { ...env };
  });

  const preflight = (input: Record<string, unknown>) => preflightOneClawTask({
    task: {
      taskName: 'code task',
      approvalMode: 'manual',
      steps: [{ id: 's1', action: 'code.patch.apply', input: { workspacePath: '/app/workspaces/repo', ...input } }],
    } as OneClawTask,
    intent,
    mode: 'assist' as Parameters<typeof preflightOneClawTask>[0]['mode'],
  });

  it('objective-only code.patch.apply is not blocked (agent mode)', () => {
    const report = preflight({ objective: 'Fix the bug and run tests' });
    expect(report.status).not.toBe('blocked');
    expect(report.checks.some((c) => c.status === 'fail')).toBe(false);
  });

  it('files[] direct mode is not blocked', () => {
    const report = preflight({ files: [{ path: 'a.ts', content: 'x' }] });
    expect(report.status).not.toBe('blocked');
  });

  it('neither objective nor files blocks the task', () => {
    const report = preflight({});
    expect(report.status).toBe('blocked');
    expect(report.checks.some((c) => c.id.startsWith('code_patch_mode') && c.status === 'fail')).toBe(true);
  });

  it('path-only files[] with objective resolves to agent mode, not blocked', () => {
    const report = preflight({ objective: 'Fix timeout', files: [{ path: 'src/client.js' }] });
    expect(report.status).not.toBe('blocked');
    const modeCheck = report.checks.find((c) => c.id.startsWith('code_patch_mode'));
    expect(modeCheck?.detail).toContain('Agent mode');
  });
});
