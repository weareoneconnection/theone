import type { OneAIGenerateResult, PlanStep, PlanStepStatus } from '../types';

export function markSteps(
  steps: PlanStep[],
  statuses: Partial<Record<PlanStep['action'], PlanStepStatus>>
) {
  return steps.map((step) => ({
    ...step,
    status: statuses[step.action] ?? step.status,
  }));
}

export function oneAiSucceeded(result: OneAIGenerateResult<unknown>) {
  return result.success !== false;
}
