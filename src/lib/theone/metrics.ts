export function computeExecutionStats(items: Array<{ ok?: boolean; status?: string }>) {
  const completedSteps = items.filter((item) => item.ok === true || item.status === 'completed').length;
  const failedSteps = items.filter((item) => item.ok === false || item.status === 'failed').length;
  return { completedSteps, failedSteps };
}
