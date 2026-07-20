import { describe, it, expect } from 'vitest';
import { normalizeOneClawTaskContract } from '@/lib/theone/execution/task-contracts';
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

  it('keeps an explicit step objective over the intent objective', () => {
    const normalized = normalizeOneClawTaskContract({
      task: task({ objective: 'Explicit narrower goal' }),
      intent,
    });
    expect(normalized?.steps[0]?.input?.objective).toBe('Explicit narrower goal');
  });
});
