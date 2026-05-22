import { THEONE_CONFIG } from './config';
import type { ExecutionPlan } from './types';

export function assertPlanSafe(plan: ExecutionPlan, autoMode: boolean) {
  if (!autoMode) return;

  for (const step of plan.steps) {
    if (step.requiresApproval && !THEONE_CONFIG.safeActions.has(step.action)) {
      throw new Error(`Unsafe step in auto mode: ${step.action}`);
    }
  }
}
