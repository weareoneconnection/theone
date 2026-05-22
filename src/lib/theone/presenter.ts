import type { ExecutionPlan } from './types';

export function summarizePlan(plan: ExecutionPlan) {
  return {
    stepCount: plan.steps.length,
    summary: plan.summary,
    estimatedRisk: plan.estimatedRisk,
  };
}
