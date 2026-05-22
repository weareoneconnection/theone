import { THEONE_CONFIG } from '../config';
import type { ExecutionPlan } from '../types';

export function validatePlan(plan: ExecutionPlan): ExecutionPlan {
  if (plan.steps.length > THEONE_CONFIG.maxSteps) {
    throw new Error('Plan exceeds maximum allowed steps');
  }

  return plan;
}
