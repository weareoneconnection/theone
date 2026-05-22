export function createRunId() {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createPlanId() {
  return `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}
